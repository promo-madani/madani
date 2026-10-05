// Hamza Islahi Cartoon – clickable prototype.
// Storage is localStorage for now; the real app replaces it with the backend (see README.md).

const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
  }
};

const state = {
  platform: 'all',
  category: null,
  favorites: new Set(store.get('hamza.favorites', [])),
  added: store.get('hamza.added', []),
  history: ['home']
};

// Newest admin additions first, then the YouTube catalog, then demo items.
const allVideos = () => [
  ...[...state.added].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)),
  ...YOUTUBE_VIDEOS,
  ...DEMO_VIDEOS
];

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Link helpers ----------

function detectPlatform(url) {
  let host;
  try { host = new URL(url).hostname.replace(/^www\.|^m\./, ''); } catch { return null; }
  if (/(^|\.)youtube\.com$|^youtu\.be$/.test(host)) return 'youtube';
  if (/(^|\.)facebook\.com$|^fb\.watch$/.test(host)) return 'facebook';
  if (/(^|\.)tiktok\.com$/.test(host)) return 'tiktok';
  if (/(^|\.)instagram\.com$/.test(host)) return 'instagram';
  return null;
}

function youtubeId(url) {
  const m = url.match(/(?:youtu\.be\/|[?&]v=|\/(?:shorts|embed|live)\/)([\w-]{11})/);
  return m ? m[1] : null;
}

// TikTok's public oEmbed endpoint returns a thumbnail. Other platforms need the backend.
async function fetchThumbnail(platform, url) {
  if (platform === 'youtube') {
    const id = youtubeId(url);
    return id ? `https://i.ytimg.com/vi/${id}/maxresdefault.jpg` : '';
  }
  if (platform === 'tiktok') {
    try {
      const res = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`);
      if (res.ok) return (await res.json()).thumbnail_url || '';
    } catch { /* blocked or offline – fall back to placeholder */ }
  }
  return '';
}

// Generated placeholder thumbnail for demo items and links without a fetched image.
function placeholderThumb(video, withTitle = true) {
  const p = PLATFORMS[video.platform];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0f7a4f"/><stop offset="1" stop-color="${p.color}"/></linearGradient></defs>
    <rect width="320" height="180" fill="url(#g)"/>
    <circle cx="160" cy="78" r="44" fill="#ffd166"/>
    <text x="160" y="94" font-size="44" text-anchor="middle">${video.emoji || '🎬'}</text>
    ${withTitle ? `<text x="160" y="152" font-family="Arial,sans-serif" font-size="17" font-weight="700" fill="#fff" text-anchor="middle">${escapeHtml(video.title.slice(0, 30))}</text>` : ''}
  </svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

// YouTube's full-size thumbnail (maxresdefault) is missing for some videos, so step down to
// hqdefault first, then to the generated thumbnail (offline, blocked, removed).
const imgTag = (v, withTitle = true) =>
  `<img loading="lazy" src="${v.thumbnail || placeholderThumb(v, withTitle)}" alt="" data-fallback="${v.id}" data-title="${withTitle}" />`;

document.addEventListener('error', e => {
  const img = e.target;
  if (img.tagName !== 'IMG' || !img.dataset.fallback || img.dataset.failed) return;
  const v = allVideos().find(x => x.id === img.dataset.fallback);
  if (!v) return;
  if (img.src.includes('/maxresdefault.jpg')) { img.src = img.src.replace('/maxresdefault.jpg', '/hqdefault.jpg'); return; }
  img.dataset.failed = '1';
  img.src = placeholderThumb(v, img.dataset.title === 'true');
}, true);

// ---------- Rendering ----------

function cardHtml(v) {
  const p = PLATFORMS[v.platform];
  const fav = state.favorites.has(v.id);
  return `<article class="card" data-id="${v.id}" role="button" tabindex="0">
    <div class="thumb">
      ${imgTag(v)}
      <span class="badge" style="background:${p.color}">${p.icon} ${p.name}</span>
      ${v.duration ? `<span class="dur">${v.duration}</span>` : ''}
    </div>
    <button class="fav-btn" data-fav="${v.id}" aria-label="Favorite">${fav ? '⭐' : '☆'}</button>
    <div class="meta"><h4>${escapeHtml(v.title)}</h4><small>${[categoryName(v.category), v.views && `${v.views} views`, formatDate(v.publishedAt)].filter(Boolean).join(' · ')}</small></div>
  </article>`;
}

function renderGrid(el, videos, emptyText) {
  el.innerHTML = videos.length ? videos.map(cardHtml).join('') : `<p class="empty">${emptyText}</p>`;
}

const categoryName = id => (CATEGORIES.find(c => c.id === id) || {}).name || '';
const formatDate = d => d && new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

function renderHero() {
  const vids = allVideos();
  const v = vids.find(x => x.featured) || vids[0];
  if (!v) return;
  $('#hero').dataset.id = v.id;
  $('#hero').innerHTML = `${imgTag(v, false)}
    <div class="overlay"><span class="tag">★ FEATURED</span><h3>${escapeHtml(v.title)}</h3></div>`;
}

function renderChips() {
  const items = [['all', { name: 'All', icon: '★', color: '#0f7a4f' }], ...Object.entries(PLATFORMS)];
  $('#platformChips').innerHTML = items.map(([key, p]) =>
    `<button class="chip ${state.platform === key ? 'active' : ''}" data-platform="${key}">
      <i style="background:${p.color}">${p.icon}</i>${p.name}</button>`).join('');
}

function renderCategories() {
  $('#categoryList').innerHTML = CATEGORIES.map(c =>
    `<button class="cat ${state.category === c.id ? 'active' : ''}" data-cat="${c.id}">
      <span>${c.emoji}</span>${c.name}<small>${c.urdu}</small></button>`).join('');
  $('#addCat').innerHTML = CATEGORIES.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
}

const officialUrl = platform => (OFFICIAL_ACCOUNTS.find(a => a.platform === platform) || {}).url;

function renderSocials() {
  $('#socials').innerHTML = OFFICIAL_ACCOUNTS.map(a => {
    const p = PLATFORMS[a.platform];
    return `<a class="social" href="${a.url}" target="_blank" rel="noopener">
      <i style="background:${p.color}">${p.icon}</i>
      <span><b>${p.name}</b><small>${escapeHtml(a.handle)}</small></span><em>Follow ↗</em></a>`;
  }).join('');
}

function renderFeed() {
  const vids = allVideos().filter(v =>
    (state.platform === 'all' || v.platform === state.platform) &&
    (!state.category || v.category === state.category));
  const parts = [];
  if (state.category) parts.push(categoryName(state.category));
  if (state.platform !== 'all') parts.push(PLATFORMS[state.platform].name);
  $('#feedTitle').textContent = parts.length ? parts.join(' · ') : 'Latest Videos';
  $('#clearCat').hidden = !state.category;
  renderGrid($('#feed'), vids, 'No videos here yet.');
}

function renderSearch() {
  const q = $('#searchInput').value.trim().toLowerCase();
  const vids = q ? allVideos().filter(v =>
    v.title.toLowerCase().includes(q) || categoryName(v.category).toLowerCase().includes(q) || PLATFORMS[v.platform].name.toLowerCase().includes(q)) : [];
  renderGrid($('#searchResults'), vids, q ? 'No matching videos.' : 'Type to search all videos.');
}

function renderFavorites() {
  renderGrid($('#favList'), allVideos().filter(v => state.favorites.has(v.id)), 'Tap ☆ on any video to save it here.');
}

function renderAdmin() {
  renderGrid($('#adminList'), state.added, 'Videos you add will appear here and in the Home feed.');
}

function renderVideo(id) {
  const v = allVideos().find(x => x.id === id);
  if (!v) return;
  const p = PLATFORMS[v.platform];
  const ytId = v.platform === 'youtube' && v.url ? youtubeId(v.url) : null;
  const player = ytId
    ? `<iframe src="https://www.youtube-nocookie.com/embed/${ytId}?rel=0" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen title="${escapeHtml(v.title)}"></iframe>`
    : imgTag(v);
  const fav = state.favorites.has(v.id);
  $('#videoDetail').innerHTML = `<div class="detail">
    <div class="player">${player}</div>
    <h2>${escapeHtml(v.title)}</h2>
    <p class="info">${[`${p.icon} ${p.name}`, categoryName(v.category), v.views && `${v.views} views`, formatDate(v.publishedAt)].filter(Boolean).join(' · ')}</p>
    <div class="actions">
      ${v.url && !ytId ? `<a class="btn" href="${escapeHtml(v.url)}" target="_blank" rel="noopener">Open in ${p.name} ↗</a>` : ''}
      ${v.demo && officialUrl(v.platform) ? `<a class="btn" href="${officialUrl(v.platform)}" target="_blank" rel="noopener">Visit Hamza on ${p.name} ↗</a>` : ''}
      <button class="btn ghost" data-fav="${v.id}">${fav ? '⭐ Saved' : '☆ Favorite'}</button>
      <button class="btn ghost" data-share="${v.id}">📤 Share</button>
    </div>
    ${v.demo ? '<p class="note">Demo item – the real app will play/open the actual video here.</p>' : ''}
    <h2 class="section-title">More like this</h2>
    <div class="grid">${allVideos().filter(x => x.category === v.category && x.id !== v.id).slice(0, 4).map(cardHtml).join('') || '<p class="empty">No related videos.</p>'}</div>
  </div>`;
}

function renderAll() {
  renderHero(); renderChips(); renderCategories(); renderSocials(); renderFeed(); renderFavorites(); renderAdmin();
}

// ---------- Navigation ----------

function show(view, push = true) {
  $$('.view').forEach(s => s.classList.toggle('active', s.dataset.view === view));
  $$('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.go === view));
  if (push && state.history[state.history.length - 1] !== view) state.history.push(view);
  $('#screen').scrollTop = 0;
  if (view === 'search') setTimeout(() => $('#searchInput').focus(), 50);
}

function openVideo(id) {
  renderVideo(id);
  show('video');
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 1800);
}

function toggleFavorite(id) {
  state.favorites.has(id) ? state.favorites.delete(id) : state.favorites.add(id);
  store.set('hamza.favorites', [...state.favorites]);
  toast(state.favorites.has(id) ? 'Added to favorites ⭐' : 'Removed from favorites');
  renderAll();
  if ($('[data-view="video"]').classList.contains('active')) renderVideo(id);
  renderSearch();
}

async function shareVideo(id) {
  const v = allVideos().find(x => x.id === id);
  const data = { title: v.title, text: `Watch "${v.title}" – Hamza Islahi Cartoon`, url: v.url || location.href };
  if (navigator.share) {
    try { await navigator.share(data); } catch { /* cancelled */ }
  } else {
    try { await navigator.clipboard.writeText(data.url); toast('Link copied 📋'); } catch { toast('Sharing not supported'); }
  }
}

// ---------- Events ----------

document.addEventListener('click', e => {
  const t = e.target.closest('[data-fav],[data-share],[data-go],[data-platform],[data-cat],.card,#hero');
  if (!t) return;
  if (t.dataset.fav) { e.stopPropagation(); return toggleFavorite(t.dataset.fav); }
  if (t.dataset.share) return shareVideo(t.dataset.share);
  if (t.dataset.go) return show(t.dataset.go);
  if (t.dataset.platform) { state.platform = t.dataset.platform; renderChips(); return renderFeed(); }
  if (t.dataset.cat) { state.category = state.category === t.dataset.cat ? null : t.dataset.cat; renderCategories(); return renderFeed(); }
  if (t.dataset.id) return openVideo(t.dataset.id);
});

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.classList.contains('card')) openVideo(e.target.dataset.id);
});

$('#clearCat').addEventListener('click', () => { state.category = null; renderCategories(); renderFeed(); });

$('#backBtn').addEventListener('click', () => {
  state.history.pop();
  show(state.history[state.history.length - 1] || 'home', false);
});

$('#searchInput').addEventListener('input', renderSearch);

$('#addUrl').addEventListener('input', e => {
  const p = detectPlatform(e.target.value.trim());
  $('#detected').textContent = 'Platform: ' + (p ? `${PLATFORMS[p].icon} ${PLATFORMS[p].name} ✓` : '— (unsupported link)');
});

$('#addForm').addEventListener('submit', async e => {
  e.preventDefault();
  const url = $('#addUrl').value.trim();
  const platform = detectPlatform(url);
  if (!platform) return toast('Link not from a supported platform');
  if (platform === 'youtube' && !youtubeId(url)) return toast('Could not read YouTube video ID');
  if (state.added.some(v => v.url === url)) return toast('This link is already added');

  const video = {
    id: 'u' + Date.now(),
    platform,
    url,
    title: $('#addTitle').value.trim(),
    category: $('#addCat').value,
    featured: $('#addFeatured').checked,
    publishedAt: new Date().toISOString().slice(0, 10),
    thumbnail: await fetchThumbnail(platform, url),
    emoji: '🎬'
  };
  if (video.featured) state.added.forEach(v => { v.featured = false; });
  state.added.unshift(video);
  store.set('hamza.added', state.added);
  e.target.reset();
  $('#detected').textContent = 'Platform: —';
  renderAll();
  toast('Video saved ✓');
});

// PWA install prompt (Android / desktop Chrome)
let installEvent;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  installEvent = e;
  $('#installBtn').hidden = false;
});
$('#installBtn').addEventListener('click', async () => {
  if (!installEvent) return;
  installEvent.prompt();
  await installEvent.userChoice;
  installEvent = null;
  $('#installBtn').hidden = true;
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

renderAll();
renderSearch();
