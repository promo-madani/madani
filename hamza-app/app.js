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
  favorites: new Set(store.get('hamza.favorites', [])),
  added: store.get('hamza.added', []),
  tab: 'home',
  scroll: {}
};

// Newest admin additions first, then the YouTube catalog (newest first), then demo items.
const allVideos = () => [
  ...[...state.added].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)),
  ...YOUTUBE_VIDEOS,
  ...DEMO_VIDEOS
];
const visibleVideos = () => allVideos().filter(v => state.platform === 'all' || v.platform === state.platform);
const findVideo = id => allVideos().find(v => v.id === id);

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const titleOf = v => v.titleUr || v.title;
const category = id => CATEGORIES.find(c => c.id === id) || { urdu: '', name: '' };
const viewCount = v => {
  const m = String(v.views || '').match(/^([\d.]+)\s*([KM]?)$/i);
  return m ? parseFloat(m[1]) * ({ K: 1e3, M: 1e6 }[m[2].toUpperCase()] || 1) : 0;
};

// ---------- Link helpers ----------

function detectPlatform(url) {
  let host;
  try { host = new URL(url).hostname.replace(/^www\.|^m\./, ''); } catch { return null; }
  if (/(^|\.)youtube\.com$|^youtu\.be$/.test(host)) return 'youtube';
  if (/(^|\.)facebook\.com$|^fb\.watch$/.test(host)) return 'facebook';
  if (/(^|\.)tiktok\.com$/.test(host)) return 'tiktok';
  if (/(^|\.)instagram\.com$/.test(host)) return 'instagram';
  if (/^threads\.(net|com)$/.test(host)) return 'threads';
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
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0f6b66"/><stop offset="1" stop-color="${p.color}"/></linearGradient></defs>
    <rect width="320" height="200" fill="url(#g)"/>
    <circle cx="160" cy="100" r="50" fill="#ffd166"/>
    <text x="160" y="118" font-size="50" text-anchor="middle">${video.emoji || '🎬'}</text>
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
  const v = findVideo(img.dataset.fallback);
  if (!v) return;
  if (img.src.includes('/maxresdefault.jpg')) { img.src = img.src.replace('/maxresdefault.jpg', '/hqdefault.jpg'); return; }
  img.dataset.failed = '1';
  img.src = placeholderThumb(v);
}, true);

// ---------- Rendering ----------

function cardHtml(v) {
  const p = PLATFORMS[v.platform];
  const meta = v.views ? `👁 ${v.views}` : p.ur;
  return `<article class="card" data-id="${v.id}" role="button" tabindex="0" aria-label="${escapeHtml(titleOf(v))}">
    <div class="thumb">
      ${imgTag(v)}
      <span class="badge" style="background:${p.color}" title="${p.ur}">${p.icon}</span>
      ${v.duration ? `<span class="dur">${v.duration}</span>` : ''}
      ${v.demo ? '<span class="demo-tag">DEMO</span>' : ''}
    </div>
    <h3>${escapeHtml(titleOf(v))}</h3>
    <small>${meta}</small>
  </article>`;
}

function renderGrid(el, videos, emptyText) {
  el.innerHTML = videos.length ? videos.map(cardHtml).join('') : `<p class="empty">${emptyText}</p>`;
}

function renderHero() {
  const vids = allVideos();
  const v = vids.find(x => x.featured) || vids[0];
  if (!v) return;
  $('#hero').dataset.id = v.id;
  $('#hero').setAttribute('aria-label', `چلائیں: ${titleOf(v)}`);
  $('#hero').innerHTML = `${imgTag(v)}<span class="shade"></span><span class="play">▶</span>
    <div class="caption"><small>★ ${v.views ? 'سب سے زیادہ دیکھی گئی' : 'خاص پیشکش'}</small><b>${escapeHtml(titleOf(v))}</b></div>`;
}

function renderChips() {
  const items = [['all', { ur: 'سب', icon: '★', color: '#0f6b66' }], ...Object.entries(PLATFORMS)];
  $('#platformChips').innerHTML = items.map(([key, p]) =>
    `<button class="chip ${state.platform === key ? 'active' : ''}" data-platform="${key}" aria-pressed="${state.platform === key}">
      <i style="background:${p.color}">${p.icon}</i>${p.ur}</button>`).join('');
}

// Row definitions shared by the Home rails and the "see all" list.
function rowVideos(key) {
  const vids = visibleVideos();
  if (key === 'latest') return vids;
  if (key === 'popular') return vids.filter(v => v.views).sort((a, b) => viewCount(b) - viewCount(a));
  return vids.filter(v => v.category === key);
}
const rowTitle = key => key === 'latest' ? 'نئی کہانیاں' : key === 'popular' ? 'سب سے زیادہ دیکھی گئی' : category(key).urdu;

function renderRows() {
  const keys = ['latest', 'popular', ...CATEGORIES.map(c => c.id)];
  const html = keys.map(key => {
    const vids = rowVideos(key);
    if (!vids.length) return '';
    return `<section class="row">
      <div class="row-head"><h2>${rowTitle(key)}</h2>
        ${vids.length > 2 ? `<button class="see-all" data-list="${key}">سب دیکھیں ←</button>` : ''}</div>
      <div class="rail">${vids.slice(0, 10).map(cardHtml).join('')}</div>
    </section>`;
  }).join('');
  $('#rows').innerHTML = html || '<p class="empty-row">اس پلیٹ فارم پر ابھی کوئی ویڈیو نہیں۔</p>';
}

function renderSocials() {
  const html = OFFICIAL_ACCOUNTS.map(a => {
    const p = PLATFORMS[a.platform];
    return `<a class="social" href="${a.url}" target="_blank" rel="noopener">
      <i style="background:${p.color}">${p.icon}</i>
      <span><b>${p.ur}</b><small>${escapeHtml(a.handle)}</small></span><em>فالو کریں ↗</em></a>`;
  }).join('');
  $('#socials').innerHTML = html;
  $('#profileSocials').innerHTML = html;
}

function renderSearch() {
  const q = $('#searchInput').value.trim().toLowerCase();
  const vids = q ? allVideos().filter(v => [v.title, v.titleUr, category(v.category).urdu, category(v.category).name,
    PLATFORMS[v.platform].name, PLATFORMS[v.platform].ur].some(s => s && s.toLowerCase().includes(q))) : [];
  renderGrid($('#searchResults'), vids, q ? 'کوئی ویڈیو نہیں ملی۔' : 'ویڈیو کا نام لکھیں۔');
}

function renderFavorites() {
  renderGrid($('#favList'), allVideos().filter(v => state.favorites.has(v.id)), 'کسی بھی ویڈیو پر ♡ پسندیدہ دبائیں،<br>وہ یہاں آ جائے گی۔');
}

function renderAdmin() {
  renderGrid($('#adminList'), state.added, 'آپ کی شامل کردہ ویڈیوز یہاں اور ہوم پر نظر آئیں گی۔');
  $('#addCat').innerHTML = CATEGORIES.map(c => `<option value="${c.id}">${c.urdu}</option>`).join('');
}

function renderList(key) {
  renderGrid($('#listGrid'), rowVideos(key), 'کوئی ویڈیو نہیں۔');
}

function favLabel(id) { return state.favorites.has(id) ? '♥ پسندیدہ میں شامل' : '♡ پسندیدہ'; }

function renderVideo(id) {
  const v = findVideo(id);
  if (!v) return;
  const p = PLATFORMS[v.platform];
  const ytId = v.platform === 'youtube' && v.url ? youtubeId(v.url) : null;
  const player = ytId
    ? `<iframe src="https://www.youtube-nocookie.com/embed/${ytId}?rel=0" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen title="${escapeHtml(titleOf(v))}"></iframe>`
    : imgTag(v);
  const official = (OFFICIAL_ACCOUNTS.find(a => a.platform === v.platform) || {}).url;
  const related = allVideos().filter(x => x.category === v.category && x.id !== v.id).slice(0, 4);
  $('#videoDetail').innerHTML = `<div class="detail">
    <div class="player">${player}</div>
    <h2>${escapeHtml(titleOf(v))}</h2>
    ${v.titleUr && v.title ? `<p class="roman">${escapeHtml(v.title)}</p>` : ''}
    <p class="info">${[`${p.icon} ${p.ur}`, category(v.category).urdu, v.views && `👁 ${v.views}`].filter(Boolean).join(' · ')}</p>
    <div class="actions">
      ${v.url ? `<a class="btn" href="${escapeHtml(v.url)}" target="_blank" rel="noopener">${p.ur} پر دیکھیں ↗</a>` : ''}
      ${v.demo && official ? `<a class="btn" href="${official}" target="_blank" rel="noopener">حمزہ کو ${p.ur} پر دیکھیں ↗</a>` : ''}
      <button class="btn ghost" data-fav="${v.id}">${favLabel(v.id)}</button>
      <button class="btn ghost" data-share="${v.id}">📤 شیئر کریں</button>
    </div>
    ${v.demo ? '<p class="note">یہ ڈیمو ویڈیو ہے – اصل ایپ میں یہاں اصل ویڈیو چلے گی۔</p>' : ''}
    <h2 class="section-title">مزید ویڈیوز</h2>
    <div class="grid">${related.map(cardHtml).join('') || '<p class="empty">اس زمرے میں اور ویڈیوز نہیں۔</p>'}</div>
  </div>`;
}

function renderAll() {
  renderHero(); renderChips(); renderRows(); renderSocials(); renderFavorites(); renderAdmin();
}

// ---------- Navigation ----------
// Tabs replace each other; video, list and admin are pushed on top so the phone's
// back button returns to where you were.

const TABS = ['home', 'search', 'favorites', 'profile'];
const TITLES = { search: 'تلاش کریں', favorites: 'پسندیدہ', profile: 'پروفائل', admin: 'ویڈیو شامل کریں', video: 'ویڈیو' };
const currentView = () => $('.view.active').dataset.view;

function show(view, title) {
  const from = currentView();
  if (TABS.includes(from)) state.scroll[from] = $('#screen').scrollTop;
  if (view !== 'video') $('#videoDetail').innerHTML = ''; // stops the player
  if (TABS.includes(view)) state.tab = view;
  $$('.view').forEach(s => s.classList.toggle('active', s.dataset.view === view));
  $$('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.go === state.tab));
  $('#phone').dataset.view = view;
  $('#topTitle').textContent = title || TITLES[view] || 'حمزہ اصلاحی کارٹون';
  $('#screen').scrollTop = TABS.includes(view) ? state.scroll[view] || 0 : 0;
  if (view === 'search' && !$('#searchInput').value) setTimeout(() => $('#searchInput').focus(), 50);
}

function goTab(view) {
  if (view === currentView()) { $('#screen').scrollTo({ top: 0, behavior: 'smooth' }); return; }
  if (TABS.includes(currentView())) history.pushState({ view }, '', '#' + view);
  else history.replaceState({ view }, '', '#' + view);
  show(view);
}

function openPage(page) {
  history.pushState(page, '', '#' + page.view);
  showPage(page);
}

function showPage(page) {
  if (page.view === 'video') { renderVideo(page.id); show('video'); }
  else if (page.view === 'list') { renderList(page.key); show('list', rowTitle(page.key)); }
  else show(page.view);
}

window.addEventListener('popstate', e => showPage(e.state || { view: 'home' }));

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
  toast(state.favorites.has(id) ? 'پسندیدہ میں شامل ہو گئی ♥' : 'پسندیدہ سے نکال دی گئی');
  renderFavorites();
  $$(`[data-fav="${id}"]`).forEach(b => { b.textContent = favLabel(id); }); // player keeps playing
}

async function shareVideo(id) {
  const v = findVideo(id);
  const data = { title: titleOf(v), text: `${titleOf(v)} – حمزہ اصلاحی کارٹون`, url: v.url || location.href };
  if (navigator.share) {
    try { await navigator.share(data); } catch { /* cancelled */ }
  } else {
    try { await navigator.clipboard.writeText(data.url); toast('لنک کاپی ہو گیا 📋'); } catch { toast('شیئر کی سہولت دستیاب نہیں'); }
  }
}

// ---------- Splash, welcome and onboarding ----------

let slideIndex = 0;

function renderOnboarding() {
  $('#slides').innerHTML = ONBOARDING.map((s, i) =>
    `<section class="slide ${s.dark ? 'dark' : ''}" style="background:${s.bg}" aria-label="${i + 1} / ${ONBOARDING.length}">
      <h2>${s.title}</h2><img src="${s.image}" alt="" /></section>`).join('');
  $('#dots').innerHTML = ONBOARDING.map((_, i) =>
    `<button role="tab" data-slide="${i}" aria-label="${i + 1}" aria-selected="${i === 0}"></button>`).join('');
}

function setSlide(i, scroll = true) {
  slideIndex = Math.max(0, Math.min(ONBOARDING.length - 1, i));
  if (scroll) $('#slides').children[slideIndex].scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
  $$('#dots button').forEach((d, n) => d.setAttribute('aria-selected', n === slideIndex));
  $('#onbNext').textContent = slideIndex === ONBOARDING.length - 1 ? 'شروع کریں' : 'آگے بڑھیں';
}

function startIntro() {
  $('#welcome').hidden = false;
  $('#onboarding').hidden = true;
}

function finishIntro() {
  store.set('hamza.onboarded', true);
  $('#welcome').hidden = true;
  $('#onboarding').hidden = true;
}

$('#startBtn').addEventListener('click', () => {
  $('#welcome').hidden = true;
  $('#onboarding').hidden = false;
  $('#slides').scrollLeft = 0;
  setSlide(0, false);
});
$('#welcomeSkip').addEventListener('click', finishIntro);
$('#onbSkip').addEventListener('click', finishIntro);
$('#onbNext').addEventListener('click', () => slideIndex === ONBOARDING.length - 1 ? finishIntro() : setSlide(slideIndex + 1));
$('#dots').addEventListener('click', e => { const d = e.target.closest('[data-slide]'); if (d) setSlide(+d.dataset.slide); });
$('#slides').addEventListener('scroll', () => {
  // scrollLeft is negative in right-to-left layouts, so use its size.
  const i = Math.round(Math.abs($('#slides').scrollLeft) / $('#slides').clientWidth);
  if (i !== slideIndex) setSlide(i, false);
}, { passive: true });
$('#replayIntro').addEventListener('click', startIntro);

function hideSplash() {
  const s = $('#splash');
  s.classList.add('hide');
  setTimeout(() => { s.hidden = true; }, 450);
  if (!store.get('hamza.onboarded', false)) startIntro();
}

// ---------- Events ----------

document.addEventListener('click', e => {
  const t = e.target.closest('[data-fav],[data-share],[data-go],[data-platform],[data-list],.card,#hero');
  if (!t) return;
  if (t.dataset.fav) return toggleFavorite(t.dataset.fav);
  if (t.dataset.share) return shareVideo(t.dataset.share);
  if (t.dataset.go) return goTab(t.dataset.go);
  if (t.dataset.platform) { state.platform = t.dataset.platform; renderChips(); return renderRows(); }
  if (t.dataset.list) return openPage({ view: 'list', key: t.dataset.list });
  if (t.dataset.id) return openPage({ view: 'video', id: t.dataset.id });
});

document.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && (e.target.classList.contains('card') || e.target.id === 'hero')) {
    e.preventDefault();
    openPage({ view: 'video', id: e.target.dataset.id });
  }
});

$('#backBtn').addEventListener('click', () => {
  if (history.state && !TABS.includes(history.state.view)) history.back();
  else goTab(state.tab);
});

$('#openAdmin').addEventListener('click', () => openPage({ view: 'admin' }));

$('#searchInput').addEventListener('input', renderSearch);

$('#addUrl').addEventListener('input', e => {
  const p = detectPlatform(e.target.value.trim());
  $('#detected').textContent = 'پلیٹ فارم: ' + (p ? `${PLATFORMS[p].icon} ${PLATFORMS[p].ur} ✓` : '— (یہ لنک قابلِ قبول نہیں)');
});

$('#addForm').addEventListener('submit', async e => {
  e.preventDefault();
  const url = $('#addUrl').value.trim();
  const platform = detectPlatform(url);
  if (!platform) return toast('یہ لنک کسی منظور شدہ پلیٹ فارم کا نہیں');
  if (platform === 'youtube' && !youtubeId(url)) return toast('یوٹیوب ویڈیو کی شناخت نہیں ہو سکی');
  if (state.added.some(v => v.url === url)) return toast('یہ لنک پہلے سے شامل ہے');

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
  $('#detected').textContent = 'پلیٹ فارم: —';
  renderAll();
  toast('ویڈیو محفوظ ہو گئی ✓');
});

// PWA install prompt (Android / desktop Chrome) – offered from the Profile menu
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
  // sw.js reloads open pages itself when an update activates; updateViaCache 'none' makes the
  // browser check for a new sw.js on every visit instead of trusting its HTTP cache.
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {}));
}

history.replaceState({ view: 'home' }, '', location.pathname + location.search);
renderOnboarding();
renderAll();
renderSearch();
setTimeout(hideSplash, 1400);
