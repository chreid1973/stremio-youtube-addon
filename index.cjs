// Stremio YouTube Universe Add-on IS THIS THE NEW index.js ???
// index.js — Low‑quota (no YouTube API) mode using RSS, handle/URL parsing, and simple saved lists
//
// Features
// - "Low‑quota mode" banner in manifest description.
// - Paste a YouTube channel URL, @handle, /channel/UC..., /user/<name>, or raw channelId.
// - Resolves to channelId (best-effort without API) and pulls latest videos via RSS.
// - Streams open on YouTube (externalUrl), zero bandwidth cost to you.
// - Simple in-memory "saved lists" of channels with lightweight HTTP endpoints.
// - Optional aggregated "list" catalog that shows a single meta with the latest videos across your saved channels.
// - Friendly port auto-retry if :7000 is occupied.
//
// Usage examples (once running):
//  Manifest:            http://127.0.0.1:7000/manifest.json
//  Catalog (user):      http://127.0.0.1:7000/catalog/series/youtube-user.json
//  Discover example:    https://web.strem.io/#/discover/series/youtube-user?addon=http%3A%2F%2F127.0.0.1%3A7000%2Fmanifest.json&search=https%3A%2F%2Fwww.youtube.com%2F%40techlinked
//  Saved list catalog:  https://web.strem.io/#/discover/series/youtube-list?addon=http%3A%2F%2F127.0.0.1%3A7000%2Fmanifest.json&extra=list%3Amy-dev
//  Meta for channel:    http://127.0.0.1:7000/meta/series/ytchannel:UCXuqSBlHAE6Xw-yeJA0Tunw.json
//  Stream for video:    http://127.0.0.1:7000/stream/series/yt:UCXuqSBlHAE6Xw-yeJA0Tunw:VIDEOID.json
//  Admin: list ops below
//
// Admin list endpoints (JSON):
//  GET  /api/list/:listId                     -> { listId, channels: [channelId,...] }
//  POST /api/list/:listId/set   body {channels:[...]}
//  POST /api/list/:listId/add   body {channel:"UC..." | url | @handle}
//  POST /api/list/:listId/remove body {channel:"UC..." | url | @handle}
//
// Notes
// - This file intentionally avoids YouTube Data API to keep quotas near-zero.
// - "user" and "@handle" resolution is best-effort by scraping the channel page for a channelId.
// - If resolution fails, we still surface a helpful error in the catalog response.

const express = require("express");
const bodyParser = require("body-parser");
const fetch = require("node-fetch");
const { parseStringPromise } = require("xml2js");
const { addonBuilder } = require("stremio-addon-sdk");

// ---------- Config ----------
const DEFAULT_PORT = parseInt(process.env.PORT || "7000", 10);
const LOW_QUOTA_MODE = process.env.LOW_QUOTA_MODE !== "false"; // default true
const ADDON_NAME = "YouTube Universe";
const ADDON_ID = "stremio-youtube-universe";

// In-memory lists storage: Map<listId, Set<channelId>>
const lists = new Map();

// ---------- Helpers ----------
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

function isChannelId(str) {
  return /^UC[0-9A-Za-z_-]{22}$/.test(str);
}

function tryExtractChannelIdFromUrl(url) {
  try {
    const u = new URL(url);
    // /channel/UCxxxx
    const mChannel = u.pathname.match(/\/channel\/(UC[0-9A-Za-z_-]{22})/);
    if (mChannel) return mChannel[1];
    // /@handle form — needs fetch to resolve
    const mHandle = u.pathname.match(/^\/(@[A-Za-z0-9_\.-]+)/);
    if (mHandle) return { handle: mHandle[1] };
    // /user/username — needs fetch to resolve
    const mUser = u.pathname.match(/^\/user\/([A-Za-z0-9_-]+)/);
    if (mUser) return { user: mUser[1] };
  } catch (_) {}
  return null;
}

async function resolveChannelId(input) {
  // Raw channel ID
  if (isChannelId(input)) return { channelId: input, source: "raw" };
  // URL parse
  const urlGuess = tryExtractChannelIdFromUrl(input);
  if (typeof urlGuess === "string") return { channelId: urlGuess, source: "url:channel" };
  if (urlGuess && urlGuess.handle) {
    const pageUrl = `https://www.youtube.com/${urlGuess.handle}`;
    const id = await scrapeChannelIdFromPage(pageUrl);
    if (id) return { channelId: id, source: "url:handle" };
    return { error: `Could not resolve handle ${urlGuess.handle}` };
  }
  if (urlGuess && urlGuess.user) {
    const pageUrl = `https://www.youtube.com/user/${urlGuess.user}`;
    const id = await scrapeChannelIdFromPage(pageUrl);
    if (id) return { channelId: id, source: "url:user" };
    return { error: `Could not resolve user ${urlGuess.user}` };
  }
  // Maybe user pasted just a @handle
  if (/^@[A-Za-z0-9_\.-]+$/.test(input)) {
    const pageUrl = `https://www.youtube.com/${input}`;
    const id = await scrapeChannelIdFromPage(pageUrl);
    if (id) return { channelId: id, source: "handle" };
    return { error: `Could not resolve handle ${input}` };
  }
  // Maybe they pasted a full URL but we couldn't parse
  if (/^https?:\/\//i.test(input)) {
    const id = await scrapeChannelIdFromPage(input);
    if (id) return { channelId: id, source: "url:generic" };
    return { error: `Could not resolve channelId from ${input}` };
  }
  return { error: "Input is not a channel URL, handle, or UC id" };
}

async function scrapeChannelIdFromPage(pageUrl) {
  try {
    const res = await fetch(pageUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    if (!res.ok) return null;
    const html = await res.text();
    // Look for "channelId":"UCxxxx"
    const m = html.match(/"channelId":"(UC[0-9A-Za-z_-]{22})"/);
    if (m) return m[1];
    return null;
  } catch (_) {
    return null;
  }
}

async function fetchChannelRSS(channelId) {
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  const res = await fetch(url, { headers: { Accept: "application/atom+xml" } });
  if (!res.ok) throw new Error(`RSS ${res.status}`);
  const xml = await res.text();
  const data = await parseStringPromise(xml, { explicitArray: false });
  return data; // Atom feed
}

function rssToEpisodes(feed, channelId, limit = 50) {
  const entries = feed.feed && feed.feed.entry ? (Array.isArray(feed.feed.entry) ? feed.feed.entry : [feed.feed.entry]) : [];
  const channelName = feed.feed && feed.feed.author && feed.feed.author.name ? feed.feed.author.name : "YouTube Channel";
  const episodes = entries.slice(0, limit).map((e, idx) => {
    const videoId = e["yt:videoId"] || (e.id && e.id.split(":").pop()) || `video_${idx}`;
    const published = e.published || null;
    const title = e.title || `Video ${idx + 1}`;
    const thumb = e["media:group"] && e["media:group"]["media:thumbnail"] ? e["media:group"]["media:thumbnail"].url : undefined;
    const duration = e["media:group"] && e["media:group"]["media:group"]["yt:duration"] ? Number(e["media:group"]["media:group"]["yt:duration"].seconds) : undefined;
    return {
      id: `yt:${channelId}:${videoId}`,
      title,
      released: published || undefined,
      thumbnail: thumb,
      season: 1,
      episode: idx + 1,
      overview: (e["media:group"] && e["media:group"]["media:description"]) || undefined,
      // Note: Stremio ignores custom fields here, but we keep them for clarity
      _videoId: videoId,
      _channel: channelName,
    };
  });
  return { channelName, episodes };
}

function buildManifest(baseUrl) {
  const badge = LOW_QUOTA_MODE ? " • 🟡 Low‑quota mode enabled" : "";
  return {
    id: ADDON_ID,
    version: "1.1.0",
    name: ADDON_NAME,
    description: `Paste channel URLs or @handles to browse and play videos via YouTube links.${badge}`,
    logo: `${baseUrl}/static/logo.png`,
    background: `${baseUrl}/static/bg.png`,
    types: ["series"],
    catalogs: [
      {
        type: "series",
        id: "youtube-user",
        name: "YouTube — Channel",
        extra: [
          { name: "search", isRequired: false },
          { name: "skip", isRequired: false },
        ],
      },
      {
        type: "series",
        id: "youtube-list",
        name: "YouTube — Saved List (aggregate)",
        extra: [
          { name: "list", isRequired: true, options: ["demo"] },
          { name: "skip", isRequired: false },
        ],
      },
    ],
    resources: ["catalog", "meta", "stream"],
    idPrefixes: ["ytchannel:", "yt:"],
  };
}

// ---------- Addon definition ----------
const builder = new addonBuilder(buildManifest("") /* temp base, patched at request time */);

// Catalog: youtube-user (search a single channel)
builder.defineCatalogHandler(async (args) => {
  const { type, id, extra = {} } = args;
  if (type !== "series") return { metas: [] };

  if (id === "youtube-user") {
    const search = (extra.search || "").trim();
    if (!search) {
      // Provide a helpful meta explaining how to use search
      return {
        metas: [
          {
            id: "ytchannel:help",
            type: "series",
            name: "Paste a YouTube channel URL or @handle in the search box",
            poster: "https://i.imgur.com/1ZQZ1ZP.png",
            posterShape: "square",
            description:
              "Examples: https://www.youtube.com/@techlinked, https://www.youtube.com/channel/UC4PooiX37Pld1T8J5SYT-SQ, https://www.youtube.com/user/LinusTechTips",
          },
        ],
      };
    }

    // Resolve to channelId
    const resolved = await resolveChannelId(search);
    if (!resolved || resolved.error) {
      return {
        metas: [
          {
            id: "ytchannel:error",
            type: "series",
            name: "Could not resolve channel",
            description: resolved && resolved.error ? String(resolved.error) : "Unknown error",
            poster: "https://i.imgur.com/vKcW1gD.png",
            posterShape: "square",
          },
        ],
      };
    }

    const channelId = resolved.channelId;
    // Return a single meta representing the channel; episodes are served in meta handler
    return {
      metas: [
        {
          id: `ytchannel:${channelId}`,
          type: "series",
          name: `YouTube Channel (${channelId})`,
          poster: `https://yt3.ggpht.com/ytc/${channelId}=s512-c-k-c0x00ffffff-no-rj`, // best-effort; YouTube image URLs vary
          posterShape: "square",
          description: LOW_QUOTA_MODE
            ? "Resolved via RSS (low‑quota). Open the meta to see recent videos."
            : "Resolved via API.",
        },
      ],
    };
  }

  if (id === "youtube-list") {
    const listId = (extra.list || "").trim();
    if (!listId) return { metas: [] };

    const set = lists.get(listId) || new Set();
    return {
      metas: [
        {
          id: `ytlist:${listId}`,
          type: "series",
          name: `Saved List: ${listId} (${set.size} channels)` ,
          poster: "https://i.imgur.com/Zf7az0x.png",
          posterShape: "landscape",
          description: "Open to view a combined feed of the channels in this saved list.",
        },
      ],
    };
  }

  return { metas: [] };
});

// Meta: channel meta with episodes, or list meta with aggregated episodes
builder.defineMetaHandler(async (args) => {
  const { id } = args;
  try {
    if (id.startsWith("ytchannel:")) {
      const channelId = id.replace("ytchannel:", "");
      const feed = await fetchChannelRSS(channelId);
      const { channelName, episodes } = rssToEpisodes(feed, channelId);
      return {
        meta: {
          id,
          type: "series",
          name: channelName || `YouTube Channel (${channelId})`,
          poster: `https://yt3.ggpht.com/ytc/${channelId}=s512-c-k-c0x00ffffff-no-rj`,
          videos: episodes,
        },
      };
    }

    if (id.startsWith("ytlist:")) {
      const listId = id.replace("ytlist:", "");
      const set = lists.get(listId) || new Set();
      const allEps = [];
      for (const ch of set) {
        try {
          const feed = await fetchChannelRSS(ch);
          const { episodes } = rssToEpisodes(feed, ch, 20);
          allEps.push(...episodes);
        } catch (e) {
          // skip broken channel
        }
      }
      // sort by release desc
      allEps.sort((a, b) => new Date(b.released || 0) - new Date(a.released || 0));
      return {
        meta: {
          id,
          type: "series",
          name: `Saved List: ${listId}`,
          poster: "https://i.imgur.com/Zf7az0x.png",
          videos: allEps.slice(0, 100),
        },
      };
    }
  } catch (e) {
    return { meta: { id, type: "series", name: "Error", description: String(e?.message || e) } };
  }
  return { meta: { id, type: "series", name: "Unknown" } };
});

// Streams: point to YouTube watch URLs
builder.defineStreamHandler(async (args) => {
  const { id } = args;
  // id form: yt:CHANNELID:VIDEOID
  if (!id.startsWith("yt:")) return { streams: [] };
  const parts = id.split(":");
  const videoId = parts[2];
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  return {
    streams: [
      {
        title: "Watch on YouTube",
        externalUrl: url,
      },
    ],
  };
});

// ---------- Express wrapper for custom endpoints & dynamic manifest ----------
const app = express();
app.use(bodyParser.json());

// Static tiny placeholders (optional)
app.get("/static/logo.png", (_req, res) => res.redirect("https://i.imgur.com/a1m7QYk.png"));
app.get("/static/bg.png", (_req, res) => res.redirect("https://i.imgur.com/jKX1Nry.jpeg"));

// Dynamic manifest so we can inject correct base URL
app.get(["/manifest.json", "/manifest"], (req, res) => {
  const base = `${req.protocol}://${req.get("host")}`;
  const manifest = buildManifest(base);
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(manifest));
});

// Stremio addon interface
const addonInterface = builder.getInterface();

// Use thin wrappers so Express receives a callback function (SDK returns an object otherwise)
app.get(/^\/catalog\/.+(?:\.json)?$/, (req, res) => addonInterface(req, res));
app.get(/^\/meta\/.+(?:\.json)?$/, (req, res) => addonInterface(req, res));
app.get(/^\/stream\/.+(?:\.json)?$/, (req, res) => addonInterface(req, res));

// ---------- Saved Lists Admin API ----------
function normalizeChannelInput(str) { return (str || "").trim(); }

app.get("/api/list/:listId", async (req, res) => {
  const { listId } = req.params;
  const set = lists.get(listId) || new Set();
  res.json({ listId, channels: Array.from(set) });
});

app.post("/api/list/:listId/set", async (req, res) => {
  const { listId } = req.params;
  const channels = Array.isArray(req.body.channels) ? req.body.channels : [];
  const set = new Set();
  for (const raw of channels) {
    const input = normalizeChannelInput(raw);
    const r = await resolveChannelId(input);
    if (r && r.channelId) set.add(r.channelId);
  }
  lists.set(listId, set);
  res.json({ ok: true, listId, channels: Array.from(set) });
});

app.post("/api/list/:listId/add", async (req, res) => {
  const { listId } = req.params;
  const input = normalizeChannelInput(req.body.channel);
  const r = await resolveChannelId(input);
  if (!r || !r.channelId) return res.status(400).json({ ok: false, error: r?.error || "Unable to resolve" });
  const set = lists.get(listId) || new Set();
  set.add(r.channelId);
  lists.set(listId, set);
  res.json({ ok: true, listId, added: r.channelId, channels: Array.from(set) });
});

app.post("/api/list/:listId/remove", async (req, res) => {
  const { listId } = req.params;
  const input = normalizeChannelInput(req.body.channel);
  const r = await resolveChannelId(input);
  if (!r || !r.channelId) return res.status(400).json({ ok: false, error: r?.error || "Unable to resolve" });
  const set = lists.get(listId) || new Set();
  set.delete(r.channelId);
  lists.set(listId, set);
  res.json({ ok: true, listId, removed: r.channelId, channels: Array.from(set) });
});

// ---------- Minimal Browser Admin UI ----------
function renderAdminHTML(listId) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>YouTube Universe – List Admin (${listId})</title>
  <style>
    :root { color-scheme: dark light; }
    body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"; margin: 0; padding: 24px; background: #0b1020; color: #e6e9f2; }
    .card { max-width: 840px; margin: 0 auto; background: #141a2c; border: 1px solid #26304f; border-radius: 16px; padding: 20px; box-shadow: 0 10px 30px rgba(0,0,0,.25); }
    h1 { margin: 0 0 12px; font-size: 22px; }
    .muted { color: #9fb0d0; font-size: 14px; margin-bottom: 16px; }
    .row { display: flex; gap: 8px; margin-bottom: 12px; }
    input[type=text] { flex: 1; padding: 10px 12px; border-radius: 10px; border: 1px solid #2e3a5e; background: #0f1530; color: #e6e9f2; }
    button { padding: 10px 14px; border-radius: 10px; border: 1px solid #2e3a5e; background: #1b2450; color: #e6e9f2; cursor: pointer; }
    button:hover { background: #22306d; }
    ul { list-style: none; padding: 0; margin: 0; }
    li { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px; border: 1px solid #26304f; border-radius: 10px; margin-bottom: 8px; background: #0f1530; }
    .chip { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size: 12px; background: #0b1020; padding: 4px 8px; border-radius: 8px; border: 1px solid #2e3a5e; }
    .small { font-size: 12px; color: #9fb0d0; }
    a { color: #99c1ff; text-decoration: none; }
  </style>
</head>
<body>
  <div class="card">
    <h1>List Admin – <code>${listId}</code></h1>
    <div class="muted">Paste a YouTube <b>@handle</b>, <b>/user/name</b>, <b>/channel/UC…</b>, or full URL. The server resolves it to a <b>UC…</b> id and stores it.</div>

    <div class="row">
      <input id="channel" type="text" placeholder="@techlinked or https://www.youtube.com/user/LinusTechTips or UC…" />
      <button id="addBtn">Add</button>
    </div>

    <div class="row">
      <input id="bulk" type="text" placeholder="Bulk set (comma or newline separated)…" />
      <button id="setBtn" title="Replace the entire list">Set list</button>
    </div>

    <div class="small" style="margin-bottom:10px;">Discover this list in Stremio: <a id="discover" target="_blank"></a></div>

    <ul id="items"></ul>

    <div class="small" style="margin-top:12px;">API: <code>/api/list/${listId}</code> · <code>/api/list/${listId}/add</code> · <code>/api/list/${listId}/remove</code> · <code>/api/list/${listId}/set</code></div>
  </div>

<script>
const listId = ${JSON.stringify(listId)};
const base = location.origin;
const itemsEl = document.getElementById('items');
const channelInput = document.getElementById('channel');
const bulkInput = document.getElementById('bulk');
const discoverA = document.getElementById('discover');

const addon = encodeURIComponent(base + '/manifest.json');
const discoverUrl = 'https://web.strem.io/#/discover/series/youtube-list?addon=' + addon + '&extra=list%3A' + encodeURIComponent(listId);
discoverA.textContent = discoverUrl; discoverA.href = discoverUrl;

async function load() {
  const res = await fetch(base + '/api/list/' + listId);
  const json = await res.json();
  render(json.channels || []);
}

function render(arr){
  itemsEl.innerHTML='';
  if(!arr.length){
    const li = document.createElement('li');
    li.innerHTML = '<span class="small">No channels yet. Add one above.</span>';
    itemsEl.appendChild(li);
    return;
  }
  for(const ch of arr){
    const li = document.createElement('li');
    const left = document.createElement('div'); left.className='chip'; left.textContent = ch;
    const btn = document.createElement('button'); btn.textContent='Remove';
    btn.onclick = async () => {
      await fetch(base + '/api/list/' + listId + '/remove', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({channel: ch}) });
      load();
    };
    li.appendChild(left); li.appendChild(btn);
    itemsEl.appendChild(li);
  }
}

document.getElementById('addBtn').onclick = async () => {
  const v = channelInput.value.trim(); if(!v) return; channelInput.value='';
  const res = await fetch(base + '/api/list/' + listId + '/add', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({channel: v}) });
  load();
};

document.getElementById('setBtn').onclick = async () => {
  const raw = bulkInput.value.trim(); if(!raw) return; 
  const tokens = raw.split(/
|,/).map(s=>s.trim()).filter(Boolean);
  await fetch(base + '/api/list/' + listId + '/set', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({channels: tokens}) });
  load();
};

load();
</script>
</body>
</html>`;
}

app.get('/admin/:listId', (req, res) => {
  const { listId } = req.params;
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(renderAdminHTML(listId));
});

// ---------- Port auto-retry ----------

async function startServer(port) {
  return new Promise((resolve) => {
    const server = app
      .listen(port, () => resolve({ server, port }))
      .on("error", async (err) => {
        if (err.code === "EADDRINUSE") {
          const next = port + 1;
          console.warn(`Port ${port} in use, retrying on ${next}...`);
          const res = await startServer(next);
          resolve(res);
        } else {
          console.error("Server error:", err);
          process.exit(1);
        }
      });
  });
}

// ---------- Boot ----------
(async () => {
  const { port } = await startServer(DEFAULT_PORT);
  console.log(`HTTP addon accessible at: http://127.0.0.1:${port}/manifest.json`);
})();
