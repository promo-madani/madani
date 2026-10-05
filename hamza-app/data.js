// Prototype data. In the real app this list comes from the backend (Firestore / API).
// Each record follows the schema described in README.md.

const PLATFORMS = {
  youtube:   { name: 'YouTube',   color: '#ff0000', icon: '▶' },
  facebook:  { name: 'Facebook',  color: '#1877f2', icon: 'f' },
  tiktok:    { name: 'TikTok',    color: '#111111', icon: '♪' },
  instagram: { name: 'Instagram', color: '#d62976', icon: '◎' },
  x:         { name: 'X',         color: '#000000', icon: '𝕏' },
  threads:   { name: 'Threads',   color: '#333333', icon: '@' }
};

const CATEGORIES = [
  { id: 'stories',  name: 'Islahi Stories', urdu: 'اصلاحی کہانیاں', emoji: '📖' },
  { id: 'manners',  name: 'Good Manners',   urdu: 'اچھے اخلاق',      emoji: '🤝' },
  { id: 'duas',     name: 'Duas',           urdu: 'دعائیں',          emoji: '🤲' },
  { id: 'ramadan',  name: 'Ramadan',        urdu: 'رمضان',           emoji: '🌙' },
  { id: 'learning', name: 'Kids Learning',  urdu: 'بچوں کی تعلیم',    emoji: '✏️' },
  { id: 'shorts',   name: 'Shorts & Reels', urdu: 'مختصر ویڈیوز',    emoji: '⚡' }
];

// Demo entries: titles and thumbnails are placeholders, url is empty.
// Real entries are added from the Admin screen (or synced by the backend).
const DEMO_VIDEOS = [
  { id: 'd1',  platform: 'youtube',   category: 'stories',  title: 'Hamza aur Sach Bolna',            emoji: '🗣️', duration: '8:12', publishedAt: '2026-10-03' },
  { id: 'd2',  platform: 'tiktok',    category: 'shorts',   title: 'Hamza ki Pyari Dua',              emoji: '🤲', duration: '0:45', publishedAt: '2026-10-03' },
  { id: 'd3',  platform: 'facebook',  category: 'manners',  title: 'Ammi Abbu ka Adab',               emoji: '❤️', duration: '6:30', publishedAt: '2026-10-02' },
  { id: 'd4',  platform: 'instagram', category: 'shorts',   title: 'Salam Karna Sunnat Hai',          emoji: '👋', duration: '0:30', publishedAt: '2026-10-02' },
  { id: 'd5',  platform: 'youtube',   category: 'duas',     title: 'Sone ki Dua – Hamza ke Saath',    emoji: '🌛', duration: '4:05', publishedAt: '2026-10-01' },
  { id: 'd6',  platform: 'x',         category: 'learning', title: 'Arabic Huroof Seekhein',          emoji: '🔤', duration: '2:20', publishedAt: '2026-09-30' },
  { id: 'd7',  platform: 'threads',   category: 'stories',  title: 'Hamza ne Dost ki Madad ki',       emoji: '🧒', duration: '1:10', publishedAt: '2026-09-29' },
  { id: 'd8',  platform: 'youtube',   category: 'ramadan',  title: 'Hamza ka Pehla Roza',             emoji: '🌙', duration: '10:44', publishedAt: '2026-09-28' },
  { id: 'd9',  platform: 'tiktok',    category: 'manners',  title: 'Khana Khane ke Adab',             emoji: '🍽️', duration: '0:58', publishedAt: '2026-09-27' },
  { id: 'd10', platform: 'facebook',  category: 'learning', title: 'Wudu ka Tareeqa',                 emoji: '💧', duration: '5:15', publishedAt: '2026-09-26' },
  { id: 'd11', platform: 'instagram', category: 'duas',     title: 'Ghar se Nikalne ki Dua',          emoji: '🚪', duration: '0:40', publishedAt: '2026-09-25' },
  { id: 'd12', platform: 'youtube',   category: 'stories',  title: 'Jhoot ka Anjaam',                 emoji: '⚠️', duration: '9:02', publishedAt: '2026-09-24' }
].map(v => ({ ...v, url: '', thumbnail: '', demo: true }));
