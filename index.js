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
    { id: "UCFP1dDbFt0B7X6M2xPDj1bA", name: "WVFRM Podcast" },
    { id: "UCEcrRXW3oEYfUctetZTAWLw", name: "Team COCO" }
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
builder.defineCatalogHandler(async ({ id, extra }) => {
  // Per-channel catalogs: id looks like "youtube-<cat>-<UCid>"
  if (id.startsWith("youtube-") && id !== "youtube-user") {
    const parts = id.split("-");
    const channelId = parts[2]; // youtube-<cat>-<UC...>
    if (!channelId) return { metas: [] };
    try {
      const res = await yt("search", {
        part: "snippet",
        channelId,
        type: "video",
        order: "date",
        maxResults: "50"
      });
      const metas = (res.items || [])
        .filter(it => it?.id?.videoId)
        .map(it => mapSnippet({ ...it.snippet, videoId: it.id.videoId }));
      return { metas };
    } catch (e) {
      console.error("Catalog channel fetch failed", channelId, e);
      return { metas: [] };
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

// ── Serve ───────────────────────────────────────────────
const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port });
console.log(`✅ Add-on running: http://localhost:${port}/manifest.json`);
