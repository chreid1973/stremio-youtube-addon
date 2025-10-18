# 🎬 YouTube Universe — A Community Add-on for Stremio

**YouTube Universe** lets you watch curated YouTube channels and add your own favorites directly inside Stremio.  
It’s a simple, open-source way to bring your favorite creators into one streaming hub.

---

## 🌐 Live Add-on Manifest

**Install link (for Stremio):**
https://stremio-youtube-addon.onrender.com

## 📺 Categories Included

| Category | Channels |
|-----------|-----------|
| **Tech** | Linus Tech Tips, Short Circuit (LTT), MKBHD |
| **Automotive** | Throttle House |
| **Podcasts** | WVFRM Podcast, Team COCO |
| **Entertainment** | Jimmy Kimmel LIVE, Corridor Crew |

Each catalog automatically updates with the latest videos from those creators.

---

## 💫 Add Your Own Favorites

Look for the **“Your YouTube Favorites”** catalog in Stremio.

There you can:
- Paste one or more YouTube channel URLs  
  (e.g. `https://www.youtube.com/@veritasium`)
- Or type multiple handles separated by commas  
  (e.g. `@veritasium, @CGPGrey, @Kurzgesagt`)

The add-on will fetch your custom feed live from YouTube — no account needed.

---

## 🧠 How It Works

- Built with [stremio-addon-sdk](https://github.com/Stremio/stremio-addon-sdk)
- Powered by the **YouTube Data API v3**
- Hosted on [Render](https://render.com)
- Source code available on [GitHub](https://github.com/chreid1973/stremio-youtube-addon)

---

## 🛠️ For Developers

Clone and run locally:
```bash
git clone https://github.com/chreid1973/stremio-youtube-addon.git
cd stremio-youtube-addon
npm install
export YOUTUBE_API_KEY=your_api_key_here
node index.js
