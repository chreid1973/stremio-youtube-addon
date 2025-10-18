// ────────────────────────────────────────────────────────────────
//  YouTube Universe — Stremio Add-on with Categories & JSONBin Favorites
// ────────────────────────────────────────────────────────────────

import fetch from "node-fetch";
import pkg from "stremio-addon-sdk";
const { addonBuilder, serveHTTP } = pkg;

// ── Environment Variables (set these in Render) ────────────────
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const JSONBIN_ID = process.env.JSONBIN_ID;
const JSONBIN_KEY = process.env.JSONBIN_KEY;

// ── Channel Groups ─────────────────────────────────────────────
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
    { id: "UCyXiDU5qjfOPxgOPeFWGwKw", name: "WVFRM Podcast" },
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
  version: "2.0.0",
  name: "YouTube Universe",
  description: "Grouped YouTube channels and user favorites via JSONBin",
  logo: "https://www.youtube.com/s/desktop/d743f786/img/favicon_144x144.png",
  resources: ["catalog", "meta", "stream"],
  types: ["tv", "series"],
  idPrefixes: ["yt"],
  catalogs: [
    ...Object.keys(CHANNEL_GROUPS).map(g => ({
      type: "series",
      id: `youtube-${g.toLowerCase()}`,
      name: `YouTube Universe: ${g}`
    })),
    { type: "series", id: "youtube-user", name: "Your YouTube Favorites" }
  ]
};

const builder = new addonBuilder(manifest);

// ── YouTube Helper ─────────────────────────────────────────────
async function yt(endpoint, params = {}) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
  url.searchParams.append("key", YOUTUBE_API_KEY);
  Object.entries(params).forEach(([k, v]) => url.searchParams.append(k, v));
  const r = await fetch(url);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// ── JSONBin Helper ─────────────────────────────────────────────
async function fetchBin() {
  if (!JSONBIN_ID) return [];
  const headers = JSONBIN_KEY ? { "X-Master-Key": JSONBIN_KEY } : {};
  const res = await fetch(`https://api.jsonbin.io/v3/b/${JSONBIN_ID}/latest`, { headers });
  if (!res.ok) throw new Error("Failed to fetch JSONBin");
  const data = await res.json();
  return data.record.channels || [];
}

// ── Catalog Handler ────────────────────────────────────────────
builder.defineCatalogHandler(async ({ id }) => {
  let channels = [];

  const groupName = Object.keys(CHANNEL_GROUPS).find(g => `youtube-${g.toLowerCase()}` === id);
  if (groupName) channels = CHANNEL_GROUPS[groupName];
  else if (id === "youtube-user") {
    try { channels = await fetchBin(); }
    catch (e) { console.warn("JSONBin fetch failed:", e.message); }
  }

  const metas = [];
  for (const ch of channels) {
    try {
      const channelData = await yt("channels", { part: "contentDetails", id: ch.id });
      const uploadsId = channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
      if (!uploadsId) continue;

      const playlistData = await yt("playlistItems", {
        part: "snippet",
        playlistId: uploadsId,
        maxResults: 12
      });

      for (const item of playlistData.items) {
        metas.push({
          id: `yt:${item.snippet.resourceId.videoId}`,
          type: "series",
          name: item.snippet.title,
          poster: item.snippet.thumbnails.high?.url || item.snippet.thumbnails.default.url,
          description: item.snippet.description.substring(0, 200),
          posterShape: "landscape"
        });
      }
    } catch (e) {
      console.error("Catalog fetch error:", e.message);
    }
  }

  return { metas };
});

// ── Meta Handler ───────────────────────────────────────────────
builder.defineMetaHandler(async ({ id }) => {
  const vid = id.replace("yt:", "");
  try {
    const data = await yt("videos", { part: "snippet,contentDetails,statistics", id: vid });
    const v = data.items[0];
    return {
      meta: {
        id,
        type: "series",
        name: v.snippet.title,
        poster: v.snippet.thumbnails.high?.url,
        background: v.snippet.thumbnails.maxres?.url,
        description: `${v.snippet.description}\n👁 ${v.statistics.viewCount} views`,
        videos: [{ id, title: v.snippet.title }]
      }
    };
  } catch (e) {
    console.error("Meta error:", e.message);
    return { meta: null };
  }
});

// ── Stream Handler ─────────────────────────────────────────────
builder.defineStreamHandler(async ({ id }) => {
  const vid = id.split(":")[1];
  return {
    streams: [
      {
        title: "🎬 Open on YouTube",
        externalUrl: `https://www.youtube.com/watch?v=${vid}`
      }
    ]
  };
});

// ── Serve with the Stremio SDK’s native server ────────────────
const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port });
console.log(`✅ Add-on running at http://localhost:${port}/manifest.json`);
