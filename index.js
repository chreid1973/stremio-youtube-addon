import sdk from "stremio-addon-sdk";
import dotenv from "dotenv";
dotenv.config();

const { addonBuilder, serveHTTP } = sdk;

const KEY = process.env.YOUTUBE_API_KEY;
if (!KEY) { console.error("❌ Missing YOUTUBE_API_KEY in .env"); process.exit(1); }

const CHANNELS = [
   { id: "UCXuqSBlHAE6Xw-yeJA0Tunw", name: "Linus Tech Tips" },
  { id: "UCBJycsmduvYEL83R_U4JriQ", name: "MKBHD" },
  { id: "UCyXiDU5qjfOPxgOPeFWGwKw", name: "Throttle House" },
  { id: "UChvC5t6xjUbe3kG0k3H4tYA", name: "Team Coco" }
];

const manifest = {
  id: "community.youtube.channels",
  version: "1.0.6",
  name: "YouTube Channels (Simple)",
  description: "Recent uploads via YouTube Data API v3",
  resources: ["catalog","meta","stream"],
  types: ["series"],
  idPrefixes: ["yt"],
  catalogs: CHANNELS.map(ch => ({
    type: "series",
    id: `youtube-${ch.id}`,
    name: ch.name,
    extra: [{ name: "skip", isRequired: false }]
  }))
};

const builder = new addonBuilder(manifest);

// tiny cache
const cache = new Map();
const TTL = 60000;
const setCache = (k,v,t=TTL)=>cache.set(k,{v,e:Date.now()+t});
const getCache = (k)=>{const x=cache.get(k); if(!x||Date.now()>x.e) return null; return x.v;};

async function yt(endpoint, params) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
  for (const [k,val] of Object.entries(params)) {
    if (val !== undefined && val !== null && val !== "" && val !== "undefined") url.searchParams.set(k,val);
  }
  url.searchParams.set("key", KEY);

  const cacheKey = url.toString();
  const c = getCache(cacheKey); if (c) return c;

  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(()=> "");
    console.error("❌ YT error", res.status, res.statusText, "at", endpoint, text.slice(0,400));
    throw new Error("YT error");
  }
  const json = await res.json(); setCache(cacheKey,json); return json;
}

function mapSnippet(snippet) {
  const t = snippet?.thumbnails || {};
  const poster = t.high?.url || t.medium?.url || t.default?.url || null;
  const bg = t.maxres?.url || t.high?.url || t.medium?.url || poster;
  return {
    id: `yt:${snippet?.resourceId?.videoId || snippet?.videoId || ""}`,
    type: "series",
    name: snippet?.title || "Untitled",
    poster,
    background: bg,
    description: (snippet?.description || "").slice(0,300),
    releaseInfo: snippet?.publishedAt ? new Date(snippet.publishedAt).getFullYear().toString() : "",
    posterShape: "landscape"
  };
}

// Catalog: search.list by channelId (robust & simple)
builder.defineCatalogHandler(async ({ id, extra }) => {
  const ch = CHANNELS.find(c => `youtube-${c.id}` === id);
  if (!ch) return { metas: [] };

  const pageToken = extra?.skip || undefined;
  const params = {
    part: "snippet",
    channelId: ch.id,
    type: "video",
    order: "date",
    maxResults: "50"
  };
  if (pageToken) params.pageToken = pageToken;

  try {
    const search = await yt("search", params);
    const metas = (search.items || [])
      .filter(it => it?.id?.videoId)
      .map(it => mapSnippet({ ...it.snippet, videoId: it.id.videoId }));
    const next = search.nextPageToken ? { skip: search.nextPageToken } : undefined;
    return next ? { metas, next } : { metas };
  } catch (e) {
    console.error("❌ Catalog error", e);
    return { metas: [] };
  }
});

builder.defineMetaHandler(async ({ id }) => {
  const videoId = id.replace(/^yt:/,"");
  try {
    const data = await yt("videos", { part: "snippet,contentDetails,statistics", id: videoId });
    const v = data.items?.[0]; if (!v) return { meta: null };

    const t = v.snippet?.thumbnails || {};
    const poster = t.high?.url || t.medium?.url || t.default?.url || null;
    const bg = t.maxres?.url || t.high?.url || t.medium?.url || poster;

    const iso = v.contentDetails?.duration || "PT0S";
    const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    const h = parseInt(m?.[1]||0,10), mi = parseInt(m?.[2]||0,10), s = parseInt(m?.[3]||0,10);
    const dur = h ? `${h}h ${mi}m` : (mi ? `${mi}m ${s}s` : `${s}s`);

    const views = Number(v.statistics?.viewCount || 0).toLocaleString();

    return { meta: {
      id: `yt:${videoId}`,
      type: "series",
      name: v.snippet?.title || "YouTube Video",
      poster,
      background: bg,
      description: `${v.snippet?.description || ""}\n\n👁 ${views} views • ⏱ ${dur}`,
      releaseInfo: new Date(v.snippet?.publishedAt || Date.now()).getFullYear().toString(),
      posterShape: "landscape",
      videos: [{ id: `yt:${videoId}:1:1`, title: v.snippet?.title || "Episode", released: new Date(v.snippet?.publishedAt || Date.now()).toISOString(), season: 1, episode: 1 }]
    }};
  } catch (e) {
    console.error("❌ Meta error", e);
    return { meta: null };
  }
});

builder.defineStreamHandler(async ({ id }) => {
  const videoId = String(id).split(":")[1] || String(id).replace(/^yt:/, 
"");
  return {
    streams: [
      {
        title: "🎬 Open on YouTube",
        externalUrl: `https://www.youtube.com/watch?v=${videoId}`
      }
    ]
  };
});


const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port });
console.log(`✅ Addon running: http://127.0.0.1:${port}/manifest.json`);
