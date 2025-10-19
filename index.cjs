// Stremio YouTube Universe Add-on
// index.cjs — stable CommonJS build for Render deployments
//
// Features:
// - Low-quota RSS mode (no YouTube API)
// - Paste @handle, /user/, /channel/UC… or full URL
// - Saved list admin at /admin/:listId
// - Works in Render with node-fetch@2 and Express 4

const express = require("express");
const bodyParser = require("body-parser");
const fetch = require("node-fetch");
const { parseStringPromise } = require("xml2js");
const { addonBuilder } = require("stremio-addon-sdk");

// ---------- Config ----------
const DEFAULT_PORT = parseInt(process.env.PORT || "7000", 10);
const LOW_QUOTA_MODE = process.env.LOW_QUOTA_MODE !== "false";
const ADDON_NAME = "YouTube Universe";
const ADDON_ID = "stremio-youtube-universe";

// In-memory saved lists
const lists = new Map();

// ---------- Helper functions ----------
function isChannelId(str) {
  return /^UC[0-9A-Za-z_-]{22}$/.test(str);
}

function tryExtractChannelIdFromUrl(url) {
  try {
    const u = new URL(url);
    // /channel/UCxxxx
    const mChannel = u.pathname.match(/^\/channel\/(UC[0-9A-Za-z_-]{22})/);
    if (mChannel) return mChannel[1];

    // /@handle -> needs fetch to resolve
    const mHandle = u.pathname.match(/^\/(@[A-Za-z0-9_.-]+)/);
    if (mHandle) return { handle: mHandle[1] };

    // /user/username -> needs fetch to resolve
    const mUser = u.pathname.match(/^\/user\/([A-Za-z0-9_-]+)/);
    if (mUser) return { user: mUser[1] };
  } catch (_) {}
  return null;
}


async function scrapeChannelIdFromPage(pageUrl) {
  try {
    const res = await fetch(pageUrl, {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html" }
    });
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/"channelId":"(UC[0-9A-Za-z_-]{22})"/);
    return m ? m[1] : null;
  } catch (_) {
    return null;
  }
}

async function resolveChannelId(input) {
  const val = (input || "").trim();

  // Raw UC… id
  if (/^UC[0-9A-Za-z_-]{22}$/.test(val)) return { channelId: val };

  // Try parsing as URL (robust, no regex escapes)
  let asUrl = null;
  try { asUrl = new URL(val); } catch (_) {}

  // If it’s a URL, try direct channelId first
  if (asUrl) {
    const p = asUrl.pathname;
    const mChannel = p.match(/^\/channel\/(UC[0-9A-Za-z_-]{22})/);
    if (mChannel) return { channelId: mChannel[1] };

    const mHandle = p.match(/^\/(@[A-Za-z0-9_.-]+)/);
    if (mHandle) {
      const id = await scrapeChannelIdFromPage(`https://www.youtube.com/${mHandle[1]}`);
      return id ? { channelId: id } : { error: `Cannot resolve ${mHandle[1]}` };
    }

    const mUser = p.match(/^\/user\/([A-Za-z0-9_-]+)/);
    if (mUser) {
      const id = await scrapeChannelIdFromPage(`https://www.youtube.com/user/${mUser[1]}`);
      return id ? { channelId: id } : { error: `Cannot resolve ${mUser[1]}` };
    }

    // Fallback: scrape whatever URL was provided
    const id = await scrapeChannelIdFromPage(val);
    return id ? { channelId: id } : { error: `Cannot resolve ${val}` };
  }

  // Bare @handle
  if (/^@[A-Za-z0-9_.-]+$/.test(val)) {
    const id = await scrapeChannelIdFromPage(`https://www.youtube.com/${val}`);
    return id ? { channelId: id } : { error: `Cannot resolve ${val}` };
  }

  return { error: "Invalid channel input" };
}


async function fetchChannelRSS(channelId) {
  const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
  if (!res.ok) throw new Error(`RSS ${res.status}`);
  const xml = await res.text();
  return parseStringPromise(xml, { explicitArray: false });
}

function rssToEpisodes(feed, channelId, limit = 50) {
  const entries = Array.isArray(feed.feed.entry)
    ? feed.feed.entry
    : feed.feed.entry
    ? [feed.feed.entry]
    : [];
  const name = feed.feed?.author?.name || "YouTube Channel";
  const videos = entries.slice(0, limit).map((e, i) => ({
    id: `yt:${channelId}:${e["yt:videoId"]}`,
    title: e.title || `Video ${i + 1}`,
    released: e.published,
    thumbnail: e["media:group"]?.["media:thumbnail"]?.url,
    overview: e["media:group"]?.["media:description"]
  }));
  return { name, videos };
}

// ---------- Manifest ----------
function buildManifest(baseUrl) {
  const badge = LOW_QUOTA_MODE ? " • 🟡 Low-quota mode enabled" : "";
  return {
    id: ADDON_ID,
    version: "1.1.1",
    name: ADDON_NAME,
    description: `Paste YouTube channels or @handles to browse via RSS.${badge}`,
    logo: `${baseUrl}/static/logo.png`,
    background: `${baseUrl}/static/bg.png`,
    types: ["series"],
    catalogs: [
      {
        type: "series",
        id: "youtube-user",
        name: "YouTube — Channel",
        extra: [{ name: "search" }]
      },
      {
        type: "series",
        id: "youtube-list",
        name: "YouTube — Saved List",
        extra: [{ name: "list", isRequired: true }]
      }
    ],
    resources: ["catalog", "meta", "stream"],
    idPrefixes: ["ytchannel:", "yt:"]
  };
}

// ---------- Add-on builder ----------
const builder = new addonBuilder(buildManifest(""));

// Catalog handler
builder.defineCatalogHandler(async ({ id, extra }) => {
  if (id === "youtube-user") {
    const query = (extra.search || "").trim();
    if (!query)
      return {
        metas: [
          {
            id: "ytchannel:help",
            type: "series",
            name: "Paste a YouTube URL or @handle in the search box",
            description: "Examples: @techlinked or https://www.youtube.com/user/LinusTechTips"
          }
        ]
      };
    const resolved = await resolveChannelId(query);
    if (!resolved.channelId)
      return {
        metas: [
          {
            id: "ytchannel:error",
            type: "series",
            name: "Error resolving channel",
            description: resolved.error
          }
        ]
      };
    return {
      metas: [
        {
          id: `ytchannel:${resolved.channelId}`,
          type: "series",
          name: `Channel ${resolved.channelId}`,
          description: "Open to view recent uploads"
        }
      ]
    };
  }

  if (id === "youtube-list") {
    const listId = (extra.list || "").trim();
    const set = lists.get(listId) || new Set();
    return {
      metas: [
        {
          id: `ytlist:${listId}`,
          type: "series",
          name: `Saved list: ${listId} (${set.size} channels)`
        }
      ]
    };
  }

  return { metas: [] };
});

// Meta handler
builder.defineMetaHandler(async ({ id }) => {
  if (id.startsWith("ytchannel:")) {
    const channelId = id.replace("ytchannel:", "");
    const feed = await fetchChannelRSS(channelId);
    const { name, videos } = rssToEpisodes(feed, channelId);
    return { meta: { id, type: "series", name, videos } };
  }

  if (id.startsWith("ytlist:")) {
    const listId = id.replace("ytlist:", "");
    const set = lists.get(listId) || new Set();
    const videos = [];
    for (const ch of set) {
      try {
        const feed = await fetchChannelRSS(ch);
        const { videos: eps } = rssToEpisodes(feed, ch, 10);
        videos.push(...eps);
      } catch (_) {}
    }
    videos.sort((a, b) => new Date(b.released) - new Date(a.released));
    return { meta: { id, type: "series", name: `List ${listId}`, videos } };
  }

  return { meta: { id, type: "series", name: "Unknown" } };
});

// Stream handler
builder.defineStreamHandler(async ({ id }) => {
  if (!id.startsWith("yt:")) return { streams: [] };
  const videoId = id.split(":")[2];
  return {
    streams: [{ title: "Watch on YouTube", externalUrl: `https://www.youtube.com/watch?v=${videoId}` }]
  };
});

// ---------- Express setup ----------
const app = express();
app.use(bodyParser.json());

// Static images
app.get("/static/logo.png", (_r, res) =>
  res.redirect("https://i.imgur.com/a1m7QYk.png")
);
app.get("/static/bg.png", (_r, res) =>
  res.redirect("https://i.imgur.com/jKX1Nry.jpeg")
);

// Manifest
app.get(["/manifest", "/manifest.json"], (req, res) => {
  const base = `${req.protocol}://${req.get("host")}`;
  res.json(buildManifest(base));
});

// Forward all addon routes safely
const addonInterface = builder.getInterface();
app.use((req, res, next) => {
  const u = req.url;
  if (
    u.startsWith("/catalog/") ||
    u.startsWith("/meta/") ||
    u.startsWith("/stream/")
  )
    return addonInterface(req, res);
  return next();
});

// ---------- Saved lists API ----------
app.get("/api/list/:listId", (req, res) => {
  const listId = req.params.listId;
  res.json({ listId, channels: Array.from(lists.get(listId) || []) });
});

app.post("/api/list/:listId/add", async (req, res) => {
  const { listId } = req.params;
  const input = (req.body.channel || "").trim();
  const resolved = await resolveChannelId(input);
  if (!resolved.channelId) return res.status(400).json({ error: resolved.error });
  const set = lists.get(listId) || new Set();
  set.add(resolved.channelId);
  lists.set(listId, set);
  res.json({ ok: true, channels: Array.from(set) });
});

app.post("/api/list/:listId/remove", async (req, res) => {
  const { listId } = req.params;
  const input = (req.body.channel || "").trim();
  const resolved = await resolveChannelId(input);
  const set = lists.get(listId) || new Set();
  if (resolved.channelId) set.delete(resolved.channelId);
  lists.set(listId, set);
  res.json({ ok: true, channels: Array.from(set) });
});

// ---------- Minimal admin UI ----------
app.get("/admin/:listId", (req, res) => {
  const listId = req.params.listId;
  res.setHeader("Content-Type", "text/html");
  res.end(`<!doctype html>
<html><head><meta charset=utf-8><title>Admin ${listId}</title>
<style>body{font-family:sans-serif;background:#0b1020;color:#e6e9f2;padding:24px;}
input,button{padding:10px;margin:4px;}li{margin:6px 0;}</style></head>
<body><h2>Manage list: ${listId}</h2>
<input id=i placeholder="@handle or URL"><button id=a>Add</button>
<ul id=u></ul><script>
const base=location.origin;const list='${listId}';const u=document.getElementById('u');
async function load(){const r=await fetch(base+'/api/list/'+list);const j=await r.json();
u.innerHTML='';for(const c of j.channels){const li=document.createElement('li');
li.textContent=c;const b=document.createElement('button');b.textContent='X';
b.onclick=async()=>{await fetch(base+'/api/list/'+list+'/remove',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({channel:c})});load();};
li.appendChild(b);u.appendChild(li);}}
document.getElementById('a').onclick=async()=>{const v=document.getElementById('i').value.trim();
await fetch(base+'/api/list/'+list+'/add',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({channel:v})});document.getElementById('i').value='';load();};
load();</script></body></html>`);
});

// ---------- Port auto-retry ----------
async function startServer(port) {
  return new Promise(resolve => {
    const s = app
      .listen(port, () => resolve({ s, port }))
      .on("error", async e => {
        if (e.code === "EADDRINUSE") {
          console.warn(`Port ${port} busy, retrying ${port + 1}`);
          resolve(await startServer(port + 1));
        } else throw e;
      });
  });
}

// ---------- Boot ----------
(async () => {
  const { port } = await startServer(DEFAULT_PORT);
  console.log(`HTTP addon at http://127.0.0.1:${port}/manifest.json`);
})();
