// Stremio YouTube Universe Add-on — FINAL STABLE index.cjs
// CommonJS build for Render. HTTPS-aware links, CORS enabled, safe SDK routing,
// low‑quota RSS mode, and browser admin UI.

const express = require("express");
const bodyParser = require("body-parser");
const fetch = require("node-fetch"); // v2 (CJS)
const { parseStringPromise } = require("xml2js");
const { addonBuilder } = require("stremio-addon-sdk");

// ---------- Config ----------
const DEFAULT_PORT = parseInt(process.env.PORT || "7000", 10);
const LOW_QUOTA_MODE = process.env.LOW_QUOTA_MODE !== "false";
const ADDON_NAME = "YouTube Universe";
const ADDON_ID = "stremio-youtube-universe";

// In-memory saved lists
const lists = new Map();

// ---------- Helpers ----------
function isChannelId(str) { return /^UC[0-9A-Za-z_-]{22}$/.test(str); }

async function scrapeChannelIdFromPage(pageUrl) {
  try {
    const res = await fetch(pageUrl, { headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html" } });
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/"channelId":"(UC[0-9A-Za-z_-]{22})"/);
    return m ? m[1] : null;
  } catch (_) {
    return null;
  }
}

function tryExtractChannelIdFromUrl(url) {
  try {
    const u = new URL(url);
    const mChannel = u.pathname.match(/^\/channel\/(UC[0-9A-Za-z_-]{22})/);
    if (mChannel) return mChannel[1];
    const mHandle = u.pathname.match(/^\/(@[A-Za-z0-9_.-]+)/);
    if (mHandle) return { handle: mHandle[1] };
    const mUser = u.pathname.match(/^\/user\/([A-Za-z0-9_-]+)/);
    if (mUser) return { user: mUser[1] };
  } catch (_) {}
  return null;
}

async function resolveChannelId(input) {
  const val = (input || "").trim();
  if (isChannelId(val)) return { channelId: val };

  // URL path matching
  let asUrl = null;
  try { asUrl = new URL(val); } catch (_) {}
  if (asUrl) {
    const p = asUrl.pathname;
    const mCh = p.match(/^\/channel\/(UC[0-9A-Za-z_-]{22})/);
    if (mCh) return { channelId: mCh[1] };
    const mHa = p.match(/^\/(@[A-Za-z0-9_.-]+)/);
    if (mHa) {
      const id = await scrapeChannelIdFromPage(`https://www.youtube.com/${mHa[1]}`);
      return id ? { channelId: id } : { error: `Cannot resolve ${mHa[1]}` };
    }
    const mUs = p.match(/^\/user\/([A-Za-z0-9_-]+)/);
    if (mUs) {
      const id = await scrapeChannelIdFromPage(`https://www.youtube.com/user/${mUs[1]}`);
      return id ? { channelId: id } : { error: `Cannot resolve ${mUs[1]}` };
    }
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
  const entries = Array.isArray(feed.feed?.entry) ? feed.feed.entry : (feed.feed?.entry ? [feed.feed.entry] : []);
  const name = feed.feed?.author?.name || `YouTube Channel (${channelId})`;
  const videos = entries.slice(0, limit).map((e, i) => {
    const vid = e["yt:videoId"] || `${channelId}_${i}`;
    return {
      id: `yt:${channelId}:${vid}`,
      title: e.title || `Video ${i + 1}`,
      released: e.published,
      thumbnail: e["media:group"]?.["media:thumbnail"]?.url,
      overview: e["media:group"]?.["media:description"],
    };
  });
  return { name, videos };
}

function buildManifest(baseUrl) {
  const badge = LOW_QUOTA_MODE ? " • 🟡 Low‑quota mode enabled" : "";
  return {
    id: ADDON_ID,
    version: "1.1.2",
    name: ADDON_NAME,
    description: `Paste YouTube channels or @handles to browse via RSS.${badge}`,
    logo: `${baseUrl}/static/logo.png`,
    background: `${baseUrl}/static/bg.png`,
    types: ["series"],
    catalogs: [
      { type: "series", id: "youtube-user", name: "YouTube — Channel", extra: [{ name: "search" }] },
      { type: "series", id: "youtube-list", name: "YouTube — Saved List", extra: [{ name: "list", isRequired: true }] }
    ],
    resources: ["catalog", "meta", "stream"],
    idPrefixes: ["ytchannel:", "yt:"],
  };
}

// ---------- Add-on builder ----------
const builder = new addonBuilder(buildManifest(""));

builder.defineCatalogHandler(async ({ id, extra = {} }) => {
  try {
    if (id === "youtube-user") {
      const query = (extra.search || "").trim();
      if (!query) {
        return { metas: [{ id: "ytchannel:help", type: "series", name: "Paste a YouTube channel URL or @handle in the search box", description: "Examples: @techlinked or https://www.youtube.com/user/LinusTechTips" }] };
      }
      const r = await resolveChannelId(query);
      if (!r.channelId) return { metas: [{ id: "ytchannel:error", type: "series", name: "Could not resolve channel", description: r.error || "Unknown error" }] };
      return { metas: [{ id: `ytchannel:${r.channelId}`, type: "series", name: `Channel ${r.channelId}`, description: "Open to view recent uploads" }] };
    }

    if (id === "youtube-list") {
      const listId = (extra.list || "").trim();
      const set = lists.get(listId) || new Set();
      return { metas: [{ id: `ytlist:${listId}`, type: "series", name: `Saved list: ${listId} (${set.size} channels)` }] };
    }
  } catch (e) {
    return { metas: [{ id: "yt:error", type: "series", name: "Catalog error", description: String(e?.message || e) }] };
  }
  return { metas: [] };
});

builder.defineMetaHandler(async ({ id }) => {
  try {
    if (id.startsWith("ytchannel:")) {
      const channelId = id.replace("ytchannel:", "");
      const feed = await fetchChannelRSS(channelId);
      const { name, videos } = rssToEpisodes(feed, channelId);
      return { meta: { id, type: "series", name, videos } };
    }
    if (id.startsWith("ytlist:")) {
      const listId = id.replace("ytlist:", "");
      const set = lists.get(listId) || new Set();
      const all = [];
      for (const ch of set) {
        try { const feed = await fetchChannelRSS(ch); const { videos } = rssToEpisodes(feed, ch, 15); all.push(...videos); } catch (_) {}
      }
      all.sort((a,b) => new Date(b.released || 0) - new Date(a.released || 0));
      return { meta: { id, type: "series", name: `List ${listId}`, videos: all.slice(0, 120) } };
    }
  } catch (e) {
    return { meta: { id, type: "series", name: "Error", description: String(e?.message || e) } };
  }
  return { meta: { id, type: "series", name: "Unknown" } };
});

builder.defineStreamHandler(async ({ id }) => {
  if (!id.startsWith("yt:")) return { streams: [] };
  const videoId = id.split(":")[2];
  return { streams: [{ title: "Watch on YouTube", externalUrl: `https://www.youtube.com/watch?v=${videoId}` }] };
});

// ---------- Express setup ----------
const app = express();
app.use(bodyParser.json());

// CORS so Stremio Web can fetch our resources
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Trust Render proxy & build https base URLs
app.set("trust proxy", true);
function getBase(req) {
  const proto = (req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0];
  return `${proto}://${req.get("host")}`;
}

// Optional: redirect http→https (but keep OPTIONS free)
app.use((req, res, next) => {
  if (req.method !== "OPTIONS" && req.headers["x-forwarded-proto"] === "http") {
    return res.redirect(301, `https://${req.get("host")}${req.url}`);
  }
  next();
});

// Static placeholders
app.get("/static/logo.png", (_req, res) => res.redirect("https://i.imgur.com/a1m7QYk.png"));
app.get("/static/bg.png", (_req, res) => res.redirect("https://i.imgur.com/jKX1Nry.jpeg"));

// Manifest (uses https-aware base)
app.get(["/manifest", "/manifest.json"], (req, res) => {
  const base = getBase(req);
  res.json(buildManifest(base));
});

// Root landing page
app.get("/", (req, res) => {
  const base = getBase(req);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(`<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<title>YouTube Universe Add-on for Stremio</title>
<style>
  body {font-family:sans-serif;background:#0b1020;color:#e6e9f2;text-align:center;padding:60px;}
  a.button {display:inline-block;padding:12px 24px;margin-top:24px;background:#1b2450;color:#fff;border-radius:8px;text-decoration:none;}
  a.button:hover {background:#22306d;}
</style></head>
<body>
  <h1>🪐 YouTube Universe Add-on for Stremio</h1>
  <p>Server is live ✅</p>
  <p><b>Manifest:</b> <a href="${base}/manifest.json">${base}/manifest.json</a></p>
  <a class="button" href="https://web.strem.io/#/addons">Open Add-ons in Stremio Web</a>
  <p style="margin-top:18px;font-size:14px;opacity:.8">Paste this URL in "+ Add Addon":<br><code>${base}/manifest.json</code></p>
  <p style="margin-top:40px;">Manage your saved lists ➡️ <a href="${base}/admin/my-dev">${base}/admin/my-dev</a></p>
</body></html>`);
});

// Forward addon routes to SDK (one safe gate)
const addonInterface = builder.getInterface();
app.use((req, res, next) => {
  const u = req.url;
  if (u.startsWith("/catalog/") || u.startsWith("/meta/") || u.startsWith("/stream/")) {
    return addonInterface(req, res);
  }
  return next();
});

// ---------- Saved Lists Admin API ----------
app.get("/api/list/:listId", (req, res) => {
  const { listId } = req.params;
  res.json({ listId, channels: Array.from(lists.get(listId) || []) });
});

app.post("/api/list/:listId/add", async (req, res) => {
  const { listId } = req.params;
  const input = String(req.body?.channel || "").trim();
  const r = await resolveChannelId(input);
  if (!r.channelId) return res.status(400).json({ ok: false, error: r.error || "Unable to resolve" });
  const set = lists.get(listId) || new Set();
  set.add(r.channelId); lists.set(listId, set);
  res.json({ ok: true, listId, channels: Array.from(set) });
});

app.post("/api/list/:listId/remove", async (req, res) => {
  const { listId } = req.params;
  const input = String(req.body?.channel || "").trim();
  const r = await resolveChannelId(input);
  const set = lists.get(listId) || new Set();
  if (r.channelId) set.delete(r.channelId);
  lists.set(listId, set);
  res.json({ ok: true, listId, channels: Array.from(set) });
});

// Minimal browser admin UI
app.get("/admin/:listId", (req, res) => {
  const { listId } = req.params;
  const base = getBase(req);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(`<!doctype html><meta charset=utf-8><title>Admin ${listId}</title>
<style>body{font-family:sans-serif;background:#0b1020;color:#e6e9f2;padding:24px}input,button{padding:10px;margin:4px}li{margin:6px 0}</style>
<h2>Manage list: ${listId}</h2>
<p>Discover link: <a target=_blank href="https://web.strem.io/#/discover/series/youtube-list?addon=${encodeURIComponent(base + '/manifest.json')}&extra=list%3A${encodeURIComponent(listId)}">open</a></p>
<input id=i placeholder="@handle or URL"><button id=a>Add</button>
<ul id=u></ul>
<script>const base='${base}', list='${listId}', u=document.getElementById('u');
async function load(){const r=await fetch(base+'/api/list/'+list);const j=await r.json();u.innerHTML='';(j.channels||[]).forEach(c=>{const li=document.createElement('li');li.textContent=c;const b=document.createElement('button');b.textContent='Remove';b.onclick=async()=>{await fetch(base+'/api/list/'+list+'/remove',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({channel:c})});load();};li.appendChild(b);u.appendChild(li);}); if(!(j.channels||[]).length){u.innerHTML='<li>No channels yet. Add one above.</li>';}}
async function add(){const v=document.getElementById('i').value.trim(); if(!v) return; await fetch(base+'/api/list/'+list+'/add',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({channel:v})}); document.getElementById('i').value=''; load();}
document.getElementById('a').onclick=add; load();</script>`);
});

// ---------- Port auto-retry ----------
async function startServer(port) {
  return new Promise((resolve) => {
    const s = app.listen(port, () => resolve({ s, port }))
      .on("error", async (e) => {
        if (e.code === "EADDRINUSE") { resolve(await startServer(port + 1)); }
        else { console.error(e); process.exit(1); }
      });
  });
}

// ---------- Boot ----------
(async () => {
  const { port } = await startServer(DEFAULT_PORT);
  console.log(`HTTP addon at http://127.0.0.1:${port}/manifest.json`);
})();
