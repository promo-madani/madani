# Hamza Islahi Cartoon – App Prototype

A clickable prototype of the **Hamza Islahi Cartoon** mobile app. The app gathers every
Hamza Islahi video from **YouTube, Facebook, TikTok, Instagram, X (Twitter) and Threads**
into one feed, each shown with a thumbnail.

> **Roman Urdu khulasa:** Yeh app ka *prototype* hai, yani design aur flow dikhane ke liye
> ek working demo. Videos abhi demo data hain. IT section is document ko follow karke asli
> app (backend + Play Store) banayega.

## Official accounts

| Platform | Account |
|---|---|
| YouTube | [@HamzaCartoon-World](https://www.youtube.com/@HamzaCartoon-World) |
| Facebook | [HamzaCartoonWorld](https://www.facebook.com/HamzaCartoonWorld/) |
| Instagram | [@hamzacartoonworld](https://www.instagram.com/hamzacartoonworld/) |

These are listed in `OFFICIAL_ACCOUNTS` in `data.js` and shown on the Home screen as
"Follow Hamza Cartoon World". TikTok, X and Threads accounts still need to be provided.

## How to run

It's plain HTML/CSS/JS with no build step.

```bash
cd hamza-app
python3 -m http.server 8000
# open http://localhost:8000 (best in Chrome mobile view, F12 → device toolbar)
```

Once merged, it's also served by GitHub Pages at `<pages-url>/hamza-app/`, and can be
installed on a phone via "Add to Home Screen" (it's a PWA).

## What the prototype shows

| Screen | Features |
|---|---|
| **Home** | Featured "New Episode" banner, platform filter chips (All / YouTube / Facebook / TikTok / Instagram / X / Threads), categories in English + Urdu, latest-video grid with thumbnail, platform badge, duration and date |
| **Video page** | YouTube plays inside the app (privacy-enhanced embed); other platforms show an "Open in …" button; Favorite, Share, "More like this" |
| **Search** | Search by title, category or platform |
| **Favorites** | Saved on the device |
| **Admin** | Paste any video link → platform auto-detected → thumbnail fetched (YouTube instantly, TikTok via oEmbed) → saved to the feed |

**Prototype-only shortcuts that IT must replace:**
- The 12 videos in `data.js` are **demo placeholders** (generated thumbnails, no real links).
- Admin-added videos and favorites live in the browser's `localStorage`, so each phone sees only its own additions.
- Admin has no login.

## Files

| File | Purpose |
|---|---|
| `index.html` | Screens and layout |
| `styles.css` | Design (brand colors: green `#0f7a4f`, gold `#ffd166`; dark mode supported) |
| `app.js` | Logic: rendering, filters, link detection, thumbnails, favorites, share |
| `data.js` | Platforms, categories, demo videos (replace with the API) |
| `manifest.json`, `sw.js`, `icon.svg` | PWA install + offline shell |

## Production plan for the IT section

### 1. Recommended stack
- **Mobile app:** Flutter (Android + iOS from one codebase). Reuse this prototype's screens 1:1.
- **Backend:** Firebase: Firestore (video list), Cloud Functions (sync + link preview), Cloud Messaging (push), Auth (admin login).
- **Admin panel:** web page (can evolve from this prototype's Admin screen) behind Firebase Auth.

### 2. Video record schema (Firestore collection `videos`)

```json
{
  "platform": "youtube | facebook | tiktok | instagram | x | threads",
  "url": "https://youtu.be/XXXXXXXXXXX",
  "videoId": "XXXXXXXXXXX",
  "title": "Hamza aur Sach Bolna",
  "thumbnail": "https://i.ytimg.com/vi/XXXXXXXXXXX/hqdefault.jpg",
  "category": "stories | manners | duas | ramadan | learning | shorts",
  "duration": "8:12",
  "publishedAt": "2026-10-03T10:00:00Z",
  "featured": false,
  "active": true
}
```

This is the same shape the prototype uses, so `app.js` rendering logic maps directly.

### 3. Getting videos from each platform

| Platform | Method | Notes |
|---|---|---|
| YouTube | **Automatic:** YouTube Data API v3 `playlistItems.list` on the channel's uploads playlist, scheduled Cloud Function (hourly) | Free quota is enough. Thumbnail: `i.ytimg.com/vi/{id}/hqdefault.jpg` |
| Facebook | Graph API `/{page-id}/videos` with a Page access token, **or** admin pastes link | Requires admin access to the official Page + Meta app review |
| Instagram | Instagram Graph API `/{ig-user-id}/media` (Business/Creator account linked to FB Page), **or** paste link | Same Meta app as Facebook |
| TikTok | Admin pastes link → `https://www.tiktok.com/oembed?url=…` returns title + thumbnail | Official Display API needs app approval |
| X (Twitter) | Admin pastes link → server reads Open Graph `og:image` / `og:title` | X API is paid; avoid |
| Threads | Threads API (own account) **or** paste link + Open Graph | |

Link previews (oEmbed / Open Graph) must be fetched **server-side** in a Cloud Function,
because browsers/apps hit CORS and login walls. Store the thumbnail URL (or a copy in
Firebase Storage, since some platforms' thumbnail URLs expire, e.g. Instagram and Facebook CDN links).

### Setup for these accounts
- **YouTube:** resolve the channel ID once with
  `GET https://www.googleapis.com/youtube/v3/channels?part=contentDetails&forHandle=@HamzaCartoon-World&key=API_KEY`.
  The response's `contentDetails.relatedPlaylists.uploads` is the playlist the hourly sync reads with `playlistItems.list`.
- **Facebook + Instagram:** whoever is an admin of the `HamzaCartoonWorld` Facebook Page must create a Meta app,
  link the `@hamzacartoonworld` Instagram account to the Page (it must be a Business/Creator account),
  and generate a long-lived Page access token. Store it as a Cloud Functions secret, never in the app.

### 4. Build steps
1. Create the Firebase project; set up Firestore security rules (public read, admin-only write).
2. Cloud Function: YouTube hourly sync → upsert into `videos`.
3. Cloud Function: `addLink(url, category)` → detect platform (reuse `detectPlatform()` from `app.js`) → fetch oEmbed / OG → save.
4. Admin web panel with login, add/edit/delete/feature videos.
5. Flutter app screens: Home, Video, Search, Favorites (local storage), plus language toggle (Urdu/English).
   Packages: `cloud_firestore`, `cached_network_image`, `youtube_player_iframe`, `url_launcher`, `share_plus`, `firebase_messaging`.
6. Push notification when a new video is added ("Naya Hamza episode aa gaya!").
7. Testing on low-end Android phones; then publish.

### 5. Store & policy checklist
- Google Play developer account ($25 one-time); Apple developer ($99/year, needs a Mac for iOS builds).
- This is a **kids' app**: comply with Google Play **Families Policy** and Apple Kids category (no personal data collection, ads only from certified kid-safe networks, privacy policy URL).
- Use only content and branding owned by / licensed from the Hamza Islahi Cartoon team. Link out or use official embeds; never re-host other platforms' videos.

### 6. Rough timeline
| Phase | Time |
|---|---|
| Backend + YouTube sync + admin panel | 1–2 weeks |
| Flutter app screens | 2–3 weeks |
| Notifications, testing, store submission | 1–2 weeks |
