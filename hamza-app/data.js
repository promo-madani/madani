// Prototype data. In the real app this list comes from the backend (Firestore / API).
// Each record follows the schema described in README.md.

const PLATFORMS = {
  youtube:   { name: 'YouTube',   color: '#ff0000', icon: '▶' },
  facebook:  { name: 'Facebook',  color: '#1877f2', icon: 'f' },
  tiktok:    { name: 'TikTok',    color: '#111111', icon: '♪' },
  instagram: { name: 'Instagram', color: '#d62976', icon: '◎' },
  threads:   { name: 'Threads',   color: '#333333', icon: '@' }
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

// Real Hamza Cartoon Series episodes on YouTube (found via web search, not yet sorted by views).
// The real app gets this list from the YouTube Data API sync instead.
const YOUTUBE_VIDEOS = [
  ['txPnt1pmbVk', 'Sach Ki Barkat',              'stories',  '✅'],
  ['WfsK6K_ix9w', 'Hamza Nay Parhai Barish Ki Dua', 'duas',  '🌧️'],
  ['VYTmB95EDXE', 'Safar Ki Dua',                'duas',     '🚗'],
  ['lw5mt-t90PY', 'Eid Mubarak',                 'ramadan',  '🌙'],
  ['w9jnUyCZJjQ', 'Eagle',                       'learning', '🦅'],
  ['fbG2d47MNBQ', 'Strawberry',                  'learning', '🍓'],
  ['1B0hDSMJ9kI', 'Exercise',                    'learning', '🏃']
].map(([id, title, category, emoji], i) => ({
  id: 'yt-' + id,
  platform: 'youtube',
  url: `https://www.youtube.com/watch?v=${id}`,
  thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
  title, category, emoji,
  featured: i === 0
}));

// Demo entries for other platforms: titles and thumbnails are placeholders, url is empty.
// Real entries are added from the Admin screen (or synced by the backend).
const DEMO_VIDEOS = [
  { id: 'd2',  platform: 'tiktok',    category: 'shorts',   title: 'Hamza ki Pyari Dua',              emoji: '🤲', duration: '0:45', publishedAt: '2026-10-03' },
  { id: 'd3',  platform: 'facebook',  category: 'manners',  title: 'Ammi Abbu ka Adab',               emoji: '❤️', duration: '6:30', publishedAt: '2026-10-02' },
  { id: 'd4',  platform: 'instagram', category: 'shorts',   title: 'Salam Karna Sunnat Hai',          emoji: '👋', duration: '0:30', publishedAt: '2026-10-02' },
  { id: 'd7',  platform: 'threads',   category: 'stories',  title: 'Hamza ne Dost ki Madad ki',       emoji: '🧒', duration: '1:10', publishedAt: '2026-09-29' },
  { id: 'd9',  platform: 'tiktok',    category: 'manners',  title: 'Khana Khane ke Adab',             emoji: '🍽️', duration: '0:58', publishedAt: '2026-09-27' },
  { id: 'd10', platform: 'facebook',  category: 'learning', title: 'Wudu ka Tareeqa',                 emoji: '💧', duration: '5:15', publishedAt: '2026-09-26' },
  { id: 'd11', platform: 'instagram', category: 'duas',     title: 'Ghar se Nikalne ki Dua',          emoji: '🚪', duration: '0:40', publishedAt: '2026-09-25' },
].map(v => ({ ...v, url: '', thumbnail: '', demo: true }));
