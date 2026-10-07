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
    hasMore: new Set(),
    seen: new Set(),
    current: null,
    lastRead: {},
    typing: new Map(), // roomId -> Map(username -> timer)
    filter: '',
    events: null,
    connectedOnce: false,
    activeUploads: 0,
    sound: true,
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
  const isDm = (room) => room.startsWith('dm:');
  const dmRoom = (a, b) => 'dm:' + [a, b].sort().join(':');
  const dmPeer = (room) => {
    const [a, b] = room.slice(3).split(':');
    return a === me() ? b : a;
  };
  const displayName = (u) => (state.users.get(u) || {}).displayName || u;
  const roomMsgs = (room) => {
    if (!state.rooms.has(room)) state.rooms.set(room, []);
    return state.rooms.get(room);
  };
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
    const first = (parts[0] || '?')[0];
    const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
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
    if (u.online) return 'Online';
    if (!u.lastSeen) return 'Offline';
    const mins = Math.round((Date.now() - u.lastSeen) / 60000);
    if (mins < 1) return 'Last seen just now';
    if (mins < 60) return `Last seen ${mins} min ago`;
    if (sameDay(u.lastSeen, Date.now())) return `Last seen today at ${fmtTime(u.lastSeen)}`;
    return `Last seen ${dayLabel(u.lastSeen).toLowerCase()} at ${fmtTime(u.lastSeen)}`;
  }

  function richText(text) {
    const frag = document.createDocumentFragment();
    const re = /\bhttps?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]'}]/gi;
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
      if (m.index > last) frag.append(text.slice(last, m.index));
      const a = el('a', null, m[0]);
      a.href = m[0];
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      frag.append(a);
      last = m.index + m[0].length;
    }
    if (last < text.length) frag.append(text.slice(last));
    return frag;
  }

  function toast(message) {
    const t = el('div', 'toast', message);
    $('#toasts').append(t);
    setTimeout(() => t.remove(), 5000);
  }

  // ---------- Files ----------

  const fileUrl = (f, download) => `/files/${f.id}/${encodeURIComponent(f.name)}${download ? '?download=1' : ''}`;

  function fileKind(f) {
    const t = f.mime || '';
    if (/^image\/(png|jpeg|gif|webp|avif|bmp)$/.test(t)) return 'image';
    if (/^video\/(mp4|webm|ogg|quicktime)$/.test(t)) return 'video';
    if (/^audio\//.test(t)) return 'audio';
    return 'file';
  }

  function fileCard(f) {
    const card = el('div', 'file-card');
    const ext = f.name.includes('.') ? f.name.split('.').pop().slice(0, 4).toUpperCase() : 'FILE';
    card.append(el('span', 'file-ext', ext));
    const info = el('div', 'file-info');
    info.append(el('b', null, f.name), el('small', null, fmtSize(f.size)));
    card.append(info);
    const dl = el('a', 'file-dl', 'Download');
    dl.href = fileUrl(f, true);
    dl.download = f.name;
    card.append(dl);
    return card;
  }

  function attachmentEl(m) {
    const f = m.file;
    const kind = fileKind(f);
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

  function messageEl(m, prev) {
    const mine = m.from === me();
    const compact = prev && prev.from === m.from && m.ts - prev.ts < 5 * 60e3 && sameDay(prev.ts, m.ts);
    const row = el('div', `msg${mine ? ' mine' : ''}${compact ? ' compact' : ''}`);
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
      body.append(meta);
    }
    if (m.text) {
      const text = el('div', 'text');
      text.append(richText(m.text));
      body.append(text);
    }
    if (m.file) body.append(attachmentEl(m));
    row.append(body);
    if (mine) {
      const del = el('button', 'del', '✕');
      del.type = 'button';
      del.title = 'Delete message';
      del.setAttribute('aria-label', 'Delete message');
      del.addEventListener('click', () => deleteMessage(m));
      row.append(del);
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
        : 'This is the start of your private conversation. Say hello or drop a file.'));
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
      more.addEventListener('click', loadEarlier);
      box.append(more);
    }
    if (!list.length) box.append(emptyState());
    let prev = null;
    for (const m of list) {
      if (!prev || !sameDay(prev.ts, m.ts)) box.append(el('div', 'day', dayLabel(m.ts)));
      box.append(messageEl(m, prev));
      prev = m;
    }
    if (scroll) scrollToBottom();
  }

  function appendToView(m) {
    const box = messagesBox();
    const list = roomMsgs(m.room);
    const prev = list[list.length - 2];
    const empty = $('.empty', box);
    if (empty) empty.remove();
    if (!prev || !sameDay(prev.ts, m.ts)) box.append(el('div', 'day', dayLabel(m.ts)));
    box.append(messageEl(m, prev));
  }

  function addMessage(m) {
    if (state.seen.has(m.id)) return;
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
      if (!$('#filesPanel').hidden && m.file) renderFiles();
    }
    if (m.from !== me()) notify(m);
    renderSidebar();
  }

  async function deleteMessage(m) {
    if (!confirm(m.file ? `Delete "${m.file.name}" for everyone?` : 'Delete this message for everyone?')) return;
    try {
      await api('/api/messages/delete', { id: m.id });
      removeMessage(m.id, m.room);
    } catch (err) {
      toast(err.message);
    }
  }

  function removeMessage(id, room) {
    const list = state.rooms.get(room);
    if (!list) return;
    const i = list.findIndex((x) => x.id === id);
    if (i < 0) return;
    list.splice(i, 1);
    if (room === state.current) {
      const box = messagesBox();
      const top = box.scrollTop;
      renderMessages(false);
      box.scrollTop = top;
      if (!$('#filesPanel').hidden) renderFiles();
    }
    renderSidebar();
  }

  async function loadEarlier() {
    const room = state.current;
    const list = roomMsgs(room);
    if (!list.length) return;
    try {
      const data = await api(`/api/history?${new URLSearchParams({ room, before: list[0].id })}`);
      const fresh = data.messages.filter((m) => !state.seen.has(m.id));
      fresh.forEach((m) => state.seen.add(m.id));
      list.unshift(...fresh);
      if (!data.hasMore) state.hasMore.delete(room);
      if (room !== state.current) return;
      const box = messagesBox();
      const fromBottom = box.scrollHeight - box.scrollTop;
      renderMessages(false);
      box.scrollTop = box.scrollHeight - fromBottom;
    } catch (err) {
      toast(err.message);
    }
  }

  // ---------- Unread + notifications ----------

  function markRead(room) {
    const list = roomMsgs(room);
    const last = list.length ? list[list.length - 1].ts : 0;
    if ((state.lastRead[room] || 0) >= last) return;
    state.lastRead[room] = last;
    store.set(`chat.lastRead.${me()}`, state.lastRead);
    renderSidebar();
  }

  function unreadCount(room) {
    const since = state.lastRead[room] || 0;
    let n = 0;
    for (const m of state.rooms.get(room) || []) if (m.ts > since && m.from !== me()) n++;
    return n;
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

  function notify(m) {
    const away = document.hidden || m.room !== state.current;
    if (!away) return;
    if (isDm(m.room) || document.hidden) beep();
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      const where = isDm(m.room) ? displayName(m.from) : `${displayName(m.from)} in #${m.room}`;
      const n = new Notification(where, { body: m.text || `Sent a file: ${m.file.name}`, tag: m.room });
      n.onclick = () => { window.focus(); openRoom(m.room); n.close(); };
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
    const unread = unreadCount(room);
    if (unread && room !== state.current) {
      btn.classList.add('unread');
      btn.append(el('span', 'badge', unread > 99 ? '99+' : String(unread)));
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
      totalUnread += unreadCount(c.id);
      if (q && !c.id.includes(q)) continue;
      channelList.append(roomItem(c.id, el('span', 'hash', '#'), c.id));
    }

    const dmList = $('#dmList');
    dmList.textContent = '';
    const people = [...state.users.values()].sort((a, b) =>
      (a.username === me() ? -1 : b.username === me() ? 1 : 0) ||
      (Number(b.online) - Number(a.online)) ||
      a.displayName.localeCompare(b.displayName));
    let online = 0;
    for (const u of people) {
      if (u.online) online++;
      const room = dmRoom(me(), u.username);
      totalUnread += unreadCount(room);
      if (q && !u.displayName.toLowerCase().includes(q) && !u.username.includes(q)) continue;
      const icon = avatar(u.username, 'avatar sm');
      icon.append(el('i', `dot${u.online ? ' on' : ''}`));
      const self = u.username === me();
      dmList.append(roomItem(room, icon, self ? `${u.displayName} (you)` : u.displayName, u.title, self || u.online));
    }
    $('#onlineCount').textContent = `${online} of ${state.users.size} online`;
    updateTitle(totalUnread);
  }

  function renderMe() {
    const u = state.users.get(me()) || state.me;
    const slot = $('#meAvatar');
    slot.textContent = '';
    slot.append(avatar(u.username));
    $('#meName').textContent = u.displayName;
    $('#meTitle').textContent = u.title || `@${u.username}`;
    $('#soundBtn').textContent = state.sound ? '🔔' : '🔕';
    $('#soundBtn').title = state.sound ? 'Sound on' : 'Sound off';
  }

  // ---------- Room ----------

  function renderHeader() {
    const room = state.current;
    const title = $('#roomTitle');
    const sub = $('#roomSub');
    const input = $('#input');
    if (isDm(room)) {
      const peer = state.users.get(dmPeer(room));
      const self = peer && peer.username === me();
      title.textContent = peer ? peer.displayName + (self ? ' (you)' : '') : dmPeer(room);
      sub.textContent = self ? 'Personal notes' : peer ? [peer.title, lastSeenText(peer)].filter(Boolean).join(' · ') : '';
      input.placeholder = self ? 'Write a note to yourself…' : `Message ${peer ? peer.displayName : ''}`;
    } else {
      const c = state.channels.get(room) || {};
      title.textContent = `# ${room}`;
      sub.textContent = c.topic || `${state.users.size} members`;
      input.placeholder = `Message #${room}`;
    }
  }

  function openRoom(room) {
    if (!isDm(room) && !state.channels.has(room)) room = [...state.channels.keys()][0];
    state.current = room;
    store.set(`chat.room.${me()}`, room);
    renderHeader();
    renderMessages();
    renderTyping();
    markRead(room);
    renderSidebar();
    if (!$('#filesPanel').hidden) renderFiles();
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

  // ---------- Uploads ----------

  function uploadFiles(fileList) {
    for (const file of fileList) uploadFile(file, state.current);
  }

  function uploadFile(file, room) {
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
    const label = el('span', 'upload-name', file.name);
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
    xhr.open('POST', `/api/upload?${new URLSearchParams({ room, name: file.name })}`);
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

  // ---------- Files panel + lightbox ----------

  function renderFiles() {
    const list = $('#filesList');
    list.textContent = '';
    const files = roomMsgs(state.current).filter((m) => m.file).reverse();
    if (!files.length) {
      list.append(el('li', 'muted pad', 'No files shared in this conversation yet.'));
      return;
    }
    for (const m of files) {
      const li = el('li', 'file-row');
      li.append(fileCard(m.file));
      li.append(el('small', 'muted', `${displayName(m.from)} · ${dayLabel(m.ts)}, ${fmtTime(m.ts)}`));
      list.append(li);
    }
  }

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

  // ---------- Dialog ----------

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
        input.value = f.value || '';
        input.placeholder = f.placeholder || '';
        input.maxLength = f.maxLength || 60;
        input.required = Boolean(f.required);
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
      }
      state.connectedOnce = true;
    });
    es.addEventListener('msg', (e) => addMessage(JSON.parse(e.data)));
    es.addEventListener('delete', (e) => {
      const { id, room } = JSON.parse(e.data);
      removeMessage(id, room);
    });
    es.addEventListener('typing', (e) => onTyping(JSON.parse(e.data)));
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
      renderSidebar();
      renderHeader();
      if (u.username === me()) renderMe();
    });
    es.addEventListener('channel', (e) => {
      const c = JSON.parse(e.data);
      state.channels.set(c.id, c);
      renderSidebar();
    });
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
    state.hasMore = new Set(b.hasMore);
    state.seen = new Set();
    for (const list of state.rooms.values()) for (const m of list) state.seen.add(m.id);
  }

  async function resync() {
    try {
      const atBottom = isNearBottom();
      applyBootstrap(await api('/api/bootstrap'));
      renderMe();
      openRoomQuiet(state.current);
      if (atBottom) scrollToBottom();
    } catch (err) {
      if (err.status === 401) showLogin();
    }
  }

  function openRoomQuiet(room) {
    const box = messagesBox();
    const top = box.scrollTop;
    openRoom(room);
    box.scrollTop = top;
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
    state.lastRead = store.get(`chat.lastRead.${me()}`, {});
    state.sound = store.get('chat.sound', true);
    state.connectedOnce = false;
    $('#login').hidden = true;
    $('#app').hidden = false;
    $('#teamName').textContent = state.info.teamName;
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
      const now = Date.now();
      if (input.value.trim() && now - lastTypingSent > 2500) {
        lastTypingSent = now;
        api('/api/typing', { room: state.current }).catch(() => {});
      }
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        $('#composer').requestSubmit();
      }
    });
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
      input.value = '';
      autosize();
      lastTypingSent = 0;
      askNotificationPermission();
      try {
        addMessage(await api('/api/messages', { room, text }));
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
        state.users.set(updated.username, updated);
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

    $('#filesBtn').addEventListener('click', () => {
      const panel = $('#filesPanel');
      panel.hidden = !panel.hidden;
      if (!panel.hidden) renderFiles();
    });
    $('#filesClose').addEventListener('click', () => { $('#filesPanel').hidden = true; });

    $('#menuBtn').addEventListener('click', () => $('#app').classList.add('nav-open'));
    $('#backdrop').addEventListener('click', () => $('#app').classList.remove('nav-open'));

    $('#lightbox').addEventListener('click', (e) => { if (e.target.id === 'lightbox' || e.target.id === 'lightboxImg') closeLightbox(); });
    $('#lightboxClose').addEventListener('click', closeLightbox);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#lightbox').hidden) closeLightbox(); });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && state.current && state.me) markRead(state.current);
    });
    window.addEventListener('beforeunload', (e) => {
      if (state.activeUploads > 0) { e.preventDefault(); e.returnValue = ''; }
    });
    // Refresh "last seen …" wording once a minute.
    setInterval(() => { if (state.current && state.me && isDm(state.current)) renderHeader(); }, 60000);
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
