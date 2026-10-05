// Prototype data. In the real app this list comes from the backend (Firestore / API).
// Each record follows the schema described in README.md.

const PLATFORMS = {
  youtube:   { name: 'YouTube',   ur: 'یوٹیوب',   color: '#ff0000', icon: '▶' },
  facebook:  { name: 'Facebook',  ur: 'فیس بک',   color: '#1877f2', icon: 'f' },
  tiktok:    { name: 'TikTok',    ur: 'ٹک ٹاک',   color: '#111111', icon: '♪' },
  instagram: { name: 'Instagram', ur: 'انسٹاگرام', color: '#d62976', icon: '◎' },
  threads:   { name: 'Threads',   ur: 'تھریڈز',   color: '#000000', icon: '@' }
};

// Official Hamza Cartoon World accounts.
const OFFICIAL_ACCOUNTS = [
  { platform: 'youtube',   handle: '@HamzaCartoon-World', url: 'https://www.youtube.com/@HamzaCartoon-World' },
  { platform: 'facebook',  handle: 'HamzaCartoonWorld',   url: 'https://www.facebook.com/HamzaCartoonWorld/' },
  { platform: 'instagram', handle: '@hamzacartoonworld',  url: 'https://www.instagram.com/hamzacartoonworld/' },
  { platform: 'tiktok',    handle: '@hamzacartoonworld',  url: 'https://www.tiktok.com/@hamzacartoonworld' },
  { platform: 'threads',   handle: '@hamzacartoonworld',  url: 'https://www.threads.com/@hamzacartoonworld' }
];

const CATEGORIES = [
  { id: 'stories',  name: 'Islahi Stories', urdu: 'اصلاحی کہانیاں' },
  { id: 'manners',  name: 'Good Manners',   urdu: 'اچھے اخلاق' },
  { id: 'learning', name: 'Kids Learning',  urdu: 'بچوں کی تعلیم' },
  { id: 'duas',     name: 'Duas',           urdu: 'دعائیں' },
  { id: 'ramadan',  name: 'Ramadan & Eid',  urdu: 'رمضان و عید' },
  { id: 'shorts',   name: 'Shorts & Reels', urdu: 'مختصر ویڈیوز' }
];

// Popular Hamza Islahi Cartoon episodes on YouTube, chosen by the channel team, newest first.
// Titles, durations and view counts are from the channel page (Oct 2026);
// the real app gets these from the YouTube Data API sync.
const YOUTUBE_VIDEOS = [
  ['8XqLyAAUGSk', 'Hamza Ka Norway Adventure',                     'حمزہ کا ناروے ایڈونچر',                  'learning', '✈️', '4:27', '4.6K'],
  ['nQmpF0a3FJI', 'Dhongi Baba Sab Loot Kar Le Gaya',              'ڈھونگی بابا سب لوٹ کر لے گیا',            'stories',  '🧙', '8:08', '83K', true],
  ['nt6_uhLKf3k', 'Ghar Me Chori Hogi',                            'گھر میں چوری ہوگی',                       'stories',  '🏠', '3:00', '8.1K'],
  ['ZOs9dI76TWI', 'Hamza Apny Dant Kis Tarhan Protect Karta Hai?', 'حمزہ اپنے دانت کس طرح پروٹیکٹ کرتا ہے؟', 'learning', '🦷', '3:57', '12K'],
  ['FPCsPN_J6Bs', 'Bachay Park Me Home Work Kun Karrhy Hain?',     'بچے پارک میں ہوم ورک کیوں کر رہے ہیں؟',   'manners',  '📚', '6:21', '12K'],
  ['8pwVrI7KIM4', 'Hamza Nay Khullay Paison Ka Kya Kiya?',         'حمزہ نے کھلے پیسوں کا کیا کیا؟',          'manners',  '🪙', '3:13', '10K']
].map(([id, title, titleUr, category, emoji, duration, views, featured = false]) => ({
  id: 'yt-' + id,
  platform: 'youtube',
  url: `https://www.youtube.com/watch?v=${id}`,
  thumbnail: `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
  title, titleUr, category, emoji, duration, views, featured
}));

// Demo entries for other platforms: titles and thumbnails are placeholders, url is empty.
// Real entries are added from the Admin screen (or synced by the backend).
const DEMO_VIDEOS = [
  { id: 'd2',  platform: 'tiktok',    category: 'shorts',   title: 'Hamza ki Pyari Dua',     titleUr: 'حمزہ کی پیاری دعا',        emoji: '🤲', duration: '0:45' },
  { id: 'd3',  platform: 'facebook',  category: 'manners',  title: 'Ammi Abbu ka Adab',      titleUr: 'امی ابو کا ادب',          emoji: '❤️', duration: '6:30' },
  { id: 'd4',  platform: 'instagram', category: 'shorts',   title: 'Salam Karna Sunnat Hai', titleUr: 'سلام کرنا سنت ہے',        emoji: '👋', duration: '0:30' },
  { id: 'd9',  platform: 'tiktok',    category: 'manners',  title: 'Khana Khane ke Adab',    titleUr: 'کھانا کھانے کے آداب',      emoji: '🍽️', duration: '0:58' },
  { id: 'd10', platform: 'facebook',  category: 'learning', title: 'Wudu ka Tareeqa',        titleUr: 'وضو کا طریقہ',            emoji: '💧', duration: '5:15' },
  { id: 'd11', platform: 'instagram', category: 'duas',     title: 'Ghar se Nikalne ki Dua', titleUr: 'گھر سے نکلنے کی دعا',      emoji: '🚪', duration: '0:40' }
].map(v => ({ ...v, url: '', thumbnail: '', demo: true }));

// Onboarding slides (artwork from design/onboarding.jpg).
const ONBOARDING = [
  { title: 'مزیدار کہانیاں اور مہمات',        image: 'assets/onboarding-1.webp', bg: 'linear-gradient(180deg, #bde2f2 0%, #e9f4d9 60%, #8fd18a 100%)', dark: false },
  { title: 'اسلامی تعلیم اور اچھی عادات',      image: 'assets/onboarding-2.webp', bg: 'linear-gradient(180deg, #e4c68a 0%, #d8b170 60%, #bb9147 100%)', dark: false },
  { title: 'سائنس اور اللہ تعالیٰ کی نشانیاں', image: 'assets/onboarding-3.webp', bg: 'linear-gradient(180deg, #13447c 0%, #1e4f88 60%, #2c5a8c 100%)', dark: true }
];
