<p align="center">
 <img width="256" height="256" alt="image" src="https://github.com/user-attachments/assets/64f2e4e7-81da-4483-88ad-95728c7de5e2" />
</p>

<h1 align="center">🎬 YouTube Universe</h1>

<p align="center">
  <b>A curated + personalized Stremio add-on that brings YouTube into your streaming library</b><br/>
  Watch your favorite creators, organize by category, and even save your own custom channel lists.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-22.x-brightgreen?logo=node.js&logoColor=white" />
  <img src="https://img.shields.io/badge/Render-Deployed-blue?logo=render" />
  <img src="https://img.shields.io/badge/YouTube%20Data%20API-v3-red?logo=youtube" />
  <img src="https://img.shields.io/badge/License-MIT-lightgrey" />
</p>

---

## 🌐 Live Add-on Manifest


https://stremio-youtube-addon.onrender.com


Paste this into **Stremio → Add-ons → Community → Install via URL**.

---

## 📺 Categories Included

Each channel appears in its own catalog for easy browsing.

| Category | Channels |
|-----------|-----------|
| **Tech** | Linus Tech Tips, Short Circuit (LTT), MKBHD |
| **Automotive** | Throttle House |
| **Podcasts** | WVFRM Podcast, Team COCO |
| **Entertainment** | Jimmy Kimmel LIVE, Corridor Crew MAIN |

All feeds update automatically when creators upload new videos.

---

## 💫 Your YouTube Favorites — Saved & Personal

You can add, load, and manage your own favorite channels directly from Stremio.

Per-channel YouTube catalogs by category + easy favorites.\n\n" +
    
    Add your own favorites:\n" +
    1) Open the catalog: “Your YouTube Favorites”.\n" +
    2) Use the big Search box at the top.\n" +
    3) Paste comma-separated channels (handles/URLs/UC IDs), e.g.\n" +
       @mkbhd, @LinusTechTips, https://www.youtube.com/@throttlehouse\n" +
    4) Press Enter. Leave Search empty to use the saved JSONBin list.\n\n" +
    Streams open on YouTube.
uid`.

Favorites persist via secure storage on [JSONBin.io](https://jsonbin.io) — no logins, no personal data collected.

---

## 🧠 How It Works

- Built with [stremio-addon-sdk](https://github.com/Stremio/stremio-addon-sdk)  
- Powered by the **YouTube Data API v3**  
- Persistent user data stored on **[JSONBin.io](https://jsonbin.io)**  
- Hosted on [Render](https://render.com)  
- Licensed under **MIT**

---

## 🛠️ Local Development

```bash
git clone https://github.com/chreid1973/stremio-youtube-addon.git
cd stremio-youtube-addon
npm install

export YOUTUBE_API_KEY=your_youtube_api_key
export JSONBIN_BIN_ID=your_jsonbin_bin_id
export JSONBIN_MASTER_KEY=your_jsonbin_master_key

node index.js

☕ Credits

Built by THE GEEK — blending tech, entertainment, and open-source creativity.
Pull requests, forks, and new channel ideas are welcome!

🪪 License

MIT © 2025 THE GEEK @ 3 Hole Punch Media
See LICENSE for details.
