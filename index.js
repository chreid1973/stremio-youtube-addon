//---------------------------------------------------------
// YouTube Universe — per-channel catalogs + saved favorites
//---------------------------------------------------------
import sdk from "stremio-addon-sdk";
const { addonBuilder, serveHTTP } = sdk;
import fetch from "node-fetch"; // if Render complains, `npm i node-fetch@3`

// ── Required env vars ───────────────────────────────────
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;      // YouTube Data API v3
const JSONBIN_BIN_ID = process.env.JSONBIN_BIN_ID || "";  // e.g. "66a1b2c3d4e5f6a7b8c9"
const JSONBIN_MASTER_KEY = process.env.JSONBIN_MASTER_KEY || "";
const JSONBIN_URL = JSONBIN_BIN_ID ? `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}` : "";

// Fail fast if missing YT key
if (!YOUTUBE_API_KEY) {
  console.error("❌ Missing YOUTUBE_API_KEY");
  process.exit(1);
}

// ── Curated categories (your channels) ──────────────────
const CATEGORIES = {
  Tech: [
    { id: "UCXuqSBlHAE6Xw-yeJA0Tunw", name: "Linus Tech Tips" },
    { id: "UCdBK94H6oZT2Q7l0-b0xmMg", name: "Short Circuit - LTT" },
    { id: "UCBJycsmduvYEL83R_U4JriQ", name: "MKBHD" }
  ],
  Automotive: [
    { id: "UCyXiDU5qjfOPxgOPeFWGwKw", name: "Throttle House" }
  ],
  Podcasts: [
    { id: "UCEcrRXW3oEYfUctetZTAWLw", name: "WVFRM Podcast" },
    { id: "UCi7GJNg51C3jgmYTUwqoUXA", name: "Team COCO" }
  ],
  Entertainment: [
    { id: "UCa6vGFO9ty8v5KZJXQxdhaw", name: "Jimmy Kimmel LIVE" },
    { id: "UCSpFnDQr88xCZ80N-X7t0nQ", name: "Corridor Crew MAIN" }
  ]
};

// ── Manifest ─────────────────────────────────────────────
const manifest = {
  id: "community.youtube.universe",
  version: "3.0.0",
  name: "YouTube Universe",
  description: "Curated YouTube channels by category + saved personal favorites",
  logo: "https://www.youtube.com/s/desktop/d743f786/img/favicon_144x144.png",
  types: ["series"],
  resources: ["catalog", "meta", "stream"],
  idPrefixes: ["yt"],
  catalogs: [],
  behaviorHints: { configurable: false, configurationRequired: false }
};

// One catalog per *channel*, grouped by category in naming
for (const [cat, channels] of Object.entries(CATEGORIES)) {
  const catSlug = cat.toLowerCase();
  channels.forEach((ch) => {
    manifest.catalogs.push({
      type: "series",
      id: `youtube-${catSlug}-${ch.id}`,          // includes channel id
      name: `${cat} — ${ch.name}`                 // renders “Tech — MKBHD”
    });
  });
}

// Add the dynamic, saved favorites catalog
manifest.catalogs.push({
  type: "series",
  id: "youtube-user",
  name: "Your YouTube Favorites",
  extra: [
    { name: "uid", isRequired: false },                                     // user id (short string)
    { name: "action", isRequired: false, options: ["load","save","add","remove","clear"] },
    { name: "search", isRequired: false }                                   // CSV of @handles / URLs / UC ids
  ]
});

const builder = new addonBuilder(manifest);

// ── Tiny cache (kind to quota) ──────────────────────────
const cache = new Map();
const TTL = 60_000;
const setCache = (k, v, t = TTL) => cache.set(k, { v, e: Date.now() + t });
const getCache = (k) => { const x = cache.get(k); return x && x.e > Date.now() ? x.v : null; };

// ── YouTube helper ──────────────────────────────────────
async function yt(endpoint, params = {}) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "" && v !== "undefined") url.searchParams.set(k, v);
  }
  url.searchParams.set("key", YOUTUBE_API_KEY);
  const k = url.toString();
  const c = getCache(k); if (c) return c;
  const res = await fetch(url);
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    console.error("❌ YT error", res.status, res.statusText, endpoint, t.slice(0, 200));
    throw new Error("YT error");
  }
  const json = await res.json(); setCache(k, json); return json;
}

// ── JSONBin helpers (persist favorites) ─────────────────
async function binLoad() {
  if (!JSONBIN_URL) return {};
  const r = await fetch(`${JSONBIN_URL}?meta=false`, {
    headers: { "X-Master-Key": JSONBIN_MASTER_KEY }
  });
  if (!r.ok) { console.warn("JSONBin read failed", r.status); return {}; }
  return (await r.json()) || {};
}
async function binSave(full) {
  if (!JSONBIN_URL) return false;
  const r = await fetch(JSONBIN_URL, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Master-Key": JSONBIN_MASTER_KEY
    },
    body: JSON.stringify(full || {})
  });
  if (!r.ok) console.warn("JSONBin write failed", r.status);
  return r.ok;
}

// ── Mapping helpers ─────────────────────────────────────
function mapSnippet(snippet) {
  const t = snippet.thumbnails || {};
  const poster = t.high?.url || t.medium?.url || t.default?.url || null;
  const bg = t.maxres?.url || t.high?.url || t.medium?.url || poster;
  return {
    id: `yt:${snippet.videoId}`,
    type: "series",
    name: snippet.title || "Untitled",
    poster,
    background: bg,
    description: (snippet.description || "").slice(0, 300),
    releaseInfo: snippet.publishedAt?.slice(0, 10) || "",
    posterShape: "landscape"
  };
}
function extractPossibleIdsOrHandles(input) {
  return String(input).split(/[,\n]/).map(s => s.trim()).filter(Boolean);
}
function guessChannelIdOrHandle(token) {
  const m1 = token.match(/\/channel\/(UC[0-9A-Za-z_-]{20,})/i);
  if (m1) return { type: "id", value: m1[1] };
  const m2 = token.match(/@([A-Za-z0-9._-]+)/);
  if (m2) return { type: "handle", value: m2[1] };
  if (/^UC[0-9A-Za-z_-]{20,}$/.test(token)) return { type: "id", value: token };
  return { type: "handle", value: token.replace(/^@/, "") };
}
async function resolveHandleToChannelId(handle) {
  const res = await yt("search", { part: "snippet", q: `@${handle}`, type: "channel", maxResults: "1" });
  return res.items?.[0]?.id?.channelId || null;
}

// ── Catalog handler ─────────────────────────────────────
// 📺 CATALOG HANDLER — use guaranteed YouTube uploads playlists
builder.defineCatalogHandler(async ({ type, id, extra }) => {
  const channel = CHANNELS.find(c => `youtube-${c.id}` === id);
  if (!channel) return { metas: [] };

  try {
    // Step 1 – get channel’s “uploads” playlist id
    const ch = await yt("channels", {
      part: "contentDetails",
      id: channel.id,
    });
    const uploadsId = ch.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsId) {
      console.warn("No uploads playlist for", channel.name);
      return { metas: [] };
    }

    // Step 2 – fetch videos from that playlist
    const pl = await yt("playlistItems", {
      part: "snippet",
      playlistId: uploadsId,
      maxResults: "50",
    });

    // Step 3 – map results to Stremio metas
    const metas = (pl.items || []).map((item) => {
      const s = item.snippet;
      return {
        id: `yt:${s.resourceId.videoId}`,
        type: "series",
        name: s.title,
        poster:
          s.thumbnails?.high?.url ||
          s.thumbnails?.medium?.url ||
          s.thumbnails?.default?.url,
        background:
          s.thumbnails?.maxres?.url ||
          s.thumbnails?.high?.url ||
          s.thumbnails?.medium?.url,
        description: s.description?.substring(0, 400) || "",
        releaseInfo: new Date(s.publishedAt).getFullYear().toString(),
        posterShape: "landscape",
      };
    });

    return { metas };
  } catch (err) {
    console.error("Uploads fetch failed", channel.name, err);
    return { metas: [] };
  }
});

    }
  }

  // Dynamic saved favorites
  if (id === "youtube-user") {
    const uid = (extra?.uid || "").trim();
    const action = (extra?.action || "load").toLowerCase();
    const query = (extra?.search || "").trim();

    const tokens = query ? extractPossibleIdsOrHandles(query) : [];

    async function resolveAll(tokensArr) {
      const out = [];
      for (const tok of tokensArr) {
        const g = guessChannelIdOrHandle(tok);
        if (g.type === "id") out.push(g.value);
        else {
          try { const cid = await resolveHandleToChannelId(g.value); if (cid) out.push(cid); } catch {}
        }
      }
      return Array.from(new Set(out));
    }

    // No uid → stateless preview from search
    if (!uid) {
      if (!tokens.length) return { metas: [] };
      const channelIds = await resolveAll(tokens);
      const metas = [];
      for (const cid of channelIds) {
        try {
          const res = await yt("search", { part: "snippet", channelId: cid, type: "video", order: "date", maxResults: "20" });
          metas.push(...(res.items || [])
            .filter(it => it?.id?.videoId)
            .map(it => mapSnippet({ ...it.snippet, videoId: it.id.videoId })));
        } catch {}
      }
      return { metas };
    }

    // With uid → load/save/add/remove/clear against JSONBin
    let db = await binLoad();              // { [uid]: string[] }
    db[uid] = db[uid] || [];

    if (action === "clear") {
      db[uid] = [];
      await binSave(db);
    } else if ((action === "save" || action === "add" || action === "remove") && tokens.length) {
      const newIds = await resolveAll(tokens);
      if (action === "save") {
        db[uid] = newIds;
      } else if (action === "add") {
        db[uid] = Array.from(new Set([...(db[uid] || []), ...newIds]));
      } else if (action === "remove") {
        const s = new Set(db[uid] || []);
        newIds.forEach((x) => s.delete(x));
        db[uid] = Array.from(s);
      }
      await binSave(db);
    }

    const channelIds = db[uid] || [];
    if (!channelIds.length) return { metas: [] };

    const metas = [];
    for (const cid of channelIds) {
      try {
        const res = await yt("search", { part: "snippet", channelId: cid, type: "video", order: "date", maxResults: "20" });
        metas.push(...(res.items || [])
          .filter(it => it?.id?.videoId)
          .map(it => mapSnippet({ ...it.snippet, videoId: it.id.videoId })));
      } catch {}
    }
    return { metas };
  }

  return { metas: [] };
});

// ── Meta handler ────────────────────────────────────────
builder.defineMetaHandler(async ({ id }) => {
  const videoId = id.replace(/^yt:/, "");
  try {
    const data = await yt("videos", { part: "snippet,contentDetails,statistics", id: videoId });
    const v = data.items?.[0]; if (!v) return { meta: null };
    const t = v.snippet?.thumbnails || {};
    const poster = t.high?.url || t.medium?.url || t.default?.url || null;
    const views = Number(v.statistics?.viewCount || 0).toLocaleString();
    return {
      meta: {
        id: `yt:${videoId}`,
        type: "series",
        name: v.snippet?.title || "YouTube Video",
        poster,
        description: `${v.snippet?.description || ""}\n\n👁 ${views} views`,
        releaseInfo: v.snippet?.publishedAt?.slice(0, 10) || "",
        posterShape: "landscape",
        videos: [{
          id: `yt:${videoId}:1:1`,
          title: v.snippet?.title || "Episode",
          released: v.snippet?.publishedAt || new Date().toISOString(),
          season: 1, episode: 1
        }]
      }
    };
  } catch (e) {
    console.error("Meta error", e); return { meta: null };
  }
});

// ── Stream handler: open on YouTube ─────────────────────
builder.defineStreamHandler(async ({ id }) => {
  const videoId = String(id).split(":")[1] || String(id).replace(/^yt:/, "");
  return { streams: [{ title: "🎬 Open on YouTube", externalUrl: `https://www.youtube.com/watch?v=${videoId}` }] };
});

/* ───────────────────────────────
   START SERVER + LANDING PAGE
──────────────────────────────── */
import express from "express";

const port = process.env.PORT || 7000;
const addonInterface = builder.getInterface();
const app = express();

// Pretty landing page at "/"
app.get("/", (_req, res) => {
  const base = process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`;
  const manifestUrl = `${base}/manifest.json`;
  const repo = "https://github.com/chreid1973/stremio-youtube-addon";

  res.set("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>YouTube Universe · Stremio Add-on</title>
<style>
  :root{--bg:#0f1115;--card:#151822;--text:#eef2ff;--muted:#a8b3cf;--accent:#ff3355;--link:#7aa2ff}
  *{box-sizing:border-box} body{margin:0;background:linear-gradient(180deg,#0f1115,#0b0d12);color:var(--text);font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto}
  .wrap{max-width:920px;margin:6vh auto;padding:24px}
  .card{background:var(--card);border:1px solid rgba(255,255,255,.06);border-radius:16px;padding:28px;box-shadow:0 10px 30px rgba(0,0,0,.35)}
  h1{margin:0 0 12px;font-size:28px;letter-spacing:.2px}
  p{color:var(--muted);margin:10px 0 18px}
  code{background:#0b0d12;padding:2px 6px;border-radius:6px;border:1px solid rgba(255,255,255,.06)}
  .row{display:flex;gap:12px;flex-wrap:wrap;margin:16px 0 8px}
  .btn{border:1px solid rgba(255,255,255,.12);background:#111420;color:var(--text);padding:10px 14px;border-radius:10px;text-decoration:none;display:inline-flex;gap:8px;align-items:center}
  .btn.primary{background:var(--accent);border-color:transparent}
  .pill{display:inline-block;background:#0b0d12;border:1px solid rgba(255,255,255,.06);padding:6px 10px;border-radius:999px;color:var(--muted);font-size:13px}
  footer{margin-top:14px;color:var(--muted);font-size:13px}
  a{color:var(--link)}
</style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <span class="pill">Stremio Add-on</span>
      <h1>🎬 YouTube Universe</h1>
      <p>Curated YouTube channels by category + your own saved favorites. Per-channel catalogs, persistent favorites via JSONBin. Videos open directly on YouTube.</p>

      <div class="row">
        <a class="btn primary" href="${manifestUrl}">📄 Manifest.json</a>
        <a class="btn" href="${repo}" target="_blank" rel="noopener">⭐ GitHub Repo</a>
      </div>

      <h3>Install in Stremio</h3>
      <p>Copy this URL and paste into <strong>Add-ons → Community → Install via URL</strong>:</p>
      <p><code>${manifestUrl}</code></p>

      <h3>Tips</h3>
      <ul>
        <li><strong>Your YouTube Favorites</strong> → Filter: set <code>uid</code>, pick <code>action</code>, paste <code>@handles</code> or channel URLs.</li>
        <li>Browse creators under Tech / Automotive / Podcasts / Entertainment.</li>
      </ul>

      <footer>Built by <strong>Cary Reid</strong> • YouTube Data API v3 • MIT Licensed</footer>
    </div>
  </div>
</body>
</html>`);
});

// Health check (optional)
app.get("/healthz", (_req, res) => res.json({ ok: true }));

// Hand off everything else (manifest, catalog, meta, stream) to Stremio
app.use((req, res) => addonInterface(req, res));

app.listen(port, () => {
  const base = process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`;
  console.log(`✅ Add-on + landing page running: ${base}/  (manifest: ${base}/manifest.json)`);
});

