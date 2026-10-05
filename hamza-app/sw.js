// Offline cache for the app shell. Thumbnails and embeds still need the network.
const CACHE = 'hamza-v4';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'data.js', 'manifest.json',
  'assets/icon-192.png', 'assets/splash-emblem.webp', 'assets/splash-hamza.webp', 'assets/splash-title.webp',
  'assets/welcome-hamza.webp', 'assets/welcome-title.webp',
  'assets/onboarding-1.webp', 'assets/onboarding-2.webp', 'assets/onboarding-3.webp'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(res => {
    const copy = res.clone();
    caches.open(CACHE).then(c => c.put(e.request, copy));
    return res;
  }).catch(() => caches.match(e.request)));
});
