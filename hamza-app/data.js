// Prototype data. In the real app this list comes from the backend (Firestore / API).
// Each record follows the schema described in README.md.

const PLATFORMS = {
  youtube:   { name: 'YouTube',   color: '#ff0000', icon: '▶' },
  facebook:  { name: 'Facebook',  color: '#1877f2', icon: 'f' },
  tiktok:    { name: 'TikTok',    color: '#111111', icon: '♪' },
  instagram: { name: 'Instagram', color: '#d62976', icon: '◎' }
};

// Official Hamza Cartoon World accounts.
const OFFICIAL_ACCOUNTS = [
  { platform: 'youtube',   handle: '@HamzaCartoon-World', url: 'https://www.youtube.com/@HamzaCartoon-World' },
  { platform: 'facebook',  handle: 'HamzaCartoonWorld',   url: 'https://www.facebook.com/HamzaCartoonWorld/' },
  { platform: 'instagram', handle: '@hamzacartoonworld',  url: 'https://www.instagram.com/hamzacartoonworld/' },
  { platform: 'tiktok',    handle: '@hamzacartoon51226',  url: 'https://www.tiktok.com/@hamzacartoon51226' }
];

const CATEGORIES = [
  { id: 'stories',  name: 'Islahi Stories', urdu: 'اصلاحی کہانیاں', emoji: '📖' },
  { id: 'manners',  name: 'Good Manners',   urdu: 'اچھے اخلاق',      emoji: '🤝' },
  { id: 'duas',     name: 'Duas',           urdu: 'دعائیں',          emoji: '🤲' },
  { id: 'ramadan',  name: 'Ramadan & Eid',  urdu: 'رمضان و عید',          emoji: '🌙' },
  { id: 'learning', name: 'Kids Learning',  urdu: 'بچوں کی تعلیم',    emoji: '✏️' },
  { id: 'shorts',   name: 'Shorts & Reels', urdu: 'مختصر ویڈیوز',    emoji: '⚡' }
];

// Popular Hamza Islahi Cartoon episodes on YouTube, chosen by the channel team.
// Titles, durations and view counts are from the channel page (Oct 2026);
// the real app gets these from the YouTube Data API sync.
const YOUTUBE_VIDEOS = [
  ['8XqLyAAUGSk', 'Hamza Ka Norway Adventure',                     'learning', '✈️', '4:27', '4.6K'],
  ['nQmpF0a3FJI', 'Dhongi Baba Sab Loot Kar Le Gaya',              'stories',  '🧙', '8:08', '83K', true],
  ['nt6_uhLKf3k', 'Ghar Me Chori Hogi',                            'stories',  '🏠', '3:00', '8.1K'],
  ['ZOs9dI76TWI', 'Hamza Apny Dant Kis Tarhan Protect Karta Hai?', 'learning', '🦷', '3:57', '12K'],
  ['FPCsPN_J6Bs', 'Bachay Park Me Home Work Kun Karrhy Hain?',     'manners',  '📚', '6:21', '12K'],
  ['8pwVrI7KIM4', 'Hamza Nay Khullay Paison Ka Kya Kiya?',         'manners',  '🪙', '3:13', '10K']
].map(([id, title, category, emoji, duration, views, featured = false]) => ({
  id: 'yt-' + id,
  platform: 'youtube',
  url: `https://www.youtube.com/watch?v=${id}`,
  thumbnail: `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
  title, category, emoji, duration, views, featured
}));

// Demo entries for other platforms: titles and thumbnails are placeholders, url is empty.
// Real entries are added from the Admin screen (or synced by the backend).
const DEMO_VIDEOS = [
  { id: 'd2',  platform: 'tiktok',    category: 'shorts',   title: 'Hamza ki Pyari Dua',              emoji: '🤲', duration: '0:45', publishedAt: '2026-10-03' },
  { id: 'd3',  platform: 'facebook',  category: 'manners',  title: 'Ammi Abbu ka Adab',               emoji: '❤️', duration: '6:30', publishedAt: '2026-10-02' },
  { id: 'd4',  platform: 'instagram', category: 'shorts',   title: 'Salam Karna Sunnat Hai',          emoji: '👋', duration: '0:30', publishedAt: '2026-10-02' },
  { id: 'd9',  platform: 'tiktok',    category: 'manners',  title: 'Khana Khane ke Adab',             emoji: '🍽️', duration: '0:58', publishedAt: '2026-09-27' },
  { id: 'd10', platform: 'facebook',  category: 'learning', title: 'Wudu ka Tareeqa',                 emoji: '💧', duration: '5:15', publishedAt: '2026-09-26' },
  { id: 'd11', platform: 'instagram', category: 'duas',     title: 'Ghar se Nikalne ki Dua',          emoji: '🚪', duration: '0:40', publishedAt: '2026-09-25' },
].map(v => ({ ...v, url: '', thumbnail: '', demo: true }));
