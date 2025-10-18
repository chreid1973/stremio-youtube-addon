//-----------------------------
//  YouTube Universe (base)
//-----------------------------
import { createRequire } from "module";
import http from "http";
const require = createRequire(import.meta.url);
const { addonBuilder } = require("stremio-addon-sdk");

//-----------------------------
//  Manifest
//-----------------------------
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

//-----------------------------
//  Build addon
//-----------------------------
const builder = new addonBuilder(manifest);

// Sample catalog handler
builder.defineCatalogHandler(async ({ id }) => {
  if (id === "youtube-demo") {
    return {
      metas: [
        {
          id: "yt:dQw4w9WgXcQ",
          type: "series",
          name: "Rick Astley - Never Gonna Give You Up",
          poster: "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
          description: "Example entry to confirm your addon works"
        }
      ]
    };
  }
  return { metas: [] };
});

// Simple meta handler
builder.defineMetaHandler(async ({ id }) => ({
  meta: {
    id,
    type: "series",
    name: "Sample Meta",
    poster: "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    description: "Demo meta handler"
  }
}));

// Stream handler — opens on YouTube
builder.defineStreamHandler(async ({ id }) => {
  const videoId = id.replace(/^yt:/, "");
  return {
    streams: [{ title: "🎬 Watch on YouTube", externalUrl: `https://www.youtube.com/watch?v=${videoId}` }]
  };
});

//-----------------------------
//  Serve (no express / no serveHTTP)
//-----------------------------
const iface = builder.getInterface();
const port = process.env.PORT || 7000;

const server = http.createServer((req, res) => {
  if (req.url === "/manifest.json") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(manifest));
    return;
  }
  if (typeof iface === "function") return iface(req, res);
  if (iface && typeof iface.serve === "function") return iface.serve(req, res);
  res.statusCode = 500;
  res.end("Invalid Stremio interface");
});

server.listen(port, () => {
  console.log(`✅ Add-on running: http://localhost:${port}/manifest.json`);
});
