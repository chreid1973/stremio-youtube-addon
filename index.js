// ────────────────────────────────────────────────────────────────
//  YouTube Universe — Per-Channel Catalogs + Easy Favorites (search box)
// ────────────────────────────────────────────────────────────────

import fetch from "node-fetch";
import pkg from "stremio-addon-sdk";
const { addonBuilder, serveHTTP } = pkg;

// ── Environment Vars (Render → Environment) ─────────────────────
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const JSONBIN_ID = process.env.JSONBIN_ID;       // optional, for fallback
const JSONBIN_KEY = process.env.JSONBIN_KEY;     // optional

// ── Channel Groups (curated) ───────────────────────────────────
const CHANNEL_GROUPS = {
  Tech: [
    { id: "UCXuqSBlHAE6Xw-yeJA0Tunw", name: "Linus Tech Tips" },
    { id: "UCdBK94H6oZT2Q7l0-b0xmMg", name: "Short Circuit - LTT" },
    { id: "UCBJycsmduvYEL83R_U4JriQ", name: "MKBHD" }
  ],
  Automotive: [
    { id: "UCyXiDU5qjfOPxgOPeFWGwKw", name: "Throttle House" },
    { id: "UCWqW23Ko6dbscptZYyQE-8A", name: "ZIP TIE TUNING" }
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

// ── Manifest ───────────────────────────────────────────────────
const manifest = {
  id: "community.youtube.universe",
  version: "3.2.0",
  name: "YouTube Universe",
  description: description:
  "Per-channel YouTube catalogs by category + easy favorites.\n\n" +
  "✨ Add your own favorites:\n" +
  "1) Open the catalog: “Your YouTube Favorites”.\n" +
  "2) Use the big Search box at the top.\n" +
  "3) Paste comma-separated channels (handles/URLs/UC IDs), e.g.\n" +
  "   @mkbhd, @LinusTechTips, https://www.youtube.com/@throttlehouse\n" +
  "4) Press Enter. Leave Search empty to use the saved JSONBin list.\n\n" +
  "Streams open directly on YouTube.",
  logo: "https://www.youtube.com/s/desktop/d743f786/img/favicon_144x144.png",
  resources: ["catalog", "meta", "stream"],
  types: ["series"],
  idPrefixes: ["yt"],
  catalogs: [
    // One catalog per CHANNEL (keeps pages clean), grouped in the name
    ...Object.entries(CHANNEL_GROUPS).flatMap(([group, chans]) =>
      chans.map(ch => ({
        type: "series",
        id: `youtube-${group.toLowerCase()}-${ch.id}`,
        name: `YouTube Universe: ${group} – ${ch.name}`
      }))
    ),
    // Favorites: use Stremio's built-in 'search' extra (appears as the big search box)
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
  Object.entries(params).forEach(([k, v]) => url.searchParams.append(k, v));
  const r = await fetch(url);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function fetchBin() {
  if (!JSONBIN_ID) return [];
  const headers = JSONBIN_KEY ? { "X-Master-Key": JSONBIN_KEY } : {};
  const res = await fetch(`https://api.jsonbin.io/v3/b/${JSONBIN_ID}/latest`, { headers });
  if (!res.ok) return [];
  const data = await res.json();
  return data?.record?.channels || [];
}

// Parse a comma-separated string of handles/URLs/UC IDs → [{type,value}]
function parseChannelTokens(raw) {
  return String(raw)
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)
    .map(token => {
      if (/^https?:\/\//i.test(token)) {
        try {
          const u = new URL(token);
          const mUC = u.pathname.match(/\/channel\/(UC[0-9A-Za-z_-]{20,})/i);
          if (mUC) return { type: "id", value: mUC[1] };
          const mAt = u.pathname.match(/@([A-Za-z0-9._-]+)/);
          if (mAt) return { type: "handle", value: mAt[1] };
        } catch {}
      }
      if (/^UC[0-9A-Za-z_-]{20,}$/.test(token)) return { type: "id", value: token };
      if (token.startsWith("@")) return { type: "handle", value: token.slice(1) };
      return { type: "handle", value: token.replace(/^@/, "") };
    });
}

async function resolveHandlesToIds(tokens) {
  const out = [];
  for (const t of tokens) {
    if (t.type === "id") out.push(t.value);
    else {
      try {
        const res = await yt("search", { part: "snippet", q: `@${t.value}`, type: "channel", maxResults: "1" });
        const cid = res.items?.[0]?.id?.channelId;
        if (cid) out.push(cid);
      } catch {}
    }
  }
  return Array.from(new Set(out));
}

async function fetchUploadsMetas(channelId, maxResults = 12) {
  const ch = await yt("channels", { part: "contentDetails", id: channelId });
  const uploadsId = ch.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsId) return [];
  const pl = await yt("playlistItems", { part: "snippet", playlistId: uploadsId, maxResults: String(maxResults) });
  return (pl.items || []).map(item => {
    const s = item.snippet;
    const t = s?.thumbnails || {};
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
  // Favorites: read from built-in 'search' box; fall back to JSONBin if empty
  else if (id === "youtube-user") {
    const raw = (extra?.search || "").trim();
    if (raw) {
      const parsed = parseChannelTokens(raw);
      const channelIds = await resolveHandlesToIds(parsed);
      channels = channelIds.map(cid => ({ id: cid, name: cid }));
    } else {
      try { channels = (await fetchBin()).map(c => (typeof c === "string" ? { id: c, name: c } : c)); }
      catch { channels = []; }
    }
  }

  if (!channels.length) return { metas: [] };

  const metas = [];
  for (const ch of channels) {
    try {
      metas.push(...await fetchUploadsMetas(ch.id, 12));
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
        description: `${v.snippet.description || ""}\n👁 ${v.statistics?.viewCount || 0} views`,
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
    streams: [{ title: "🎬 Open on YouTube", externalUrl: `https://www.youtube.com/watch?v=${vid}` }]
  };
});

// ── Serve with the SDK’s native server (default Stremio page) ─
const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port });
console.log(`✅ Add-on running at http://localhost:${port}/manifest.json`);
