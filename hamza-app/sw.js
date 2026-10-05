// Offline cache for the app shell. Thumbnails and embeds still need the network.
const CACHE = 'hamza-v5';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'data.js', 'manifest.json',
  'assets/icon-192.png', 'assets/splash-emblem.webp', 'assets/splash-hamza.webp', 'assets/splash-title.webp',
  'assets/welcome-hamza.webp', 'assets/welcome-title.webp',
  'assets/onboarding-1.webp', 'assets/onboarding-2.webp', 'assets/onboarding-3.webp'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))));
  self.skipWaiting();
});

// On update: drop old caches, take over open pages and reload them so the new version shows
// immediately (pages from an older version can't reload themselves).
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    const updating = keys.some(k => k.startsWith('hamza-') && k !== CACHE);
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
    if (updating) {
      const windows = await self.clients.matchAll({ type: 'window' });
      windows.forEach(w => w.navigate(w.url).catch(() => {}));
    }
  })());
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  // Always revalidate with the server: GitHub Pages lets browsers reuse files for 10 minutes,
  // which would otherwise keep showing the old app after an update.
  e.respondWith(fetch(new Request(e.request.url, { cache: 'no-cache' })).then(res => {
    const copy = res.clone();
    if (res.ok) caches.open(CACHE).then(c => c.put(e.request, copy));
    return res;
  }).catch(() => caches.match(e.request)));
});
