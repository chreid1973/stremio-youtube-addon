// ────────────────────────────────────────────────────────────────
//  YouTube Universe — Per-Channel Catalogs + Low-Quota Mode
// ────────────────────────────────────────────────────────────────

import pkg from "stremio-addon-sdk";
import fetch from "node-fetch";

const { addonBuilder, serveHTTP } = pkg;

// ── Environment Vars ────────────────────────────────────────────
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || "";
const JSONBIN_ID  = process.env.JSONBIN_ID || "";
const JSONBIN_KEY = process.env.JSONBIN_KEY || "";
const VIDEOS_PER_CHANNEL = Math.min(Number(process.env.VIDEOS_PER_CHANNEL) || 20, 50);
const USE_RSS_FALLBACK = /^(1|true)$/i.test(process.env.USE_RSS_FALLBACK || "");

// ── Channel Groups ──────────────────────────────────────────────
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
  version: "3.4.0",
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
    "Streams open directly on YouTube.",
    USE_RSS_FALLBACK ? "\n🕊 Low-quota mode enabled (RSS + oEmbed)" : ""
  ].join("\n"),
  logo: "https://www.youtube.com/s/desktop/d743f786/img/favicon_144x144.png",
  resources: ["catalog", "meta", "stream"],
  types: ["series"],
  idPrefixes: ["yt"],
  catalogs: [
    ...Object.entries(CHANNEL_GROUPS).flatMap(([group, chans]) =>
      chans.map(ch => ({
        type: "series",
        id: `youtube-${group.toLowerCase()}-${ch.id}`,
        name: `YouTube Universe: ${group} – ${ch.name}`
      }))
    ),
    {
      type: "series",
      id: "youtube-user",
      name: "Your YouTube Favorites",
      extra: [{ name: "search", isRequired: false }]
    }
  ]
};

const builder = new addonBuilder(manifest);

// ── YouTube API Helper (normal mode) ─────────────────────────────
async function yt(endpoint, params = {}) {
  if (!YOUTUBE_API_KEY) throw new Error("Missing YOUTUBE_API_KEY");
  const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
  url.searchParams.append("key", YOUTUBE_API_KEY);
  for (const [k, v] of Object.entries(params)) url.searchParams.append(k, v);
  const r = await fetch(url);
  if (!r.ok) {
    const body = await r.text();
    console.error("[YT] ERROR", endpoint, r.status, r.statusText, body.slice(0, 120));
    throw new Error(`YT ${endpoint} ${r.status}`);
  }
  return r.json();
}

// ── JSONBin Fallback (optional) ─────────────────────────────────
async function fetchBin() {
  if (!JSONBIN_ID) return [];
  const headers = JSONBIN_KEY ? { "X-Master-Key": JSONBIN_KEY } : {};
  const res = await fetch(`https://api.jsonbin.io/v3/b/${JSONBIN_ID}/latest`, { headers });
  if (!res.ok) return [];
  const data = await res.json();
  return (data?.record?.channels || []).map(x =>
    typeof x === "string" ? { id: x, name: x } : x
  );
}

// ── LOW-QUOTA HELPERS (no API key) ─────────────────────────────
async function scrapeHandleToId(handle) {
  const h = String(handle).replace(/^@/, "");
  const url = `https://www.youtube.com/@${encodeURIComponent(h)}`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`scrape ${res.status}`);
  const html = await res.text();
  const m = html.match(/"channelId":"(UC[0-9A-Za-z_-]{20,})"/);
  return m ? m[1] : null;
}

async function fetchUploadsMetasRSS(channelId, maxResults = VIDEOS_PER_CHANNEL) {
  const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  const r = await fetch(feedUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!r.ok) throw new Error(`rss ${r.status}`);
  const xml = await r.text();
  const entries = xml.split("<entry>").slice(1);
  const metas = [];
  for (const e of entries.slice(0, Math.min(maxResults, 50))) {
    const vid = (e.match(/<yt:videoId>([^<]+)<\/yt:videoId>/) || [])[1];
    const title = (e.match(/<title>([^<]+)<\/title>/) || [])[1];
    const thumb = (e.match(/media:thumbnail[^>]+url="([^"]+)"/) || [])[1];
    if (!vid) continue;
    metas.push({
      id: `yt:${vid}`,
      type: "series",
      name: title || vid,
      poster: thumb,
      description: "",
      posterShape: "landscape"
    });
  }
  return metas;
}

async function oembedMeta(videoId) {
  const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&format=json`;
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!r.ok) return null;
  return await r.json();
}

// ── Handle / ID Parsing ─────────────────────────────────────────
function parseChannelTokens(raw) {
  const text = String(raw || "");
  const out = [];

  const push = (t, v) => out.push({ type: t, value: v });

  text.split(/[\s,]+/).forEach(token => {
    token = token.trim();
    if (!token) return;
    if (/^UC[0-9A-Za-z_-]{20,}$/.test(token)) push("id", token);
    else if (token.startsWith("@")) push("handle", token.slice(1));
    else if (token.includes("youtube.com/")) {
      const m1 = token.match(/channel\/(UC[0-9A-Za-z_-]{20,})/);
      const m2 = token.match(/@([A-Za-z0-9._-]+)/);
      if (m1) push("id", m1[1]);
      else if (m2) push("handle", m2[1]);
    }
  });
  return out;
}

const HANDLE_CACHE = new Map();

async function resolveHandlesToIds(tokens) {
  const out = [];
  for (const t of tokens) {
    if (t.type === "id") { out.push(t.value); continue; }

    const handle = t.value.toLowerCase();
    if (HANDLE_CACHE.has(handle)) { out.push(HANDLE_CACHE.get(handle)); continue; }

    if (USE_RSS_FALLBACK) {
      try {
        const cid = await scrapeHandleToId(handle);
        if (cid) { HANDLE_CACHE.set(handle, cid); out.push(cid); }
      } catch (_) {}
      continue;
    }

    // normal API path (cheap forHandle; fallback to search)
    try {
      const ch = await yt("channels", { part: "id", forHandle: handle });
      const cid = ch.items?.[0]?.id;
      if (cid) { HANDLE_CACHE.set(handle, cid); out.push(cid); continue; }
    } catch (_) {}

    try {
      const res = await yt("search", { part: "snippet", q: `@${handle}`, type: "channel", maxResults: "1" });
      const cid = res.items?.[0]?.id?.channelId;
      if (cid) { HANDLE_CACHE.set(handle, cid); out.push(cid); }
    } catch (_) {}
  }
  return Array.from(new Set(out));
}

// ── Uploads Fetcher (auto-fallback) ─────────────────────────────
async function fetchUploadsMetas(channelId, maxResults = VIDEOS_PER_CHANNEL) {
  if (USE_RSS_FALLBACK) {
    try { return await fetchUploadsMetasRSS(channelId, maxResults); }
    catch (e) { console.error("RSS fetch error", channelId, e.message); return []; }
  }
  try {
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
  } catch (e) {
    console.warn("[API] fallback to RSS for", channelId, e.message);
    try { return await fetchUploadsMetasRSS(channelId, maxResults); }
    catch (e2) { console.error("RSS fallback failed", channelId, e2.message); return []; }
  }
}

// ── Catalog Handler ─────────────────────────────────────────────
builder.defineCatalogHandler(async ({ id, extra }) => {
  let channels = [];

  const match = id.match(/^youtube-(.+?)-([A-Za-z0-9_-]+)$/);
  if (match) {
    const [, group, channelId] = match;
    const g = Object.keys(CHANNEL_GROUPS).find(x => x.toLowerCase() === group);
    const ch = CHANNEL_GROUPS[g]?.find(c => c.id === channelId);
    if (ch) channels = [ch];
  }
  else if (id === "youtube-user") {
    const raw = (extra?.search || "").trim();
    if (raw) {
      const pack = raw.match(/^pack:(tech|auto|automotive|podcasts?|entertainment)$/i);
      if (pack) {
        const m = { tech:"Tech",auto:"Automotive",automotive:"Automotive",podcast:"Podcasts",podcasts:"Podcasts",entertainment:"Entertainment" };
        const g = m[pack[1].toLowerCase()];
        if (g) channels = CHANNEL_GROUPS[g];
      }
    }
    if (!channels.length && raw) {
      const parsed = parseChannelTokens(raw);
      const ids = await resolveHandlesToIds(parsed);
      channels = ids.map(cid => ({ id: cid, name: cid }));
    }
    if (!channels.length && !raw) {
      try { channels = await fetchBin(); } catch { channels = []; }
    }
  }

  if (!channels.length) return { metas: [] };

  const metas = [];
  for (const ch of channels) {
    try {
      metas.push(...await fetchUploadsMetas(ch.id, VIDEOS_PER_CHANNEL));
    } catch (e) {
      console.error("Catalog fetch error", ch.id, e.message);
    }
  }
  return { metas };
});

// ── Meta Handler ───────────────────────────────────────────────
builder.defineMetaHandler(async ({ id }) => {
  const vid = id.replace("yt:", "");

  if (USE_RSS_FALLBACK) {
    const oe = await oembedMeta(vid);
    if (!oe) return { meta: null };
    return { meta: {
      id, type: "series",
      name: oe.title,
      poster: oe.thumbnail_url,
      background: oe.thumbnail_url,
      description: `${oe.title}\nby ${oe.author_name}`,
      posterShape: "landscape",
      videos: [{ id, title: oe.title, season: 1, episode: 1 }]
    }};
  }

  try {
    const data = await yt("videos", { part: "snippet,contentDetails,statistics", id: vid });
    const v = data.items?.[0];
    if (!v) return { meta: null };
    const t = v.snippet?.thumbnails || {};
    return { meta: {
      id, type: "series",
      name: v.snippet.title,
      poster: t.high?.url || t.medium?.url || t.default?.url,
      background: t.maxres?.url || t.high?.url,
      description: `${v.snippet.description || ""}\nViews: ${v.statistics?.viewCount || 0}`,
      posterShape: "landscape",
      videos: [{ id, title: v.snippet.title, season: 1, episode: 1, released: v.snippet.publishedAt }]
    }};
  } catch (e) {
    console.warn("[API] meta fallback via oEmbed", e.message);
    const oe = await oembedMeta(vid);
    if (!oe) return { meta: null };
    return { meta: {
      id, type: "series",
      name: oe.title,
      poster: oe.thumbnail_url,
      background: oe.thumbnail_url,
      description: `${oe.title}\nby ${oe.author_name}`,
      posterShape: "landscape",
      videos: [{ id, title: oe.title, season: 1, episode: 1 }]
    }};
  }
});

// ── Stream Handler ─────────────────────────────────────────────
builder.defineStreamHandler(async ({ id }) => {
  const vid = id.split(":")[1];
  return {
    streams: [{ title: "Open on YouTube", externalUrl: `https://www.youtube.com/watch?v=${vid}` }]
  };
});

// ── Serve ──────────────────────────────────────────────────────
const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port });
console.log(`✅ YouTube Universe running on http://localhost:${port}/manifest.json ${USE_RSS_FALLBACK ? "(Low-quota mode)" : ""}`);
