//---------------------------------------------------------
// YouTube Universe — simple, stable Stremio add-on
//---------------------------------------------------------
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");

// ── Manifest ─────────────────────────────────────────────
const manifest = {
  id: "community.youtube.universe",
  version: "1.0.0",
  name: "YouTube Universe",
  description: "Curated YouTube channels by category + favorites",
  logo: "https://www.youtube.com/s/desktop/d743f786/img/favicon_144x144.png",
  resources: ["catalog", "meta", "stream"],
  types: ["series"],
  idPrefixes: ["yt"],
  catalogs: [
    {
      type: "series",
      id: "youtube-demo",
      name: "Demo YouTube Feed"
    }
  ]
};

// ── Builder ──────────────────────────────────────────────
const builder = new addonBuilder(manifest);

// Catalog handler
builder.defineCatalogHandler(async ({ id }) => {
  if (id === "youtube-demo") {
    return {
      metas: [
        {
          id: "yt:dQw4w9WgXcQ",
          type: "series",
          name: "Rick Astley - Never Gonna Give You Up",
          poster: "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
          description: "Test entry to confirm your addon works."
        }
      ]
    };
  }
  return { metas: [] };
});

// Meta handler
builder.defineMetaHandler(async ({ id }) => ({
  meta: {
    id,
    type: "series",
    name: "Sample Meta",
    poster: "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    description: "Demo meta handler works fine!"
  }
}));

// Stream handler
builder.defineStreamHandler(async ({ id }) => {
  const videoId = id.replace(/^yt:/, "");
  return {
    streams: [
      {
        title: "🎬 Watch on YouTube",
        externalUrl: `https://www.youtube.com/watch?v=${videoId}`
      }
    ]
  };
});

// ── Serve ───────────────────────────────────────────────
const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port });
console.log(`✅ Add-on running: http://localhost:${port}/manifest.json`);
