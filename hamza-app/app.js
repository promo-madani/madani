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
  scroll: {}
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
function placeholderThumb(video) {
  const p = PLATFORMS[video.platform];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0f7a4f"/><stop offset="1" stop-color="${p.color}"/></linearGradient></defs>
    <rect width="320" height="180" fill="url(#g)"/>
    <circle cx="160" cy="90" r="48" fill="#ffd166"/>
    <text x="160" y="107" font-size="48" text-anchor="middle">${video.emoji || '🎬'}</text>
  </svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

// YouTube's full-size thumbnail (maxresdefault) is missing for some videos, so step down to
// hqdefault first, then to the generated thumbnail (offline, blocked, removed).
const imgTag = v =>
  `<img loading="lazy" src="${v.thumbnail || placeholderThumb(v)}" alt="" data-fallback="${v.id}" />`;

document.addEventListener('error', e => {
  const img = e.target;
  if (img.tagName !== 'IMG' || !img.dataset.fallback || img.dataset.failed) return;
  const v = allVideos().find(x => x.id === img.dataset.fallback);
  if (!v) return;
  if (img.src.includes('/maxresdefault.jpg')) { img.src = img.src.replace('/maxresdefault.jpg', '/hqdefault.jpg'); return; }
  img.dataset.failed = '1';
  img.src = placeholderThumb(v);
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
      ${v.demo ? '<span class="demo-tag">DEMO</span>' : ''}
    </div>
    <button class="fav-btn" data-fav="${v.id}" aria-label="${fav ? 'Remove from favorites' : 'Add to favorites'}">${fav ? '⭐' : '☆'}</button>
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
  $('#hero').setAttribute('aria-label', `Play ${v.title}`);
  $('#hero').innerHTML = `${imgTag(v)}
    <div class="overlay"><span class="tag">★ ${v.views ? 'MOST WATCHED' : 'FEATURED'}</span><h3>${escapeHtml(v.title)}</h3>
    <span class="play">▶ Watch now</span></div>`;
}

function renderChips() {
  const items = [['all', { name: 'All', icon: '★', color: '#0f7a4f' }], ...Object.entries(PLATFORMS)];
  $('#platformChips').innerHTML = items.map(([key, p]) =>
    `<button class="chip ${state.platform === key ? 'active' : ''}" data-platform="${key}" aria-pressed="${state.platform === key}">
      <i style="background:${p.color}">${p.icon}</i>${p.name}</button>`).join('');
}

function renderCategories() {
  const counts = {};
  allVideos().forEach(v => { counts[v.category] = (counts[v.category] || 0) + 1; });
  $('#categoryList').innerHTML = CATEGORIES.filter(c => counts[c.id]).map(c =>
    `<button class="cat ${state.category === c.id ? 'active' : ''}" data-cat="${c.id}" aria-pressed="${state.category === c.id}">
      <span>${c.emoji}</span>${c.name}<small lang="ur" dir="rtl">${c.urdu}</small><em>${counts[c.id]} ${counts[c.id] === 1 ? 'video' : 'videos'}</em></button>`).join('');
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
  $('#feedTitle').textContent = parts.length ? parts.join(' · ') : 'All Videos';
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
      ${v.url ? `<a class="btn" href="${escapeHtml(v.url)}" target="_blank" rel="noopener">${ytId ? 'Watch on YouTube' : `Open in ${p.name}`} ↗</a>` : ''}
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

const currentView = () => $('.view.active').dataset.view;

function show(view) {
  const from = currentView();
  if (from !== 'video') state.scroll[from] = $('#screen').scrollTop;
  if (view !== 'video') $('#videoDetail').innerHTML = ''; // stops the player
  $$('.view').forEach(s => s.classList.toggle('active', s.dataset.view === view));
  $$('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.go === view));
  $('#screen').scrollTop = view === 'video' ? 0 : state.scroll[view] || 0;
  if (view === 'search' && !$('#searchInput').value) setTimeout(() => $('#searchInput').focus(), 50);
}

function goTab(view) {
  if (view === currentView()) { $('#screen').scrollTo({ top: 0, behavior: 'smooth' }); return; }
  if (currentView() === 'video') history.replaceState({ view }, '', '#' + view);
  else history.pushState({ view }, '', '#' + view);
  show(view);
}

function openVideo(id) {
  history.pushState({ view: 'video', id }, '', '#video');
  renderVideo(id);
  show('video');
}

window.addEventListener('popstate', e => {
  const s = e.state || { view: 'home' };
  if (s.view === 'video') renderVideo(s.id);
  show(s.view);
});

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
  renderSearch();
  $$(`[data-fav="${id}"]`).forEach(b => {
    const on = state.favorites.has(id);
    b.textContent = b.classList.contains('fav-btn') ? (on ? '⭐' : '☆') : (on ? '⭐ Saved' : '☆ Favorite');
  });
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
  if (t.dataset.go) return goTab(t.dataset.go);
  if (t.dataset.platform) { state.platform = t.dataset.platform; renderChips(); return renderFeed(); }
  if (t.dataset.cat) { state.category = state.category === t.dataset.cat ? null : t.dataset.cat; renderCategories(); return renderFeed(); }
  if (t.dataset.id) return openVideo(t.dataset.id);
});

document.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && (e.target.classList.contains('card') || e.target.id === 'hero')) {
    e.preventDefault();
    openVideo(e.target.dataset.id);
  }
});

$('#clearCat').addEventListener('click', () => { state.category = null; renderCategories(); renderFeed(); });

$('#backBtn').addEventListener('click', () => {
  if (history.state && history.state.view === 'video') history.back();
  else goTab('home');
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

history.replaceState({ view: 'home' }, '', location.pathname + location.search);
renderAll();
renderSearch();
