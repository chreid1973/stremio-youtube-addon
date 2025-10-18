import sdk from "stremio-addon-sdk";
const { addonBuilder, serveHTTP } = sdk;
import fetch from "node-fetch";

/* ───────────────────────────────
   CONFIG
──────────────────────────────── */
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

/* ───────────────────────────────
   CATEGORY DEFINITIONS
──────────────────────────────── */
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

/* ───────────────────────────────
   MANIFEST
──────────────────────────────── */
const manifest = {
  id: "community.youtube.universe",
  version: "2.0.0",
  name: "YouTube Universe",
  description: "Curated YouTube channels + your own favorites",
  logo: "https://www.youtube.com/s/desktop/d743f786/img/favicon_144x144.png",
  types: ["series"],
  resources: ["catalog", "meta", "stream"],
  idPrefixes: ["yt"],
  catalogs: [],
  behaviorHints: { configurable: false, configurationRequired: false }
};

/* Generate one catalog per category */
for (const [cat] of Object.entries(CATEGORIES)) {
  manifest.catalogs.push({
    type: "series",
    id: `youtube-${cat.toLowerCase()}`,
    name: `${cat} Channels`
  });
}

/* Add dynamic “Your Favorites” catalog */
manifest.catalogs.push({
  type: "series",
  id: "youtube-user",
  name: "Your YouTube Favorites",
  extra: [{ name: "search", isRequired: false }]
});

const builder = new addonBuilder(manifest);

/* ───────────────────────────────
   HELPERS
──────────────────────────────── */
async function yt(endpoint, params = {}) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
  url.searchParams.append("key", YOUTUBE_API_KEY);
  Object.entries(params).forEach(([k, v]) => url.searchParams.append(k, v));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`YouTube API error ${res.status}`);
  return res.json();
}

function mapSnippet(snippet) {
  return {
    id: `yt:${snippet.videoId}`,
    type: "series",
    name: snippet.title,
    poster: snippet.thumbnails?.high?.url || snippet.thumbnails?.default?.url,
    background:
      snippet.thumbnails?.maxres?.url ||
      snippet.thumbnails?.high?.url ||
      snippet.thumbnails?.default?.url,
    description: snippet.description?.substring(0, 300) || "",
    releaseInfo: snippet.publishedAt?.slice(0, 10),
    posterShape: "landscape"
  };
}

function extractPossibleIdsOrHandles(input) {
  return String(input)
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}
function guessChannelIdOrHandle(token) {
  const m1 = token.match(/\/channel\/(UC[0-9A-Za-z_-]{20,})/i);
  if (m1) return { type: "id", value: m1[1] };
  const m2 = token.match(/@([A-Za-z0-9._-]+)/);
  if (m2) return { type: "handle", value: m2[1] };
  if (/^UC[0-9A-Za-z_-]{20,}$/.test(token))
    return { type: "id", value: token };
  return { type: "handle", value: token.replace(/^@/, "") };
}
async function resolveHandleToChannelId(handle) {
  const res = await yt("search", {
    part: "snippet",
    q: `@${handle}`,
    type: "channel",
    maxResults: "1"
  });
  return res.items?.[0]?.id?.channelId || null;
}

/* ───────────────────────────────
   CATALOG HANDLER
──────────────────────────────── */
builder.defineCatalogHandler(async ({ id, extra }) => {
  const results = [];

  /* Static categories */
  const category = Object.keys(CATEGORIES).find(
    (k) => `youtube-${k.toLowerCase()}` === id
  );
  if (category) {
    for (const ch of CATEGORIES[category]) {
      try {
        const res = await yt("search", {
          part: "snippet",
          channelId: ch.id,
          type: "video",
          order: "date",
          maxResults: "20"
        });
        results.push(
          ...(res.items || [])
            .filter((it) => it.id?.videoId)
            .map((it) => mapSnippet({ ...it.snippet, videoId: it.id.videoId }))
        );
      } catch (err) {
        console.warn("Catalog fetch failed", ch.id, err);
      }
    }
    return { metas: results };
  }

  /* Dynamic user catalog */
  if (id === "youtube-user") {
    const query = extra?.search;
    if (!query) return { metas: [] };

    const tokens = extractPossibleIdsOrHandles(query);
    const channelIds = [];
    for (const tok of tokens) {
      const guess = guessChannelIdOrHandle(tok);
      if (guess.type === "id") channelIds.push(guess.value);
      else if (guess.type === "handle") {
        try {
          const cid = await resolveHandleToChannelId(guess.value);
          if (cid) channelIds.push(cid);
        } catch (e) {
          console.warn("handle resolve failed:", guess.value);
        }
      }
    }

    const unique = [...new Set(channelIds)];
    for (const cid of unique) {
      try {
        const res = await yt("search", {
          part: "snippet",
          channelId: cid,
          type: "video",
          order: "date",
          maxResults: "20"
        });
        results.push(
          ...(res.items || [])
            .filter((it) => it.id?.videoId)
            .map((it) => mapSnippet({ ...it.snippet, videoId: it.id.videoId }))
        );
      } catch (err) {
        console.warn("User fetch failed", cid, err);
      }
    }
    return { metas: results };
  }

  return { metas: [] };
});

/* ───────────────────────────────
   META HANDLER
──────────────────────────────── */
builder.defineMetaHandler(async ({ id }) => {
  const videoId = id.replace("yt:", "");
  try {
    const res = await yt("videos", {
      part: "snippet,contentDetails,statistics",
      id: videoId
    });
    const v = res.items?.[0];
    if (!v) return { meta: null };

    const views = parseInt(v.statistics.viewCount || "0").toLocaleString();
    const meta = {
      id: `yt:${videoId}`,
      type: "series",
      name: v.snippet.title,
      poster:
        v.snippet.thumbnails?.high?.url ||
        v.snippet.thumbnails?.default?.url,
      description: `${v.snippet.description}\n\n👁 ${views} views`,
      releaseInfo: v.snippet.publishedAt?.slice(0, 10),
      posterShape: "landscape",
      videos: [
        {
          id: `yt:${videoId}:1:1`,
          title: v.snippet.title,
          released: v.snippet.publishedAt
        }
      ]
    };
    return { meta };
  } catch (err) {
    console.error("Meta error", err);
    return { meta: null };
  }
});

/* ───────────────────────────────
   STREAM HANDLER
──────────────────────────────── */
builder.defineStreamHandler(async ({ id }) => {
  const videoId = id.split(":")[1] || id;
  return {
    streams: [
      {
        title: "🎬 Open on YouTube",
        externalUrl: `https://www.youtube.com/watch?v=${videoId}`
      }
    ]
  };
});

/* ───────────────────────────────
   START SERVER
──────────────────────────────── */
const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port });
console.log(`✅ Add-on running on http://localhost:${port}/manifest.json`);
