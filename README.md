# 🎬 YouTube Universe — A Curated + Personalized Add-on for Stremio

Bring the best of YouTube straight into Stremio — beautifully organized by category, plus a fully personal “Your Favorites” feed that remembers you.

---

## 🌐 Live Add-on Manifest

https://stremio-youtube-addon.onrender.com

Paste that into **Stremio → Add-ons → Community → Install via URL**.

---

## 📺 Categories Included

| Category | Channels |
|-----------|-----------|
| **Tech** | Linus Tech Tips, Short Circuit (LTT), MKBHD |
| **Automotive** | Throttle House |
| **Podcasts** | WVFRM Podcast, Team COCO |
| **Entertainment** | Jimmy Kimmel LIVE, Corridor Crew MAIN |

Each channel appears as its own catalog — no more mixed feeds — and updates automatically when creators upload new videos.

---

## 💫 Your YouTube Favorites — Saved & Personal

Add, load, and manage your own favorite channels directly from Stremio.

1. Open **Your YouTube Favorites** in the add-on list.  
2. Tap the filter icon (top-right).  
3. Use these fields:
   - **uid:** your personal ID (e.g. `alex01`)  
   - **action:** `save`, `load`, `add`, `remove`, or `clear`  
   - **search:** YouTube handles or URLs, separated by commas  
     ```
     @veritasium, https://www.youtube.com/@Kurzgesagt
     ```
4. Click “Search” — your list is saved instantly and reloads next time with the same `uid`.

---

## 🧠 How It Works

- Built with [stremio-addon-sdk](https://github.com/Stremio/stremio-addon-sdk)  
- Powered by the **YouTube Data API v3**  
- Favorites persist securely via **[JSONBin.io](https://jsonbin.io)**  
- Hosted on [Render](https://render.com)

---

## 🛠️ Local Development

```bash
git clone https://github.com/chreid1973/stremio-youtube-addon.git
cd stremio-youtube-addon
npm install
export YOUTUBE_API_KEY=your_youtube_api_key
export JSONBIN_BIN_ID=your_bin_id
export JSONBIN_MASTER_KEY=your_bin_master_key
node index.js

## ☕ Credits

Built by **THE GEEK** — blending tech, entertainment, and open-source creativity.  
Pull requests, forks, and new channel ideas are welcome!

---

### License

MIT © 2025 THE GEEK @ 3 Hole Punch Media
