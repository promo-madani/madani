# Hamza Islahi Cartoon – App Prototype

A clickable prototype of the **Hamza Islahi Cartoon** mobile app. The app gathers every
Hamza Islahi video from **YouTube, Facebook, TikTok, Instagram and Threads**
into one feed, each shown with a thumbnail.

> **Roman Urdu khulasa:** Yeh app ka *prototype* hai, yani design aur flow dikhane ke liye
> ek working demo. YouTube ki 6 videos asli hain; Facebook, TikTok aur Instagram ki videos abhi demo hain. IT section is document ko follow karke asli
> app (backend + Play Store) banayega.

## Official accounts

| Platform | Account |
|---|---|
| YouTube | [@HamzaCartoon-World](https://www.youtube.com/@HamzaCartoon-World) |
| Facebook | [HamzaCartoonWorld](https://www.facebook.com/HamzaCartoonWorld/) |
| Instagram | [@hamzacartoonworld](https://www.instagram.com/hamzacartoonworld/) |
| TikTok | [@hamzacartoonworld](https://www.tiktok.com/@hamzacartoonworld) |
| Threads | [@hamzacartoonworld](https://www.threads.com/@hamzacartoonworld) |

These are listed in `OFFICIAL_ACCOUNTS` in `data.js` and shown on the Home screen as
"Follow Hamza Cartoon World". X (Twitter) is intentionally not included.

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

The whole interface is in **Urdu, right-to-left**, following the approved designs in `design/`.

| Screen | Features |
|---|---|
| **Splash** (`design/splash.jpg`) | Emblem, Hamza and the "حمزہ اصلاحی کارٹون" title, shown for ~1.4 s on every launch |
| **Welcome** (`design/welcome.jpg`) | First launch only: Hamza, "حمزہ کارٹون" logo, tagline, **شروع کریں** (go to onboarding) and **کارٹون دیکھیں** (skip to Home) |
| **Onboarding** (`design/onboarding.jpg`) | 3 swipeable slides with dots, **آگے بڑھیں** / **شروع کریں** and **چھوڑیں**; can be replayed from Profile |
| **Home** (`design/home-screen.jpg`) | Teal header with Hamza avatar and brand, featured video with play button, platform chips (سب / یوٹیوب / فیس بک / ٹک ٹاک / انسٹاگرام / تھریڈز), horizontal rails: **نئی کہانیاں**, **سب سے زیادہ دیکھی گئی** (sorted by views) and one rail per category, each with **سب دیکھیں**; official account links at the bottom |
| **Video page** | YouTube plays inside the app (privacy-enhanced embed) with a "watch on YouTube" link; other platforms open in their app; پسندیدہ, شیئر کریں, مزید ویڈیوز. Back (in-app or phone) returns to the previous screen and stops the video |
| **Search / Favorites** | Search Urdu and Roman titles, categories and platforms; favorites saved on the device |
| **Profile** | App info, follow links, install the app, replay intro, and the team-only **ویڈیو شامل کریں** (Admin) |
| **Admin** | Paste any video link → platform auto-detected → thumbnail fetched (YouTube instantly, TikTok via oEmbed) → saved to the feed |

**Prototype-only shortcuts that IT must replace:**
- `YOUTUBE_VIDEOS` in `data.js` holds 6 real episodes chosen by the channel team, with titles, durations and view counts copied from the channel page. The Urdu-script titles (`titleUr`) are transliterations of the Roman Urdu titles and should be checked by the content team. The production app replaces this list with the YouTube API sync; the popular list can come from `search.list?channelId=…&order=viewCount`.
- Videos for other platforms in `data.js` are **demo placeholders** (generated thumbnails, no real links) and are labelled DEMO in the app.
- Admin-added videos and favorites live in the browser's `localStorage`, so each phone sees only its own additions.
- Admin has no login.

## Files

| File | Purpose |
|---|---|
| `index.html` | Screens and layout |
| `styles.css` | Design (teal `#0f6b66`, gold `#ffd166`, Noto Naskh Arabic / Noto Nastaliq Urdu fonts; dark mode supported) |
| `app.js` | Logic: rendering, filters, link detection, thumbnails, favorites, share |
| `data.js` | Platforms, categories, videos with Urdu titles, onboarding slides (replace videos with the API) |
| `manifest.json`, `sw.js` | PWA install + offline shell. **On every release bump `CACHE` in `sw.js`** (e.g. `hamza-v5` → `hamza-v6`): the new service worker then replaces the old one and reloads open pages, so users see the update on their next open instead of after GitHub Pages' 10-minute browser cache |
| `assets/` | Artwork cropped from the designs: splash (`splash-*.webp`), welcome (`welcome-*.webp`), onboarding (`onboarding-1..3.webp`), app icons (`icon-192/512.png`, `icon-maskable-512.png`, `apple-touch-icon.png` from `design/app-icon.jpg`); `hamza-original.jpg` is the full-size character source (not loaded by the app) |
| `design/` | The approved design mockups (home, onboarding, splash, welcome, app icon). The crops in `assets/` come from these 1376×768 mockups, so ask the design team for the original high-resolution layers before store release |

## Production plan for the IT section

### 1. Recommended stack
- **Mobile app:** Flutter (Android + iOS from one codebase). Reuse this prototype's screens 1:1.
- **Backend:** Firebase: Firestore (video list), Cloud Functions (sync + link preview), Cloud Messaging (push), Auth (admin login).
- **Admin panel:** web page (can evolve from this prototype's Admin screen) behind Firebase Auth.

### 2. Video record schema (Firestore collection `videos`)

```json
{
  "platform": "youtube | facebook | tiktok | instagram | threads",
  "url": "https://youtu.be/nQmpF0a3FJI",
  "videoId": "nQmpF0a3FJI",
  "title": "Dhongi Baba Sab Loot Kar Le Gaya",
  "thumbnail": "https://i.ytimg.com/vi/nQmpF0a3FJI/maxresdefault.jpg",
  "category": "stories | manners | duas | ramadan | learning | shorts",
  "duration": "8:08",
  "views": "83K",
  "publishedAt": "2026-10-02T10:00:00Z",
  "featured": false,
  "active": true
}
```

This is the same shape the prototype uses, so `app.js` rendering logic maps directly.

### 3. Getting videos from each platform

| Platform | Method | Notes |
|---|---|---|
| YouTube | **Automatic:** YouTube Data API v3 `playlistItems.list` on the channel's uploads playlist, scheduled Cloud Function (hourly) | Free quota is enough. Thumbnail: `i.ytimg.com/vi/{id}/maxresdefault.jpg` (fall back to `hqdefault.jpg`) |
| Facebook | Graph API `/{page-id}/videos` with a Page access token, **or** admin pastes link | Requires admin access to the official Page + Meta app review |
| Instagram | Instagram Graph API `/{ig-user-id}/media` (Business/Creator account linked to FB Page), **or** paste link | Same Meta app as Facebook |
| TikTok | Admin pastes link → `https://www.tiktok.com/oembed?url=…` returns title + thumbnail | Official Display API needs app approval |
| Threads | Threads API `/{threads-user-id}/threads` (needs the same Meta app, with the `@hamzacartoonworld` Threads profile connected), **or** admin pastes link → server reads Open Graph `og:image` / `og:title` | |

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
