'use strict';
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  const state = {
    info: null,
    me: null,
    users: new Map(),
    channels: new Map(),
    rooms: new Map(), // roomId -> [message]
    olderPins: new Map(), // roomId -> [pinned messages older than the loaded page]
    reads: {}, // roomId -> { username: ts }
    legacyRead: {},
    hasMore: new Set(),
    seen: new Set(),
    current: null,
    replyTo: null,
    panel: null, // 'files' | 'pins' | 'search'
    typing: new Map(), // roomId -> Map(username -> timer)
    filter: '',
    events: null,
    connectedOnce: false,
    activeUploads: 0,
    sound: true,
    mention: null, // open @mention menu: { items, index, start }
  };

  // ---------- Server calls ----------

  async function api(url, body) {
    const opts = { headers: { 'X-Chat': '1' }, credentials: 'same-origin' };
    if (body !== undefined) {
      opts.method = 'POST';
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    let data = null;
    try { data = await res.json(); } catch { /* not JSON */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || res.statusText || 'Request failed');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // ---------- Small helpers ----------

  const me = () => state.me.username;
  const amAdmin = () => (state.users.get(me()) || state.me).role === 'admin';
  const isDm = (room) => room.startsWith('dm:');
  const dmRoom = (a, b) => 'dm:' + [a, b].sort().join(':');
  const dmPeer = (room) => {
    const [a, b] = room.slice(3).split(':');
    return a === me() ? b : a;
  };
  const displayName = (u) => (state.users.get(u) || {}).displayName || u;
  const activeUsers = () => [...state.users.values()].filter((u) => !u.removed);
  const roomMsgs = (room) => {
    if (!state.rooms.has(room)) state.rooms.set(room, []);
    return state.rooms.get(room);
  };
  const roomName = (room) => (isDm(room) ? (dmPeer(room) === me() ? 'Your notes' : displayName(dmPeer(room))) : `#${room}`);
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
    },
  };

  function initials(name) {
    const parts = String(name).trim().split(/\s+/);
    const first = [...(parts[0] || '?')][0];
    const last = parts.length > 1 ? [...parts[parts.length - 1]][0] : '';
    return (first + last).toUpperCase();
  }

  function colorFor(u) {
    let h = 0;
    for (const ch of u) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return `hsl(${h % 360} 55% 42%)`;
  }

  function avatar(u, cls = 'avatar') {
    const a = el('span', cls, initials(displayName(u)));
    a.style.background = colorFor(u);
    a.setAttribute('aria-hidden', 'true');
    return a;
  }

  function fmtSize(n) {
    if (n < 1024) return `${n} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < units.length - 1);
    return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
  }

  const fmtDuration = (s) => {
    s = Math.max(0, Math.round(Number(s) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(s % 60).padStart(2, '0')}`;
  };
  const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

  function dayLabel(ts) {
    const d = new Date(ts);
    const today = new Date();
    if (sameDay(ts, today)) return 'Today';
    if (sameDay(ts, today.getTime() - 864e5)) return 'Yesterday';
    return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
  }

  function lastSeenText(u) {
    if (u.removed) return 'No longer in the team';
    if (u.online) return 'Online';
    if (!u.lastSeen) return 'Offline';
    const mins = Math.round((Date.now() - u.lastSeen) / 60000);
    if (mins < 1) return 'Last seen just now';
    if (mins < 60) return `Last seen ${mins} min ago`;
    if (sameDay(u.lastSeen, Date.now())) return `Last seen today at ${fmtTime(u.lastSeen)}`;
    return `Last seen ${dayLabel(u.lastSeen).toLowerCase()} at ${fmtTime(u.lastSeen)}`;
  }

  function snippet(m) {
    if (m.text) return m.text;
    if (m.file) return m.file.voice ? `🎤 Voice message (${fmtDuration(m.file.duration)})` : `📎 ${m.file.name}`;
    if (m.call) return m.call.kind === 'video' ? '🎥 Video call' : '📞 Voice call';
    return '';
  }

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /** Text with clickable links and highlighted @mentions (built with DOM nodes, never innerHTML). */
  function richText(text, m) {
    const frag = document.createDocumentFragment();
    const names = [];
    for (const u of (m && m.mentions) || []) names.push(u === 'all' ? 'all' : displayName(u));
    const patterns = ['\\bhttps?:\\/\\/[^\\s<>"]+[^\\s<>".,;:!?)\\]\'}]'];
    if (names.length) patterns.push(`@(?:${names.sort((a, b) => b.length - a.length).map(escapeRe).join('|')})`);
    const re = new RegExp(patterns.map((p) => `(${p})`).join('|'), 'giu');
    let last = 0;
    let match;
    while ((match = re.exec(text))) {
      if (match.index > last) frag.append(text.slice(last, match.index));
      if (match[1]) {
        const a = el('a', null, match[1]);
        a.href = match[1];
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        frag.append(a);
      } else {
        const self = match[0].toLowerCase() === `@${displayName(me()).toLowerCase()}` || match[0].toLowerCase() === '@all';
        frag.append(el('span', `mention${self ? ' me' : ''}`, match[0]));
      }
      last = match.index + match[0].length;
    }
    if (last < text.length) frag.append(text.slice(last));
    return frag;
  }

  function highlight(text, q) {
    const frag = document.createDocumentFragment();
    const lower = text.toLowerCase();
    let i = 0;
    let at;
    while (q && (at = lower.indexOf(q, i)) >= 0) {
      frag.append(text.slice(i, at), el('mark', null, text.slice(at, at + q.length)));
      i = at + q.length;
    }
    frag.append(text.slice(i));
    return frag;
  }

  function toast(message) {
    const t = el('div', 'toast', message);
    $('#toasts').append(t);
    setTimeout(() => t.remove(), 6000);
  }

  function needSecure(feature) {
    $('#secureBanner').hidden = false;
    toast(`${feature} need the secure connection. Click "Set up this computer" at the top of the chat (1 minute, once).`);
  }

  const isMentioned = (m) => m.from !== me() && Array.isArray(m.mentions) && (m.mentions.includes(me()) || m.mentions.includes('all'));

  // ---------- Files ----------

  const fileUrl = (f, download) => `/files/${f.id}/${encodeURIComponent(f.name)}${download ? '?download=1' : ''}`;

  function fileKind(f) {
    const t = f.mime || '';
    if (f.voice) return 'voice';
    if (/^image\/(png|jpeg|gif|webp|avif|bmp)$/.test(t)) return 'image';
    if (/^video\/(mp4|webm|ogg|quicktime)$/.test(t)) return 'video';
    if (/^audio\//.test(t)) return 'audio';
    return 'file';
  }

  function fileCard(f) {
    const card = el('div', 'file-card');
    const ext = f.voice ? 'MIC' : f.name.includes('.') ? f.name.split('.').pop().slice(0, 4).toUpperCase() : 'FILE';
    card.append(el('span', 'file-ext', ext));
    const info = el('div', 'file-info');
    info.append(el('b', null, f.voice ? 'Voice message' : f.name), el('small', null, f.voice ? fmtDuration(f.duration) : fmtSize(f.size)));
    card.append(info);
    const dl = el('a', 'file-dl', 'Download');
    dl.href = fileUrl(f, true);
    dl.download = f.name;
    card.append(dl);
    return card;
  }

  let currentVoice = null;
  function voicePlayer(f) {
    const wrap = el('div', 'voice');
    const btn = el('button', 'voice-play', '▶');
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Play voice message');
    const bar = el('div', 'voice-bar');
    const fill = el('i');
    bar.append(fill);
    const time = el('span', 'voice-time', fmtDuration(f.duration));
    let audio = null;
    btn.addEventListener('click', () => {
      if (!audio) {
        audio = new Audio(fileUrl(f));
        audio.addEventListener('timeupdate', () => {
          const d = f.duration || audio.duration;
          if (Number.isFinite(d) && d > 0) fill.style.width = `${Math.min(100, (audio.currentTime / d) * 100)}%`;
          time.textContent = fmtDuration(audio.currentTime);
        });
        audio.addEventListener('play', () => { btn.textContent = '❚❚'; wrap.classList.add('playing'); });
        audio.addEventListener('pause', () => { btn.textContent = '▶'; wrap.classList.remove('playing'); });
        audio.addEventListener('ended', () => { fill.style.width = '0'; time.textContent = fmtDuration(f.duration); });
      }
      if (audio.paused) {
        if (currentVoice && currentVoice !== audio) currentVoice.pause();
        currentVoice = audio;
        audio.play().catch(() => toast('Could not play this voice message'));
      } else {
        audio.pause();
      }
    });
    bar.addEventListener('click', (e) => {
      if (!audio || !f.duration) return;
      const r = bar.getBoundingClientRect();
      audio.currentTime = ((e.clientX - r.left) / r.width) * f.duration;
    });
    // Playback speed, like WhatsApp: 1× → 1.5× → 2×.
    const speeds = [1, 1.5, 2];
    const speed = el('button', 'voice-speed', '1×');
    speed.type = 'button';
    speed.title = 'Playback speed';
    speed.addEventListener('click', () => {
      const next = speeds[(speeds.indexOf(Number(speed.dataset.rate || 1)) + 1) % speeds.length];
      speed.dataset.rate = String(next);
      speed.textContent = `${next}×`;
      if (audio) audio.playbackRate = next;
    });
    btn.addEventListener('click', () => { if (audio) audio.playbackRate = Number(speed.dataset.rate || 1); });
    const dl = el('a', 'voice-dl', '⬇');
    dl.href = fileUrl(f, true);
    dl.download = f.name;
    dl.title = 'Download';
    wrap.append(btn, bar, time, speed, dl);
    return wrap;
  }

  function attachmentEl(m) {
    const f = m.file;
    const kind = fileKind(f);
    if (kind === 'voice') return voicePlayer(f);
    const wrap = el('div', `attachment ${kind}`);
    if (kind === 'image') {
      const img = el('img');
      img.src = fileUrl(f);
      img.alt = f.name;
      img.loading = 'lazy';
      img.addEventListener('load', keepPinnedToBottom);
      img.addEventListener('click', () => openLightbox(f));
      wrap.append(img);
    } else if (kind === 'video') {
      const v = el('video');
      v.src = fileUrl(f);
      v.controls = true;
      v.preload = 'metadata';
      v.playsInline = true;
      v.addEventListener('loadedmetadata', keepPinnedToBottom);
      wrap.append(v);
    } else if (kind === 'audio') {
      const a = el('audio');
      a.src = fileUrl(f);
      a.controls = true;
      a.preload = 'metadata';
      wrap.append(a);
    }
    wrap.append(fileCard(f));
    return wrap;
  }

  // ---------- Messages view ----------

  const messagesBox = () => $('#messages');
  let pinnedToBottom = true;

  function isNearBottom() {
    const box = messagesBox();
    return box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  }

  function scrollToBottom() {
    const box = messagesBox();
    box.scrollTop = box.scrollHeight;
    pinnedToBottom = true;
  }

  function keepPinnedToBottom() {
    if (pinnedToBottom) scrollToBottom();
  }

  function callLogEl(m) {
    const c = m.call;
    const mine = m.from === me();
    const kind = c.kind === 'video' ? 'video call' : 'voice call';
    let text;
    if (c.status === 'completed') text = `${c.kind === 'video' ? 'Video' : 'Voice'} call · ${fmtDuration(c.duration)}`;
    else if (c.status === 'declined') text = mine ? `${displayName(dmPeer(m.room))} declined your ${kind}` : `You declined a ${kind}`;
    else text = mine ? `${displayName(dmPeer(m.room))} didn't answer your ${kind}` : `Missed ${kind}`;
    const pill = el('div', `call-log${c.status === 'completed' ? '' : ' missed'}`);
    pill.append(el('span', null, c.kind === 'video' ? '🎥' : '📞'), el('span', null, text));
    const peer = dmPeer(m.room);
    const peerUser = state.users.get(peer);
    if (peer !== me() && peerUser && !peerUser.removed) {
      const back = el('button', 'link-btn', mine ? 'Call again' : 'Call back');
      back.type = 'button';
      back.addEventListener('click', () => window.ChatCalls.start(peer, c.kind));
      pill.append(back);
    }
    return pill;
  }

  function actionButton(label, title, onClick) {
    const b = el('button', 'act', label);
    b.type = 'button';
    b.title = title;
    b.setAttribute('aria-label', title);
    b.addEventListener('click', onClick);
    return b;
  }

  function messageEl(m, prev) {
    const mine = m.from === me();
    const compact = prev && prev.from === m.from && m.ts - prev.ts < 5 * 60e3 && sameDay(prev.ts, m.ts) &&
      !m.reply && !m.broadcast && !prev.call && !m.call;
    const row = el('div', `msg${mine ? ' mine' : ''}${compact ? ' compact' : ''}${isMentioned(m) ? ' mentioned' : ''}${m.pinned ? ' is-pinned' : ''}`);
    row.dataset.id = m.id;
    if (compact) {
      row.append(el('time', 'side-time', fmtTime(m.ts)));
    } else {
      row.append(avatar(m.from));
    }
    const body = el('div', 'body');
    if (!compact) {
      const meta = el('div', 'meta');
      meta.append(el('b', null, displayName(m.from)));
      const t = el('time', null, fmtTime(m.ts));
      t.dateTime = new Date(m.ts).toISOString();
      t.title = new Date(m.ts).toLocaleString();
      meta.append(t);
      if (m.broadcast) meta.append(el('span', 'tag', '📢 Broadcast'));
      body.append(meta);
    }
    if (m.pinned) body.append(el('div', 'pinned-label', `📌 Pinned by ${displayName(m.pinned.by)}`));
    if (m.reply) {
      const q = el('button', 'reply-quote');
      q.type = 'button';
      q.append(el('b', null, displayName(m.reply.from)), el('span', null, m.reply.text));
      q.addEventListener('click', () => jumpTo(m.room, m.reply.id));
      body.append(q);
    }
    if (m.text) {
      const text = el('div', 'text');
      text.append(richText(m.text, m));
      body.append(text);
    }
    if (m.file) body.append(attachmentEl(m));
    if (m.call) body.append(callLogEl(m));
    row.append(body);

    if (!m.call) {
      const actions = el('div', 'actions');
      actions.append(actionButton('↩', 'Reply', () => startReply(m)));
      actions.append(actionButton('📌', m.pinned ? 'Unpin' : 'Pin', () => togglePin(m)));
      if (mine || amAdmin()) actions.append(actionButton('🗑', 'Delete', () => deleteMessage(m)));
      row.append(actions);
    }
    return row;
  }

  function emptyState() {
    const box = el('div', 'empty');
    const room = state.current;
    if (isDm(room)) {
      const peer = dmPeer(room);
      box.append(avatar(peer, 'avatar xl'));
      box.append(el('h3', null, peer === me() ? 'Your personal notes' : displayName(peer)));
      box.append(el('p', null, peer === me()
        ? 'Keep notes, links and files for yourself here.'
        : 'This is the start of your private conversation. Say hello, send a voice message or start a call.'));
    } else {
      box.append(el('div', 'hash-xl', '#'));
      box.append(el('h3', null, `Welcome to #${room}`));
      box.append(el('p', null, (state.channels.get(room) || {}).topic || 'This is the very beginning of this channel.'));
    }
    return box;
  }

  function renderMessages(scroll = true) {
    const box = messagesBox();
    box.textContent = '';
    const room = state.current;
    const list = roomMsgs(room);
    if (state.hasMore.has(room)) {
      const more = el('button', 'load-more', 'Load earlier messages');
      more.type = 'button';
      more.addEventListener('click', () => loadEarlier());
      box.append(more);
    }
    if (!list.length) box.append(emptyState());
    let prev = null;
    for (const m of list) {
      if (!prev || !sameDay(prev.ts, m.ts)) box.append(el('div', 'day', dayLabel(m.ts)));
      box.append(messageEl(m, prev));
      prev = m;
    }
    updateReceipts();
    if (scroll) scrollToBottom();
  }

  function rerenderKeepScroll() {
    const box = messagesBox();
    const top = box.scrollTop;
    const bottom = isNearBottom();
    renderMessages(false);
    if (bottom) scrollToBottom(); else box.scrollTop = top;
  }

  function appendToView(m) {
    const box = messagesBox();
    const list = roomMsgs(m.room);
    const prev = list[list.length - 2];
    const empty = $('.empty', box);
    if (empty) empty.remove();
    if (!prev || !sameDay(prev.ts, m.ts)) box.append(el('div', 'day', dayLabel(m.ts)));
    box.append(messageEl(m, prev));
    updateReceipts();
  }

  function addMessage(m) {
    if (!m || state.seen.has(m.id)) return;
    state.seen.add(m.id);
    const list = roomMsgs(m.room);
    const outOfOrder = list.length && list[list.length - 1].ts > m.ts;
    list.push(m);
    if (outOfOrder) list.sort((a, b) => a.ts - b.ts);
    clearTyping(m.room, m.from);

    if (m.room === state.current) {
      const stick = isNearBottom() || m.from === me();
      if (outOfOrder) renderMessages(false); else appendToView(m);
      if (stick) scrollToBottom();
      if (document.visibilityState === 'visible') markRead(m.room);
      if (state.panel === 'files' && m.file) renderPanel();
    }
    if (m.from !== me()) notify(m);
    renderSidebar();
  }

  function updateMessage(m) {
    const list = state.rooms.get(m.room);
    const i = list ? list.findIndex((x) => x.id === m.id) : -1;
    if (i >= 0) list[i] = m;
    const older = (state.olderPins.get(m.room) || []).filter((x) => x.id !== m.id);
    if (m.pinned && i < 0) older.push(m);
    state.olderPins.set(m.room, older);
    if (m.room === state.current) {
      if (i >= 0) rerenderKeepScroll();
      renderHeader();
      if (state.panel === 'pins') renderPanel();
    }
  }

  async function deleteMessage(m) {
    const what = m.file ? `"${m.file.voice ? 'voice message' : m.file.name}"` : 'this message';
    if (!confirm(`Delete ${what} for everyone?`)) return;
    try {
      await api('/api/messages/delete', { id: m.id });
      removeMessage(m.id, m.room);
    } catch (err) {
      toast(err.message);
    }
  }

  function removeMessage(id, room) {
    const pins = state.olderPins.get(room);
    if (pins) state.olderPins.set(room, pins.filter((x) => x.id !== id));
    const list = state.rooms.get(room);
    const i = list ? list.findIndex((x) => x.id === id) : -1;
    if (i < 0) return;
    list.splice(i, 1);
    if (state.replyTo && state.replyTo.id === id) clearReply();
    if (room === state.current) {
      rerenderKeepScroll();
      renderHeader();
      if (state.panel) renderPanel();
    }
    renderSidebar();
  }

  async function togglePin(m) {
    try {
      updateMessage(await api('/api/messages/pin', { id: m.id, pinned: !m.pinned }));
    } catch (err) {
      toast(err.message);
    }
  }

  async function loadEarlier() {
    const room = state.current;
    const list = roomMsgs(room);
    if (!list.length || !state.hasMore.has(room)) return false;
    try {
      const data = await api(`/api/history?${new URLSearchParams({ room, before: list[0].id })}`);
      const fresh = data.messages.filter((m) => !state.seen.has(m.id));
      fresh.forEach((m) => state.seen.add(m.id));
      list.unshift(...fresh);
      if (!data.hasMore) state.hasMore.delete(room);
      if (room !== state.current) return true;
      const box = messagesBox();
      const fromBottom = box.scrollHeight - box.scrollTop;
      renderMessages(false);
      box.scrollTop = box.scrollHeight - fromBottom;
      return true;
    } catch (err) {
      toast(err.message);
      return false;
    }
  }

  /** Open a conversation and scroll to one message, loading older history if needed. */
  async function jumpTo(room, id) {
    if (room !== state.current) openRoom(room);
    let target = messagesBox().querySelector(`[data-id="${CSS.escape(id)}"]`);
    for (let i = 0; !target && i < 50 && state.hasMore.has(room); i++) {
      if (!(await loadEarlier())) break;
      target = messagesBox().querySelector(`[data-id="${CSS.escape(id)}"]`);
    }
    if (!target) { toast('That message is no longer available'); return; }
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target.classList.remove('flash');
    void target.offsetWidth;
    target.classList.add('flash');
  }

  // ---------- Read receipts ----------

  function updateReceipts() {
    for (const r of messagesBox().querySelectorAll('.receipt')) r.remove();
    const room = state.current;
    const list = roomMsgs(room);
    let mine = null;
    for (let i = list.length - 1; i >= 0; i--) if (list[i].from === me()) { mine = list[i]; break; }
    if (!mine) return;
    const row = messagesBox().querySelector(`[data-id="${CSS.escape(mine.id)}"] .body`);
    if (!row) return;
    const reads = state.reads[room] || {};
    let receipt;
    if (isDm(room)) {
      const peer = dmPeer(room);
      if (peer === me()) return;
      const seen = (reads[peer] || 0) >= mine.ts;
      receipt = el('div', `receipt${seen ? ' seen' : ''}`, seen ? '✓✓ Seen' : '✓ Sent');
    } else {
      const seenBy = activeUsers().filter((u) => u.username !== me() && (reads[u.username] || 0) >= mine.ts);
      receipt = el('div', `receipt${seenBy.length ? ' seen' : ''}`, seenBy.length ? `✓✓ Seen by ${seenBy.length}` : '✓ Sent');
      if (seenBy.length) receipt.title = seenBy.map((u) => u.displayName).join(', ');
    }
    row.append(receipt);
  }

  // ---------- Unread + notifications ----------

  const lastReadOf = (room) => Math.max((state.reads[room] || {})[me()] || 0, state.legacyRead[room] || 0);

  function markRead(room) {
    const list = roomMsgs(room);
    const last = list.length ? list[list.length - 1].ts : 0;
    if (lastReadOf(room) >= last) return;
    (state.reads[room] || (state.reads[room] = {}))[me()] = last;
    api('/api/read', { room, ts: last }).catch(() => {});
    renderSidebar();
  }

  function unreadInfo(room) {
    const since = lastReadOf(room);
    let count = 0;
    let mentions = 0;
    for (const m of state.rooms.get(room) || []) {
      if (m.ts > since && m.from !== me()) {
        count++;
        if (isMentioned(m)) mentions++;
      }
    }
    return { count, mentions };
  }

  function updateTitle(total) {
    document.title = `${total ? `(${total}) ` : ''}${state.info ? state.info.teamName : 'AI Dept'} Chat`;
    const badge = $('#menuBadge');
    badge.hidden = !total;
    badge.textContent = total > 99 ? '99+' : String(total);
  }

  let audioCtx = null;
  function beep() {
    if (!state.sound) return;
    try {
      audioCtx = audioCtx || new AudioContext();
      const t = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.setValueAtTime(880, t);
      osc.frequency.setValueAtTime(1175, t + 0.09);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + 0.32);
    } catch { /* audio not available */ }
  }

  function desktopNotify(title, body, onClick, tag) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      const n = new Notification(title, { body, tag, icon: '/icon.svg' });
      n.onclick = () => { window.focus(); onClick(); n.close(); };
    } catch { /* notifications unavailable */ }
  }

  function notify(m) {
    const away = document.hidden || m.room !== state.current;
    if (!away || m.call) return;
    const mentioned = isMentioned(m);
    if (isDm(m.room) || mentioned || document.hidden) beep();
    if (document.hidden || mentioned) {
      const where = isDm(m.room) ? displayName(m.from) : `${displayName(m.from)} in #${m.room}`;
      desktopNotify(mentioned ? `${where} mentioned you` : where, snippet(m), () => jumpTo(m.room, m.id), m.room);
    }
  }

  function askNotificationPermission() {
    if ('Notification' in window && window.isSecureContext && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }

  // ---------- Sidebar ----------

  function roomItem(room, icon, label, sub, online) {
    const li = el('li');
    const btn = el('button', `room${room === state.current ? ' active' : ''}`);
    btn.type = 'button';
    btn.append(icon);
    const text = el('span', 'room-text');
    text.append(el('span', 'room-name', label));
    if (sub) text.append(el('small', null, sub));
    btn.append(text);
    const { count, mentions } = unreadInfo(room);
    if (count && room !== state.current) {
      btn.classList.add('unread');
      btn.append(el('span', `badge${mentions ? ' mention' : ''}`, `${mentions ? '@ ' : ''}${count > 99 ? '99+' : count}`));
    }
    if (online === false) btn.classList.add('offline');
    btn.addEventListener('click', () => openRoom(room));
    li.append(btn);
    return li;
  }

  function renderSidebar() {
    const q = state.filter;
    let totalUnread = 0;

    const channelList = $('#channelList');
    channelList.textContent = '';
    for (const c of [...state.channels.values()].sort((a, b) => a.id.localeCompare(b.id))) {
      totalUnread += unreadInfo(c.id).count;
      if (q && !c.id.includes(q)) continue;
      channelList.append(roomItem(c.id, el('span', 'hash', '#'), c.id));
    }

    const dmList = $('#dmList');
    dmList.textContent = '';
    const people = activeUsers().sort((a, b) =>
      (a.username === me() ? -1 : b.username === me() ? 1 : 0) ||
      (Number(b.online) - Number(a.online)) ||
      a.displayName.localeCompare(b.displayName));
    let online = 0;
    for (const u of people) {
      if (u.online) online++;
      const room = dmRoom(me(), u.username);
      totalUnread += unreadInfo(room).count;
      if (q && !u.displayName.toLowerCase().includes(q) && !u.username.includes(q)) continue;
      const icon = avatar(u.username, 'avatar sm');
      icon.append(el('i', `dot${u.online ? ' on' : ''}`));
      const self = u.username === me();
      dmList.append(roomItem(room, icon, self ? `${u.displayName} (you)` : u.displayName, u.title, self || u.online));
    }
    $('#onlineCount').textContent = `${online} of ${people.length} online`;
    updateTitle(totalUnread);
  }

  function renderMe() {
    const u = state.users.get(me()) || state.me;
    const slot = $('#meAvatar');
    slot.textContent = '';
    slot.append(avatar(u.username));
    $('#meName').textContent = u.displayName;
    $('#meTitle').textContent = u.role === 'admin' ? `${u.title ? `${u.title} · ` : ''}Admin` : u.title || `@${u.username}`;
    $('#soundBtn').textContent = state.sound ? '🔔' : '🔕';
    $('#soundBtn').title = state.sound ? 'Sound on' : 'Sound off';
    $('#adminBtn').hidden = u.role !== 'admin';
  }

  // ---------- Room ----------

  function pinnedIn(room) {
    const byId = new Map();
    for (const m of [...(state.olderPins.get(room) || []), ...roomMsgs(room)]) if (m.pinned) byId.set(m.id, m);
    return [...byId.values()].sort((a, b) => b.pinned.ts - a.pinned.ts);
  }

  function renderHeader() {
    const room = state.current;
    if (!room) return;
    const title = $('#roomTitle');
    const sub = $('#roomSub');
    const input = $('#input');
    let canCall = false;
    if (isDm(room)) {
      const peer = state.users.get(dmPeer(room));
      const self = peer && peer.username === me();
      title.textContent = peer ? peer.displayName + (self ? ' (you)' : '') : dmPeer(room);
      sub.textContent = self ? 'Personal notes' : peer ? [peer.title, lastSeenText(peer)].filter(Boolean).join(' · ') : '';
      input.placeholder = self ? 'Write a note to yourself…' : `Message ${peer ? peer.displayName : ''}`;
      canCall = Boolean(peer && !self && !peer.removed);
    } else {
      const c = state.channels.get(room) || {};
      title.textContent = `# ${room}`;
      sub.textContent = c.topic || `${activeUsers().length} members`;
      input.placeholder = window.matchMedia('(max-width: 760px)').matches ? `Message #${room}` : `Message #${room} (type @ to mention someone)`;
    }
    $('#voiceCallBtn').hidden = !canCall;
    $('#videoCallBtn').hidden = !canCall;
    const pins = pinnedIn(room).length;
    $('#pinCount').hidden = !pins;
    $('#pinCount').textContent = String(pins);
  }

  function openRoom(room) {
    if (!isDm(room) && !state.channels.has(room)) room = [...state.channels.keys()][0];
    if (room !== state.current) clearReply();
    state.current = room;
    store.set(`chat.room.${me()}`, room);
    renderHeader();
    renderMessages();
    renderTyping();
    markRead(room);
    renderSidebar();
    if (state.panel && state.panel !== 'search') renderPanel();
    $('#app').classList.remove('nav-open');
    if (window.matchMedia('(min-width: 761px)').matches) $('#input').focus();
  }

  // ---------- Typing indicator ----------

  function clearTyping(room, username) {
    const map = state.typing.get(room);
    if (!map || !map.has(username)) return;
    clearTimeout(map.get(username));
    map.delete(username);
    if (room === state.current) renderTyping();
  }

  function onTyping({ room, username }) {
    let map = state.typing.get(room);
    if (!map) state.typing.set(room, (map = new Map()));
    clearTimeout(map.get(username));
    map.set(username, setTimeout(() => clearTyping(room, username), 4000));
    if (room === state.current) renderTyping();
  }

  function renderTyping() {
    const names = [...(state.typing.get(state.current) || new Map()).keys()].map(displayName);
    let text = '';
    if (names.length === 1) text = `${names[0]} is typing…`;
    else if (names.length === 2) text = `${names[0]} and ${names[1]} are typing…`;
    else if (names.length > 2) text = 'Several people are typing…';
    $('#typing').textContent = text;
  }

  // ---------- Reply ----------

  function startReply(m) {
    state.replyTo = m;
    $('#replyName').textContent = `Replying to ${displayName(m.from)}`;
    $('#replyText').textContent = snippet(m).slice(0, 140);
    $('#replyBar').hidden = false;
    $('#input').focus();
  }

  function clearReply() {
    state.replyTo = null;
    $('#replyBar').hidden = true;
  }

  // ---------- @mentions ----------

  function mentionQuery() {
    const input = $('#input');
    const pos = input.selectionStart;
    const before = input.value.slice(0, pos);
    const m = /(?:^|\s)@([^\s@]{0,30})$/u.exec(before);
    return m ? { q: m[1].toLowerCase(), start: pos - m[1].length - 1, end: pos } : null;
  }

  function updateMentionMenu() {
    const mq = mentionQuery();
    if (!mq) return hideMentionMenu();
    const items = [];
    for (const u of activeUsers()) {
      if (u.username === me()) continue;
      const name = u.displayName.toLowerCase();
      if (!mq.q || name.startsWith(mq.q) || name.split(/\s+/).some((w) => w.startsWith(mq.q)) || u.username.startsWith(mq.q)) items.push(u);
    }
    // People first; @all (channels only) last so "@Al" picks Ali, not everyone.
    if (!isDm(state.current) && 'all'.startsWith(mq.q)) items.push({ username: 'all', displayName: 'all', title: 'Notify everyone in this channel' });
    if (!items.length) return hideMentionMenu();
    state.mention = { items: items.slice(0, 7), index: 0, start: mq.start, end: mq.end };
    renderMentionMenu();
  }

  function renderMentionMenu() {
    const menu = $('#mentionMenu');
    menu.textContent = '';
    state.mention.items.forEach((u, i) => {
      const b = el('button', `mention-item${i === state.mention.index ? ' active' : ''}`);
      b.type = 'button';
      b.setAttribute('role', 'option');
      if (u.username === 'all') b.append(el('span', 'avatar sm all', '@'));
      else b.append(avatar(u.username, 'avatar sm'));
      const t = el('span', 'room-text');
      t.append(el('b', null, u.username === 'all' ? '@all' : u.displayName), el('small', null, u.title || ''));
      b.append(t);
      b.addEventListener('mousedown', (e) => { e.preventDefault(); pickMention(u); });
      menu.append(b);
    });
    menu.hidden = false;
  }

  function hideMentionMenu() {
    state.mention = null;
    $('#mentionMenu').hidden = true;
  }

  function pickMention(u) {
    const input = $('#input');
    const { start, end } = state.mention;
    const insert = `@${u.displayName} `;
    input.value = input.value.slice(0, start) + insert + input.value.slice(end);
    const caret = start + insert.length;
    input.setSelectionRange(caret, caret);
    hideMentionMenu();
    input.focus();
  }

  function detectMentions(text, room) {
    const lower = text.toLowerCase();
    const out = [];
    if (!isDm(room) && /(^|\s)@all\b/i.test(text)) out.push('all');
    for (const u of activeUsers()) {
      if (u.username !== me() && lower.includes(`@${u.displayName.toLowerCase()}`)) out.push(u.username);
    }
    return out;
  }

  // ---------- Uploads ----------

  function uploadFiles(fileList) {
    for (const file of fileList) uploadFile(file, state.current, state.replyTo ? { replyTo: state.replyTo.id } : {});
    clearReply();
  }

  function uploadFile(file, room, extra = {}) {
    const limitMB = state.info.maxUploadMB;
    if (file.size > limitMB * 1024 * 1024) {
      toast(`"${file.name}" is ${fmtSize(file.size)}, more than the ${limitMB} MB limit.`);
      return;
    }
    if (file.size === 0) {
      toast(`"${file.name}" is empty.`);
      return;
    }
    const tray = $('#uploads');
    const row = el('div', 'upload');
    const label = el('span', 'upload-name', extra.voice ? '🎤 Voice message' : file.name);
    const bar = el('div', 'bar');
    const fill = el('i');
    bar.append(fill);
    const pct = el('span', 'upload-pct', '0%');
    const cancel = el('button', 'mini-btn', '✕');
    cancel.type = 'button';
    cancel.title = 'Cancel upload';
    row.append(label, bar, pct, cancel);
    tray.append(row);
    tray.hidden = false;
    state.activeUploads++;

    const xhr = new XMLHttpRequest();
    const params = new URLSearchParams({ room, name: file.name });
    for (const [k, v] of Object.entries(extra)) if (v != null) params.set(k, v);
    xhr.open('POST', `/api/upload?${params}`);
    xhr.setRequestHeader('X-Chat', '1');
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const p = (e.loaded / e.total) * 100;
      fill.style.width = `${p}%`;
      pct.textContent = p >= 100 ? 'Saving…' : `${Math.floor(p)}%`;
    };
    const done = () => {
      state.activeUploads--;
      row.remove();
      if (!tray.children.length) tray.hidden = true;
    };
    xhr.onload = () => {
      done();
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status >= 200 && xhr.status < 300 && data) addMessage(data);
      else toast(`Could not send "${file.name}": ${(data && data.error) || xhr.statusText || 'upload failed'}`);
    };
    xhr.onerror = () => { done(); toast(`Could not send "${file.name}": network error`); };
    xhr.onabort = done;
    cancel.addEventListener('click', () => xhr.abort());
    xhr.send(file);
  }

  // ---------- Voice messages ----------

  const MAX_VOICE_SECONDS = 300;
  const rec = { mr: null, stream: null, chunks: [], start: 0, timer: null, room: null, replyTo: null, send: false };

  async function startRecording() {
    if (rec.mr) return;
    if (!window.isSecureContext || !navigator.mediaDevices || !window.MediaRecorder) { needSecure('Voice messages'); return; }
    if (window.ChatCalls.inCall()) { toast('Finish your call first'); return; }
    try {
      rec.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (err) {
      toast(err && err.name === 'NotAllowedError'
        ? 'Microphone blocked. Click the 🔒 icon in the address bar and allow the microphone.'
        : 'No microphone found. Plug in your headphones/microphone and try again.');
      return;
    }
    const type = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t));
    rec.mr = new MediaRecorder(rec.stream, type ? { mimeType: type, audioBitsPerSecond: 48000 } : undefined);
    rec.chunks = [];
    rec.room = state.current;
    rec.replyTo = state.replyTo ? state.replyTo.id : null;
    rec.send = false;
    rec.mr.ondataavailable = (e) => { if (e.data.size) rec.chunks.push(e.data); };
    rec.mr.onstop = finishRecording;
    rec.mr.start(250);
    rec.start = Date.now();
    $('#composer').hidden = true;
    $('#recorder').hidden = false;
    $('#recTime').textContent = '0:00';
    rec.timer = setInterval(() => {
      const s = (Date.now() - rec.start) / 1000;
      $('#recTime').textContent = fmtDuration(s);
      if (s >= MAX_VOICE_SECONDS) stopRecording(true);
    }, 250);
  }

  function stopRecording(send) {
    if (!rec.mr || rec.mr.state === 'inactive') return;
    rec.send = send;
    rec.mr.stop();
  }

  function finishRecording() {
    clearInterval(rec.timer);
    for (const t of rec.stream.getTracks()) t.stop();
    $('#recorder').hidden = true;
    $('#composer').hidden = false;
    const mr = rec.mr;
    rec.mr = null;
    if (!rec.send) return;
    const duration = (Date.now() - rec.start) / 1000;
    if (duration < 1) { toast('Too short. Speak for at least a second.'); return; }
    const mime = (mr.mimeType || 'audio/webm').split(';')[0];
    const ext = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'm4a' : 'webm';
    const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
    const file = new File([new Blob(rec.chunks, { type: mime })], `Voice message ${stamp}.${ext}`, { type: mime });
    uploadFile(file, rec.room, { voice: '1', duration: duration.toFixed(1), replyTo: rec.replyTo });
    if (rec.replyTo && state.replyTo && state.replyTo.id === rec.replyTo) clearReply();
  }

  // ---------- Side panel: files, pins, search ----------

  function openPanel(kind) {
    state.panel = state.panel === kind ? null : kind;
    renderPanel();
    if (state.panel === 'search') {
      const input = $('#searchInput');
      input.focus();
      input.select();
    }
  }

  function resultRow(m, onClick, extra) {
    const li = el('li', 'result');
    const b = el('button', 'result-btn');
    b.type = 'button';
    const head = el('div', 'result-head');
    head.append(el('b', null, displayName(m.from)), el('small', null, `${roomName(m.room)} · ${dayLabel(m.ts)}, ${fmtTime(m.ts)}`));
    b.append(head);
    const text = el('div', 'result-text');
    text.append(extra && extra.query ? highlight(snippet(m).slice(0, 300), extra.query) : snippet(m).slice(0, 300));
    b.append(text);
    b.addEventListener('click', onClick);
    li.append(b);
    return li;
  }

  function renderPanel() {
    const panel = $('#panel');
    const list = $('#panelList');
    panel.hidden = !state.panel;
    for (const id of ['filesBtn', 'pinsBtn', 'searchBtn']) $(`#${id}`).classList.toggle('on', state.panel === id.replace('Btn', ''));
    if (!state.panel) return;
    $('#panelSearch').hidden = state.panel !== 'search';
    list.textContent = '';

    if (state.panel === 'files') {
      $('#panelTitle').textContent = 'Shared files';
      const files = roomMsgs(state.current).filter((m) => m.file).reverse();
      if (!files.length) list.append(el('li', 'muted pad', 'No files shared in this conversation yet.'));
      for (const m of files) {
        const li = el('li', 'file-row');
        li.append(fileCard(m.file));
        li.append(el('small', 'muted', `${displayName(m.from)} · ${dayLabel(m.ts)}, ${fmtTime(m.ts)}`));
        list.append(li);
      }
      if (state.hasMore.has(state.current)) list.append(el('li', 'muted pad', 'Showing files from recent messages. Use search to find older files.'));
    } else if (state.panel === 'pins') {
      $('#panelTitle').textContent = 'Pinned messages';
      const pins = pinnedIn(state.current);
      if (!pins.length) list.append(el('li', 'muted pad', 'Nothing pinned yet. Hover a message and click 📌 to keep it here, e.g. important notices or links.'));
      for (const m of pins) {
        const li = resultRow(m, () => jumpTo(m.room, m.id));
        const foot = el('div', 'result-foot');
        foot.append(el('small', 'muted', `Pinned by ${displayName(m.pinned.by)}`));
        const unpin = el('button', 'link-btn', 'Unpin');
        unpin.type = 'button';
        unpin.addEventListener('click', () => togglePin(m));
        foot.append(unpin);
        li.append(foot);
        list.append(li);
      }
    } else if (state.panel === 'search') {
      $('#panelTitle').textContent = 'Search';
      runSearch();
    }
  }

  let searchTimer = null;
  let searchSeq = 0;
  function runSearch() {
    clearTimeout(searchTimer);
    const q = $('#searchInput').value.trim();
    const list = $('#panelList');
    if (q.length < 2) {
      list.textContent = '';
      list.append(el('li', 'muted pad', 'Type at least 2 letters to search messages and file names in all your chats.'));
      return;
    }
    searchTimer = setTimeout(async () => {
      const seq = ++searchSeq;
      try {
        const data = await api(`/api/search?${new URLSearchParams({ q })}`);
        if (seq !== searchSeq || state.panel !== 'search') return;
        list.textContent = '';
        if (!data.results.length) list.append(el('li', 'muted pad', `No results for "${q}".`));
        for (const m of data.results) {
          list.append(resultRow(m, () => {
            if (window.matchMedia('(max-width: 760px)').matches) { state.panel = null; renderPanel(); }
            jumpTo(m.room, m.id);
          }, { query: q.toLowerCase() }));
        }
        if (data.total > data.results.length) list.append(el('li', 'muted pad', `Showing the newest ${data.results.length} of ${data.total} results.`));
      } catch (err) {
        toast(err.message);
      }
    }, 250);
  }

  // ---------- Lightbox ----------

  function openLightbox(f) {
    $('#lightboxImg').src = fileUrl(f);
    $('#lightboxImg').alt = f.name;
    $('#lightboxName').textContent = f.name;
    $('#lightboxDl').href = fileUrl(f, true);
    $('#lightboxDl').download = f.name;
    $('#lightbox').hidden = false;
  }

  function closeLightbox() {
    $('#lightbox').hidden = true;
    $('#lightboxImg').removeAttribute('src');
  }

  // ---------- Dialogs ----------

  function ask(title, fields, submitLabel = 'Save') {
    return new Promise((resolve) => {
      const dlg = $('#dialog');
      const form = $('#dialogForm');
      const box = $('#dialogFields');
      $('#dialogTitle').textContent = title;
      $('#dialogSubmit').textContent = submitLabel;
      box.textContent = '';
      for (const f of fields) {
        const label = el('label', null, f.label);
        const input = el('input');
        input.name = f.name;
        input.type = f.type || 'text';
        input.value = f.value || '';
        input.placeholder = f.placeholder || '';
        input.maxLength = f.maxLength || 60;
        input.required = Boolean(f.required);
        if (f.minLength) input.minLength = f.minLength;
        label.append(input);
        box.append(label);
      }
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        if (dlg.open) dlg.close();
        resolve(value);
      };
      form.onsubmit = (e) => { e.preventDefault(); finish(Object.fromEntries(new FormData(form))); };
      $('#dialogCancel').onclick = () => finish(null);
      dlg.onclose = () => finish(null);
      dlg.showModal();
      const first = box.querySelector('input');
      if (first) first.focus();
    });
  }

  function bigDialog(build) {
    const dlg = $('#bigDialog');
    const body = $('#bigDialogBody');
    body.textContent = '';
    build(body, () => dlg.close());
    if (!dlg.open) dlg.showModal();
  }

  // ---------- Broadcast ----------

  function openBroadcast() {
    bigDialog((body, close) => {
      const form = el('form', 'broadcast-form');
      form.append(el('h2', null, '📢 Broadcast a message'));
      form.append(el('p', 'muted', 'Sends your message privately to each person you choose. Replies come back to you privately. To post in a channel and alert everyone there, type @all in the channel instead.'));
      const text = el('textarea');
      text.required = true;
      text.maxLength = 8000;
      text.rows = 4;
      text.placeholder = 'e.g. Team meeting today at 3 pm in the conference room.';
      form.append(text);

      const people = activeUsers().filter((u) => u.username !== me()).sort((a, b) => a.displayName.localeCompare(b.displayName));
      const allLabel = el('label', 'check all-check');
      const all = el('input');
      all.type = 'checkbox';
      all.checked = true;
      allLabel.append(all, el('span', null, `Everyone (${people.length})`));
      form.append(allLabel);
      const listBox = el('div', 'check-list');
      const boxes = people.map((u) => {
        const l = el('label', 'check');
        const c = el('input');
        c.type = 'checkbox';
        c.checked = true;
        c.value = u.username;
        l.append(c, avatar(u.username, 'avatar sm'), el('span', null, u.displayName), el('small', 'muted', u.title || ''));
        listBox.append(l);
        c.addEventListener('change', () => { all.checked = boxes.every((b) => b.checked); });
        return c;
      });
      all.addEventListener('change', () => boxes.forEach((b) => { b.checked = all.checked; }));
      form.append(listBox);

      const actions = el('div', 'dialog-actions');
      const cancel = el('button', 'btn', 'Cancel');
      cancel.type = 'button';
      cancel.addEventListener('click', close);
      const send = el('button', 'btn primary', 'Send');
      send.type = 'submit';
      actions.append(cancel, send);
      form.append(actions);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const to = boxes.filter((b) => b.checked).map((b) => b.value);
        if (!to.length) { toast('Choose at least one person'); return; }
        send.disabled = true;
        try {
          const res = await api('/api/broadcast', { text: text.value, to });
          close();
          toast(`📢 Sent to ${res.count} ${res.count === 1 ? 'person' : 'people'}`);
        } catch (err) {
          toast(err.message);
          send.disabled = false;
        }
      });
      body.append(form);
      setTimeout(() => text.focus(), 0);
    });
  }

  // ---------- Admin panel ----------

  async function openAdmin() {
    let data;
    try {
      data = await api('/api/admin/overview');
    } catch (err) {
      toast(err.message);
      return;
    }
    const act = async (action, username, extra = {}) => {
      try {
        await api('/api/admin/user', { action, username, ...extra });
        openAdmin();
      } catch (err) {
        toast(err.message);
      }
    };
    bigDialog((body, close) => {
      const head = el('div', 'admin-head');
      head.append(el('h2', null, '⚙️ Admin panel'));
      const x = el('button', 'icon-btn', '✕');
      x.type = 'button';
      x.setAttribute('aria-label', 'Close');
      x.addEventListener('click', close);
      head.append(x);
      body.append(head);

      const stats = el('div', 'stats');
      for (const [label, value] of [
        ['Messages', data.stats.messages.toLocaleString()],
        ['Files', data.stats.files.toLocaleString()],
        ['Storage used', fmtSize(data.stats.bytes)],
        ['People', String(data.users.filter((u) => !u.removed).length)],
      ]) {
        const s = el('div', 'stat');
        s.append(el('b', null, value), el('small', null, label));
        stats.append(s);
      }
      body.append(stats);

      // Backups
      const b = data.backup;
      const backup = el('section', 'admin-section');
      backup.append(el('h3', null, '💾 Daily backup'));
      if (!b.dir) {
        backup.append(el('p', 'muted', 'Backups are turned off. Set "backupDir" in config.json to turn them on.'));
      } else {
        const status = b.lastAt
          ? `${b.ok ? '✅ Last backup' : '⚠️ Last backup FAILED'}: ${dayLabel(b.lastAt)}, ${fmtTime(b.lastAt)}${b.error ? ` (${b.error})` : ''}`
          : 'No backup yet today. It runs automatically a few seconds after the server starts, then daily.';
        backup.append(el('p', null, status));
        backup.append(el('p', 'muted', `Folder: ${b.dir} · kept for ${b.keepDays} days. Tip: point "backupDir" in config.json to another drive or a network folder.`));
        const now = el('button', 'btn', 'Back up now');
        now.type = 'button';
        now.addEventListener('click', async () => {
          now.disabled = true;
          now.textContent = 'Backing up…';
          try { await api('/api/admin/backup', {}); toast('Backup finished'); openAdmin(); } catch (err) { toast(err.message); now.disabled = false; }
        });
        backup.append(now);
      }
      body.append(backup);

      // People
      const people = el('section', 'admin-section');
      people.append(el('h3', null, '👥 People'));
      const table = el('div', 'admin-table');
      for (const u of data.users) {
        const row = el('div', `admin-row${u.removed ? ' removed' : ''}`);
        const who = el('div', 'admin-who');
        who.append(avatar(u.username, 'avatar sm'));
        const t = el('div', 'room-text');
        t.append(el('b', null, `${u.displayName}${u.role === 'admin' ? ' · Admin' : ''}`),
          el('small', null, `@${u.username}${u.title ? ` · ${u.title}` : ''} · ${lastSeenText(u)}`));
        who.append(t);
        row.append(who);
        const buttons = el('div', 'admin-actions');
        const btn = (label, fn, danger) => {
          const x2 = el('button', `btn small${danger ? ' danger' : ''}`, label);
          x2.type = 'button';
          x2.addEventListener('click', fn);
          buttons.append(x2);
        };
        if (u.removed) {
          btn('Restore', () => act('restore', u.username));
        } else {
          btn('Reset PIN', async () => {
            const res = await ask(`New PIN for ${u.displayName}`, [
              { name: 'pin', label: 'New PIN (tell them in person)', required: true, minLength: 4, maxLength: 64, placeholder: 'At least 4 characters' },
            ], 'Set PIN');
            if (res) { await act('reset-pin', u.username, { pin: res.pin }); toast(`PIN changed for ${u.displayName}`); }
          });
          if (u.role === 'admin') btn('Remove admin', () => act('remove-admin', u.username));
          else btn('Make admin', () => act('make-admin', u.username));
          if (u.username !== me()) {
            btn('Remove', () => {
              if (confirm(`Remove ${u.displayName} from the chat? They will be signed out and can't sign in again. Their old messages stay.`)) act('remove', u.username);
            }, true);
          }
        }
        row.append(buttons);
        table.append(row);
      }
      people.append(table);
      body.append(people);

      // Channels
      const chans = el('section', 'admin-section');
      chans.append(el('h3', null, '# Channels'));
      const ctable = el('div', 'admin-table');
      for (const c of [...state.channels.values()].sort((a, b2) => a.id.localeCompare(b2.id))) {
        const row = el('div', 'admin-row');
        const t = el('div', 'room-text');
        t.append(el('b', null, `#${c.id}`), el('small', null, c.topic || 'No description'));
        row.append(t);
        const buttons = el('div', 'admin-actions');
        const edit = el('button', 'btn small', 'Edit description');
        edit.type = 'button';
        edit.addEventListener('click', async () => {
          const res = await ask(`Description of #${c.id}`, [{ name: 'topic', label: 'Description', value: c.topic, maxLength: 200 }]);
          if (!res) return;
          try { await api('/api/admin/channel', { id: c.id, action: 'topic', topic: res.topic }); openAdmin(); } catch (err) { toast(err.message); }
        });
        const del = el('button', 'btn small danger', 'Delete');
        del.type = 'button';
        del.addEventListener('click', async () => {
          if (!confirm(`Delete #${c.id} and ALL its messages and files for everyone? This cannot be undone (except from a backup).`)) return;
          try { await api('/api/admin/channel', { id: c.id, action: 'delete' }); openAdmin(); } catch (err) { toast(err.message); }
        });
        buttons.append(edit, del);
        row.append(buttons);
        ctable.append(row);
      }
      chans.append(ctable);
      body.append(chans);
    });
  }

  // ---------- Live events ----------

  function connectEvents() {
    if (state.events) state.events.close();
    const es = new EventSource('/api/events');
    state.events = es;
    es.addEventListener('ready', async (e) => {
      $('#status').hidden = true;
      const { online } = JSON.parse(e.data);
      if (state.connectedOnce) {
        await resync(); // catch up on anything sent while we were disconnected
      } else {
        for (const u of state.users.values()) u.online = online.includes(u.username);
        renderSidebar();
        renderHeader();
      }
      state.connectedOnce = true;
    });
    es.addEventListener('msg', (e) => addMessage(JSON.parse(e.data)));
    es.addEventListener('update', (e) => updateMessage(JSON.parse(e.data)));
    es.addEventListener('delete', (e) => {
      const { id, room } = JSON.parse(e.data);
      removeMessage(id, room);
    });
    es.addEventListener('typing', (e) => onTyping(JSON.parse(e.data)));
    es.addEventListener('read', (e) => {
      const { room, username, ts } = JSON.parse(e.data);
      const r = state.reads[room] || (state.reads[room] = {});
      r[username] = Math.max(r[username] || 0, ts);
      if (username === me()) renderSidebar();
      if (room === state.current) updateReceipts();
    });
    es.addEventListener('presence', (e) => {
      const p = JSON.parse(e.data);
      const u = state.users.get(p.username);
      if (!u) return;
      u.online = p.online;
      if (p.lastSeen) u.lastSeen = p.lastSeen;
      renderSidebar();
      if (state.current === dmRoom(me(), p.username)) renderHeader();
    });
    es.addEventListener('user', (e) => {
      const u = JSON.parse(e.data);
      const existing = state.users.get(u.username);
      state.users.set(u.username, { ...u, online: existing ? existing.online : u.online });
      if (u.username === me() && u.removed) { location.reload(); return; }
      renderSidebar();
      renderHeader();
      if (u.username === me()) renderMe();
    });
    es.addEventListener('channel', (e) => {
      const c = JSON.parse(e.data);
      state.channels.set(c.id, c);
      renderSidebar();
      if (state.current === c.id) renderHeader();
    });
    es.addEventListener('channel-delete', (e) => {
      const { id } = JSON.parse(e.data);
      state.channels.delete(id);
      state.rooms.delete(id);
      if (state.current === id) openRoom([...state.channels.keys()][0]);
      else renderSidebar();
    });
    es.addEventListener('call', (e) => window.ChatCalls.onSignal(JSON.parse(e.data)));
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        // The server refused the stream: usually the session ended.
        api('/api/bootstrap').then(() => setTimeout(connectEvents, 3000)).catch((err) => {
          if (err.status === 401) showLogin(); else setTimeout(connectEvents, 3000);
        });
      }
      $('#status').hidden = false;
    };
  }

  function applyBootstrap(b) {
    state.me = b.me;
    state.info.teamName = b.teamName;
    state.info.maxUploadMB = b.maxUploadMB;
    state.users = new Map(b.users.map((u) => [u.username, u]));
    state.channels = new Map(b.channels.map((c) => [c.id, c]));
    state.rooms = new Map(Object.entries(b.rooms));
    state.olderPins = new Map(Object.entries(b.olderPins || {}));
    state.reads = b.reads || {};
    state.hasMore = new Set(b.hasMore);
    state.seen = new Set();
    for (const list of state.rooms.values()) for (const m of list) state.seen.add(m.id);
  }

  async function resync() {
    try {
      applyBootstrap(await api('/api/bootstrap'));
      renderMe();
      const box = messagesBox();
      const top = box.scrollTop;
      const bottom = isNearBottom();
      openRoom(state.current);
      if (bottom) scrollToBottom(); else box.scrollTop = top;
    } catch (err) {
      if (err.status === 401) showLogin();
    }
  }

  // ---------- Startup ----------

  function showLogin() {
    if (state.events) state.events.close();
    state.events = null;
    $('#app').hidden = true;
    $('#login').hidden = false;
    $('#loginTeam').textContent = state.info.teamName;
    $('#passcodeField').hidden = !state.info.needsPasscode;
    document.title = `${state.info.teamName} Chat`;
    $('#loginForm [name=username]').focus();
  }

  async function start() {
    applyBootstrap(await api('/api/bootstrap'));
    state.legacyRead = store.get(`chat.lastRead.${me()}`, {});
    state.sound = store.get('chat.sound', true);
    state.connectedOnce = false;
    $('#login').hidden = true;
    $('#app').hidden = false;
    $('#teamName').textContent = state.info.teamName;
    $('#secureBanner').hidden = window.isSecureContext;
    renderMe();
    const saved = store.get(`chat.room.${me()}`, null);
    const valid = saved && (state.channels.has(saved) || (isDm(saved) && saved.slice(3).split(':').every((u) => state.users.has(u))));
    openRoom(valid ? saved : [...state.channels.keys()][0] || dmRoom(me(), me()));
    connectEvents();
  }

  function wireUi() {
    $('#loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type=submit]');
      $('#loginError').textContent = '';
      btn.disabled = true;
      try {
        await api('/api/login', Object.fromEntries(new FormData(e.target)));
        e.target.reset();
        askNotificationPermission();
        await start();
      } catch (err) {
        $('#loginError').textContent = err.message;
      } finally {
        btn.disabled = false;
      }
    });

    const input = $('#input');
    const autosize = () => {
      input.style.height = 'auto';
      input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
    };
    let lastTypingSent = 0;
    input.addEventListener('input', () => {
      autosize();
      updateMentionMenu();
      const now = Date.now();
      if (input.value.trim() && now - lastTypingSent > 2500) {
        lastTypingSent = now;
        api('/api/typing', { room: state.current }).catch(() => {});
      }
    });
    input.addEventListener('keydown', (e) => {
      if (state.mention) {
        const n = state.mention.items.length;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          state.mention.index = (state.mention.index + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
          renderMentionMenu();
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          pickMention(state.mention.items[state.mention.index]);
          return;
        }
        if (e.key === 'Escape') { hideMentionMenu(); return; }
      }
      if (e.key === 'Escape' && state.replyTo) { clearReply(); return; }
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        $('#composer').requestSubmit();
      }
    });
    input.addEventListener('blur', () => setTimeout(hideMentionMenu, 150));
    input.addEventListener('paste', (e) => {
      const files = [...((e.clipboardData && e.clipboardData.files) || [])];
      if (!files.length) return;
      e.preventDefault();
      const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
      uploadFiles(files.map((f, i) => (/^image\.\w+$/.test(f.name)
        ? new File([f], `pasted-${stamp}${i ? `-${i}` : ''}.${f.name.split('.').pop()}`, { type: f.type })
        : f)));
    });

    $('#composer').addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      const room = state.current;
      const replyTo = state.replyTo ? state.replyTo.id : undefined;
      input.value = '';
      autosize();
      hideMentionMenu();
      clearReply();
      lastTypingSent = 0;
      askNotificationPermission();
      try {
        addMessage(await api('/api/messages', { room, text, replyTo, mentions: detectMentions(text, room) }));
      } catch (err) {
        if (!input.value) { input.value = text; autosize(); }
        toast(`Not sent: ${err.message}`);
      }
    });

    $('#attachBtn').addEventListener('click', () => $('#fileInput').click());
    $('#fileInput').addEventListener('change', (e) => {
      uploadFiles([...e.target.files]);
      e.target.value = '';
    });
    $('#micBtn').addEventListener('click', startRecording);
    $('#recSend').addEventListener('click', () => stopRecording(true));
    $('#recCancel').addEventListener('click', () => stopRecording(false));
    $('#replyCancel').addEventListener('click', clearReply);

    // Drag and drop files anywhere on the chat.
    const chat = $('#chat');
    const drop = $('#dropZone');
    const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    let depth = 0;
    chat.addEventListener('dragenter', (e) => { if (hasFiles(e)) { e.preventDefault(); depth++; drop.hidden = false; } });
    chat.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
    chat.addEventListener('dragleave', (e) => { if (hasFiles(e) && --depth <= 0) { depth = 0; drop.hidden = true; } });
    chat.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      drop.hidden = true;
      uploadFiles([...e.dataTransfer.files]);
    });

    messagesBox().addEventListener('scroll', () => { pinnedToBottom = isNearBottom(); });

    $('#search').addEventListener('input', (e) => {
      state.filter = e.target.value.trim().toLowerCase();
      renderSidebar();
    });

    $('#newChannel').addEventListener('click', async () => {
      const data = await ask('Create a channel', [
        { name: 'name', label: 'Channel name', placeholder: 'e.g. computer-vision', required: true, maxLength: 40 },
        { name: 'topic', label: 'What is it about? (optional)', placeholder: 'e.g. CV team: models, datasets, demos', maxLength: 200 },
      ], 'Create');
      if (!data) return;
      try {
        const c = await api('/api/channels', data);
        state.channels.set(c.id, c);
        openRoom(c.id);
      } catch (err) {
        toast(err.message);
      }
    });

    $('#profileBtn').addEventListener('click', async () => {
      const u = state.users.get(me());
      const data = await ask('Your profile', [
        { name: 'displayName', label: 'Full name', value: u.displayName, required: true },
        { name: 'title', label: 'Role / title', value: u.title, placeholder: 'e.g. Data Scientist' },
      ]);
      if (!data) return;
      try {
        const updated = await api('/api/profile', data);
        state.users.set(updated.username, { ...u, ...updated });
        renderMe();
        renderSidebar();
      } catch (err) {
        toast(err.message);
      }
    });

    $('#soundBtn').addEventListener('click', () => {
      state.sound = !state.sound;
      store.set('chat.sound', state.sound);
      renderMe();
      if (state.sound) beep();
    });

    $('#logoutBtn').addEventListener('click', async () => {
      if (!confirm('Sign out of the chat on this computer?')) return;
      try { await api('/api/logout', {}); } catch { /* signing out anyway */ }
      location.reload();
    });

    $('#broadcastBtn').addEventListener('click', openBroadcast);
    $('#adminBtn').addEventListener('click', openAdmin);

    $('#voiceCallBtn').addEventListener('click', () => window.ChatCalls.start(dmPeer(state.current), 'audio'));
    $('#videoCallBtn').addEventListener('click', () => window.ChatCalls.start(dmPeer(state.current), 'video'));
    $('#filesBtn').addEventListener('click', () => openPanel('files'));
    $('#pinsBtn').addEventListener('click', () => openPanel('pins'));
    $('#searchBtn').addEventListener('click', () => openPanel('search'));
    $('#panelClose').addEventListener('click', () => { state.panel = null; renderPanel(); });
    $('#searchInput').addEventListener('input', runSearch);
    $('#exportBtn').addEventListener('click', () => {
      const a = el('a');
      a.href = `/api/export?${new URLSearchParams({ room: state.current })}`;
      a.download = '';
      document.body.append(a);
      a.click();
      a.remove();
    });

    $('#menuBtn').addEventListener('click', () => $('#app').classList.add('nav-open'));
    $('#backdrop').addEventListener('click', () => $('#app').classList.remove('nav-open'));

    $('#lightbox').addEventListener('click', (e) => { if (e.target.id === 'lightbox' || e.target.id === 'lightboxImg') closeLightbox(); });
    $('#lightboxClose').addEventListener('click', closeLightbox);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$('#lightbox').hidden) closeLightbox();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && state.me) { e.preventDefault(); openPanel('search'); }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && state.current && state.me) markRead(state.current);
    });
    window.addEventListener('beforeunload', (e) => {
      if (state.activeUploads > 0 || rec.mr || window.ChatCalls.inCall()) { e.preventDefault(); e.returnValue = ''; }
    });
    // Refresh "last seen …" wording once a minute.
    setInterval(() => { if (state.current && state.me && isDm(state.current)) renderHeader(); }, 60000);

    window.ChatCalls.init({
      api,
      me,
      displayName,
      avatar,
      toast,
      needSecure,
      dmRoom,
      addMessage,
      users: () => state.users,
      openRoom: (room) => { if (state.current !== room) openRoom(room); },
      notifyCall: (s) => {
        if (document.hidden) desktopNotify(`${displayName(s.from)} is calling you`, s.kind === 'video' ? 'Video call' : 'Voice call', () => {}, 'call');
      },
    });
  }

  async function init() {
    wireUi();
    try {
      state.info = await api('/api/info');
    } catch {
      document.body.textContent = 'Cannot reach the chat server. Check that it is running and refresh this page.';
      return;
    }
    if (!state.info.signedIn) {
      showLogin();
      return;
    }
    try {
      await start();
    } catch (err) {
      if (err.status === 401) showLogin();
      else toast(err.message);
    }
  }

  init();
})();
