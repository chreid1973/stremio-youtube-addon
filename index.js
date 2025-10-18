// ────────────────────────────────────────────────────────────────
//  YouTube Universe — Per-Channel Catalogs + Easy Favorites
//  (SDK-only server; no Express; robust handle/URL parsing)
// ────────────────────────────────────────────────────────────────

import pkg from "stremio-addon-sdk";
import fetch from "node-fetch";

const { addonBuilder, serveHTTP } = pkg;

// ── Environment Vars ────────────────────────────────────────────
// Required:
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

// Optional (used only if user favorites search box is empty):
const JSONBIN_ID  = process.env.JSONBIN_ID || "";
const JSONBIN_KEY = process.env.JSONBIN_KEY || "";

// How many uploads per channel (YouTube caps per request at 50)
const VIDEOS_PER_CHANNEL = Math.min(
  Number(process.env.VIDEOS_PER_CHANNEL) || 20,
  50
);

// ── Channel Groups (curated) ───────────────────────────────────
const CHANNEL_GROUPS = {
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

// ── Manifest ───────────────────────────────────────────────────
const manifest = {
  id: "community.youtube.universe",
  version: "3.3.0",
  name: "YouTube Universe",
  description: [
    "Per-channel YouTube catalogs by category, plus easy favorites.",
    "",
    "Add your favorites:",
    "1) Open: \"Your YouTube Favorites\"",
    "2) Use the Search box at the top",
    "3) Paste comma-separated channels (handles/URLs/UC IDs), e.g.",
    "   @mkbhd, @LinusTechTips, https://www.youtube.com/@throttlehouse",
    "4) Press Enter",
    "",
    "Shortcuts: pack:tech  pack:auto  pack:podcasts  pack:entertainment",
    "",
    "Leave Search empty to use the saved JSONBin list (if configured).",
    "Streams open directly on YouTube."
  ].join("\n"),
  logo: "https://www.youtube.com/s/desktop/d743f786/img/favicon_144x144.png",
  resources: ["catalog", "meta", "stream"],
  types: ["series"],
  idPrefixes: ["yt"],
  catalogs: [
    // One catalog per channel, grouped in the name for tidy browsing
    ...Object.entries(CHANNEL_GROUPS).flatMap(([group, chans]) =>
      chans.map(ch => ({
        type: "series",
        id: `youtube-${group.toLowerCase()}-${ch.id}`,
        name: `YouTube Universe: ${group} – ${ch.name}`
      }))
    ),
    // Favorites via built-in 'search' (appears as the big search box)
    {
      type: "series",
      id: "youtube-user",
      name: "Your YouTube Favorites",
      extra: [{ name: "search", isRequired: false }]
    }
  ]
};

const builder = new addonBuilder(manifest);

// ── Helpers ────────────────────────────────────────────
async function yt(endpoint, params = {}) {
  if (!YOUTUBE_API_KEY) throw new Error("Missing YOUTUBE_API_KEY");
  const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
  url.searchParams.append("key", YOUTUBE_API_KEY);
  for (const [k, v] of Object.entries(params)) url.searchParams.append(k, v);
  const r = await fetch(url);
  if (!r.ok) {
    const body = await r.text();
    console.error("[YT] ERROR", endpoint, r.status, r.statusText, body.slice(0, 200));
    throw new Error(`YT ${endpoint} ${r.status}`);
  }
  return r.json();
}

async function fetchBin() {
  if (!JSONBIN_ID) return [];
  const headers = JSONBIN_KEY ? { "X-Master-Key": JSONBIN_KEY } : {};
  const res = await fetch(`https://api.jsonbin.io/v3/b/${JSONBIN_ID}/latest`, { headers });
  if (!res.ok) return [];
  const data = await res.json();
  // Accept either ["UC..."] or [{ id, name }]
  const arr = data?.record?.channels || [];
  return arr.map(x => (typeof x === "string" ? { id: x, name: x } : x)).filter(Boolean);
}

// Extract @handles, UC ids, channel URLs from any blob of text
function parseChannelTokens(raw) {
  const text = String(raw || "");

  const handles = Array.from(text.matchAll(/@([A-Za-z0-9._-]+)/g))
    .map(m => ({ type: "handle", value: m[1] }));

  const ucIds = Array.from(text.matchAll(/\b(UC[0-9A-Za-z_-]{20,})\b/g))
    .map(m => ({ type: "id", value: m[1] }));

  const urlUC = Array.from(text.matchAll(/youtube\.com\/channel\/(UC[0-9A-Za-z_-]{20,})/gi))
    .map(m => ({ type: "id", value: m[1] }));

  const urlAt = Array.from(text.matchAll(/youtube\.com\/@([A-Za-z0-9._-]+)/gi))
    .map(m => ({ type: "handle", value: m[1] }));

  const loose = text
    .split(/[\s,]+/g)
    .map(s => s.trim())
    .filter(Boolean)
    .map(token => {
      if (/^https?:\/\//i.test(token)) return null; // URLs already handled above
      if (/^UC[0-9A-Za-z_-]{20,}$/.test(token)) return { type: "id", value: token };
      if (token.startsWith("@")) return { type: "handle", value: token.slice(1) };
      return null;
    })
    .filter(Boolean);

  const seen = new Set();
  const all = [...handles, ...ucIds, ...urlUC, ...urlAt, ...loose].filter(t => {
    const key = `${t.type}:${t.value.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return all;
}

// Cache to avoid repeating lookups during a session
const HANDLE_CACHE = new Map();

async function resolveHandlesToIds(tokens) {
  const out = [];

  for (const t of tokens) {
    if (t.type === "id") {
      out.push(t.value);
      continue;
    }

    const handle = t.value.replace(/^@/, "").toLowerCase();
    if (HANDLE_CACHE.has(handle)) {
      out.push(HANDLE_CACHE.get(handle));
      continue;
    }

    // 1-unit call: channels.list with forHandle
    try {
      const ch = await yt("channels", { part: "id", forHandle: handle });
      const cid = ch.items?.[0]?.id;
      if (cid) {
        HANDLE_CACHE.set(handle, cid);
        out.push(cid);
        continue;
      }
    } catch (_) { /* fall through to legacy fallback */ }

    // Legacy fallback only if needed (costly: 100 units)
    try {
      const res = await yt("search", {
        part: "snippet",
        q: `@${handle}`,
        type: "channel",
        maxResults: "1"
      });
      const cid = res.items?.[0]?.id?.channelId;
      if (cid) {
        HANDLE_CACHE.set(handle, cid);
        out.push(cid);
      }
    } catch (_) {
      // swallow; no ID for this token
    }
  }

  // Deduplicate
  return Array.from(new Set(out));
}


async function fetchUploadsMetas(channelId, maxResults = VIDEOS_PER_CHANNEL) {
  const ch = await yt("channels", { part: "contentDetails", id: channelId });
  const uploadsId = ch.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsId) return [];
  const pl = await yt("playlistItems", {
    part: "snippet",
    playlistId: uploadsId,
    maxResults: String(Math.min(maxResults, 50))
  });
  return (pl.items || []).map(item => {
    const s = item.snippet || {};
    const t = s.thumbnails || {};
    return {
      id: `yt:${s.resourceId.videoId}`,
      type: "series",
      name: s.title,
      poster: t.high?.url || t.medium?.url || t.default?.url,
      description: (s.description || "").slice(0, 200),
      posterShape: "landscape"
    };
  });
}

// ── Catalog Handler ────────────────────────────────────
builder.defineCatalogHandler(async ({ id, extra }) => {
  let channels = [];

  // Per-channel catalogs: youtube-<group>-<UCID>
  const match = id.match(/^youtube-(.+?)-([A-Za-z0-9_-]+)$/);
  if (match) {
    const [, group, channelId] = match;
    const groupKey = Object.keys(CHANNEL_GROUPS).find(g => g.toLowerCase() === group);
    const ch = CHANNEL_GROUPS[groupKey]?.find(c => c.id === channelId);
    if (ch) channels = [ch];
  }
  // Favorites via built-in 'search'; fallback to JSONBin if empty
  else if (id === "youtube-user") {
    const raw = (extra?.search || "").trim();

    // Pack shortcuts
    if (raw) {
      const packMatch = raw.match(/^pack:(tech|auto(?:motive)?|podcasts?|entertainment)$/i);
      if (packMatch) {
        const map = {
          tech: "Tech",
          auto: "Automotive",
          automotive: "Automotive",
          podcast: "Podcasts",
          podcasts: "Podcasts",
          entertainment: "Entertainment"
        };
        const group = map[packMatch[1].toLowerCase()];
        if (group && CHANNEL_GROUPS[group]) channels = CHANNEL_GROUPS[group];
      }
    }

    // If not a pack or not found, parse free-form
    if (!channels.length && raw) {
      const parsed = parseChannelTokens(raw);
      const channelIds = await resolveHandlesToIds(parsed);
      channels = channelIds.map(cid => ({ id: cid, name: cid }));
    }

    // If search empty, fall back to JSONBin (optional)
    if (!channels.length && !raw) {
      try { channels = await fetchBin(); }
      catch { channels = []; }
    }
  }

  if (!channels.length) return { metas: [] };

  const metas = [];
  for (const ch of channels) {
    try {
      metas.push(...await fetchUploadsMetas(ch.id, VIDEOS_PER_CHANNEL));
    } catch (e) {
      console.error("Catalog fetch error for", ch.id, e.message);
    }
  }

  return { metas };
});

// ── Meta Handler ───────────────────────────────────────
builder.defineMetaHandler(async ({ id }) => {
  const vid = id.replace("yt:", "");
  try {
    const data = await yt("videos", { part: "snippet,contentDetails,statistics", id: vid });
    const v = data.items?.[0];
    if (!v) return { meta: null };
    const t = v.snippet?.thumbnails || {};
    return {
      meta: {
        id,
        type: "series",
        name: v.snippet.title,
        poster: t.high?.url || t.medium?.url || t.default?.url,
        background: t.maxres?.url || t.high?.url,
        description: `${v.snippet.description || ""}\nViews: ${v.statistics?.viewCount || 0}`,
        videos: [{ id, title: v.snippet.title, season: 1, episode: 1, released: v.snippet.publishedAt }]
      }
    };
  } catch (e) {
    console.error("Meta error", e.message);
    return { meta: null };
  }
});

// ── Stream Handler (open on YouTube) ───────────────────
builder.defineStreamHandler(async ({ id }) => {
  const vid = id.split(":")[1];
  return {
    streams: [{ title: "Open on YouTube", externalUrl: `https://www.youtube.com/watch?v=${vid}` }]
  };
});

// ── Serve with the SDK’s native server (stable) ────────
const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port });
console.log(`✅ Add-on running at http://localhost:${port}/manifest.json`);
