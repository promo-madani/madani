#!/usr/bin/env node
'use strict';
/*
 * AI Department Office Chat — a messenger for the office network (LAN).
 * Channels, direct messages, file / image / video sharing, voice messages,
 * voice & video calls with screen sharing, search, mentions, replies, read
 * receipts, pinned messages, broadcasts, daily backups and an admin panel.
 *
 * Zero dependencies: needs only Node.js 18 or newer.  Run:  node server.js
 */
const http = require('http');
const https = require('https');
const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const { ensureCertificates } = require('./lib/certs');

// ---------- Configuration ----------

const config = loadConfig();
const MAX_UPLOAD_BYTES = Math.floor(config.maxUploadMB * 1024 * 1024);
const PAGE_SIZE = 100;
const MAX_TEXT = 8000;
const SESSION_DAYS = 90;
const DATA_DIR = config.dataDir;
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const PUBLIC_DIR = path.join(__dirname, 'public');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function loadConfig() {
  let file = {};
  const configPath = path.join(__dirname, 'config.json');
  if (fs.existsSync(configPath)) {
    try {
      file = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (err) {
      console.error(`config.json is not valid JSON: ${err.message}`);
      process.exit(1);
    }
  }
  // Environment variables win over config.json, which wins over the defaults.
  const pick = (envKey, fileKey, fallback) => {
    const env = process.env[envKey];
    if (env !== undefined && env !== '') return env;
    return file[fileKey] !== undefined ? file[fileKey] : fallback;
  };
  const bool = (v) => !['false', '0', 'off', 'no'].includes(String(v).toLowerCase());
  const backupDir = String(pick('BACKUP_DIR', 'backupDir', 'backups'));
  return {
    port: Number(pick('PORT', 'port', 8080)),
    host: String(pick('HOST', 'host', '0.0.0.0')),
    teamName: String(pick('TEAM_NAME', 'teamName', 'AI Department')),
    passcode: String(pick('TEAM_PASSCODE', 'passcode', '')),
    maxUploadMB: Number(pick('MAX_UPLOAD_MB', 'maxUploadMB', 2048)),
    dataDir: path.resolve(__dirname, String(pick('DATA_DIR', 'dataDir', 'data'))),
    https: bool(pick('CHAT_HTTPS', 'https', true)),
    tlsKey: String(pick('TLS_KEY', 'tlsKey', '')),
    tlsCert: String(pick('TLS_CERT', 'tlsCert', '')),
    backupDir: ['off', 'false', ''].includes(backupDir.toLowerCase()) ? null : path.resolve(__dirname, backupDir),
    backupDays: Number(pick('BACKUP_DAYS', 'backupDays', 30)),
    admins: (Array.isArray(file.admins) ? file.admins : String(process.env.ADMINS || '').split(','))
      .map((a) => String(a).trim().replace(/\s+/g, ' ').toLowerCase()).filter(Boolean),
    defaultChannels: Array.isArray(file.defaultChannels) ? file.defaultChannels : [
      { id: 'ai-department', topic: 'Whole AI department: announcements and daily chat' },
      { id: 'resources', topic: 'Share datasets, models, papers, prompts and docs' },
    ],
  };
}

// ---------- Storage (JSON files + an append-only message log) ----------

function readJSON(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

function writeJSON(name, value) {
  const file = path.join(DATA_DIR, name);
  fs.writeFileSync(file + '.tmp', JSON.stringify(value, null, 2));
  fs.renameSync(file + '.tmp', file);
}

// username -> { username, displayName, title, salt, pinHash, createdAt, lastSeen, role?, removed? }
const users = readJSON('users.json', {});
const sessions = readJSON('sessions.json', {}); // sha256(token) -> { username, createdAt }
const reads = readJSON('reads.json', {}); // room -> { username: ts of last message they have seen }
let channels = readJSON('channels.json', null); // id -> { id, topic, createdBy, createdAt }
if (!channels) {
  channels = {};
  for (const c of config.defaultChannels) {
    const id = slugify(c.id);
    if (id) channels[id] = { id, topic: String(c.topic || ''), createdBy: 'system', createdAt: Date.now() };
  }
  writeJSON('channels.json', channels);
}

const saveUsers = () => writeJSON('users.json', users);
const saveSessions = () => writeJSON('sessions.json', sessions);
const saveChannels = () => writeJSON('channels.json', channels);
let readsTimer = null;
const saveReads = () => {
  clearTimeout(readsTimer);
  readsTimer = setTimeout(() => writeJSON('reads.json', reads), 2000);
};

// Expire old sessions on startup.
for (const [key, s] of Object.entries(sessions)) {
  const u = Object.hasOwn(users, s.username) ? users[s.username] : null;
  if (Date.now() - s.createdAt > SESSION_DAYS * 864e5 || !u || u.removed) delete sessions[key];
}
saveSessions();

// Admins: anyone listed in config.json, plus the first person who joined if nobody is admin yet.
function ensureAdmin() {
  let changed = false;
  for (const name of config.admins) {
    if (Object.hasOwn(users, name) && users[name].role !== 'admin') {
      users[name].role = 'admin';
      changed = true;
    }
  }
  const active = Object.values(users).filter((u) => !u.removed);
  if (active.length && !active.some((u) => u.role === 'admin')) {
    active.sort((a, b) => a.createdAt - b.createdAt)[0].role = 'admin';
    changed = true;
  }
  if (changed) saveUsers();
}
ensureAdmin();

const MESSAGE_LOG = path.join(DATA_DIR, 'messages.jsonl');
const rooms = new Map(); // roomId -> [message] in send order
const messagesById = new Map();
const filesById = new Map(); // fileId -> message carrying it

function indexMessage(m) {
  if (!rooms.has(m.room)) rooms.set(m.room, []);
  rooms.get(m.room).push(m);
  messagesById.set(m.id, m);
  if (m.file) filesById.set(m.file.id, m);
}

function unindexMessage(m) {
  const list = rooms.get(m.room) || [];
  const i = list.indexOf(m);
  if (i >= 0) list.splice(i, 1);
  messagesById.delete(m.id);
  if (m.file) filesById.delete(m.file.id);
}

if (fs.existsSync(MESSAGE_LOG)) {
  for (const line of fs.readFileSync(MESSAGE_LOG, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; } // skip a torn last line after a crash
    const m = rec.op ? messagesById.get(rec.id) : null;
    if (rec.op === 'delete') {
      if (m) unindexMessage(m);
    } else if (rec.op === 'pin') {
      if (m) m.pinned = { by: rec.by, ts: rec.ts };
    } else if (rec.op === 'unpin') {
      if (m) delete m.pinned;
    } else if (!rec.op) {
      indexMessage(rec);
    }
  }
}
const messageLog = fs.createWriteStream(MESSAGE_LOG, { flags: 'a' });
const appendLog = (rec) => messageLog.write(JSON.stringify(rec) + '\n');

// ---------- Helpers ----------

// Usernames may contain letters (any language), numbers, spaces, dot, dash and underscore.
// They are matched case-insensitively, so "Aamir Patni" and "aamir patni" are the same person.
const USERNAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{1,31}$/u;
const normalizeUsername = (s) => String(s || '').trim().replace(/\s+/g, ' ');
const findUser = (u) => (typeof u === 'string' && Object.hasOwn(users, u) ? users[u] : null);
const activeUser = (u) => { const x = findUser(u); return x && !x.removed ? x : null; };
const isAdmin = (u) => u && u.role === 'admin' && !u.removed;
const newId = () => crypto.randomBytes(12).toString('base64url');
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest();
const hashToken = (t) => sha256(t).toString('hex');
const safeEqual = (a, b) => crypto.timingSafeEqual(sha256(a), sha256(b));
const hashPin = (pin, salt) => crypto.scryptSync(String(pin), salt, 32).toString('hex');

function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

function cleanText(s, max) {
  return String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

const dmRoom = (a, b) => 'dm:' + [a, b].sort().join(':');

function dmMembers(room) {
  if (typeof room !== 'string' || !room.startsWith('dm:')) return null;
  const parts = room.slice(3).split(':');
  if (parts.length !== 2 || !parts.every(findUser) || dmRoom(parts[0], parts[1]) !== room) return null;
  return parts;
}

function canAccess(username, room) {
  const dm = dmMembers(room);
  if (dm) return dm.includes(username);
  return typeof room === 'string' && Object.hasOwn(channels, room);
}

function assertCanPost(username, room) {
  if (!canAccess(username, room)) throw httpError(403, 'No access to this conversation');
  const dm = dmMembers(room);
  if (dm && dm.some((u) => users[u].removed)) throw httpError(403, 'This person is no longer in the team');
}

/** Who receives events for a room: a set of usernames, or null for everyone. */
function audience(room) {
  const dm = dmMembers(room);
  return dm ? new Set(dm) : null;
}

function roomLabel(room) {
  const dm = dmMembers(room);
  return dm ? dm.map((u) => users[u].displayName).join(' & ') : `#${room}`;
}

function publicUser(u) {
  return {
    username: u.username,
    displayName: u.displayName,
    title: u.title || '',
    online: streams.has(u.username),
    lastSeen: u.lastSeen || null,
    role: u.role === 'admin' ? 'admin' : 'member',
    removed: Boolean(u.removed),
  };
}

const EXT_TYPES = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  avif: 'image/avif', bmp: 'image/bmp', mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm',
  mov: 'video/quicktime', mkv: 'video/x-matroska', avi: 'video/x-msvideo', mp3: 'audio/mpeg',
  wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg', oga: 'audio/ogg', pdf: 'application/pdf',
  txt: 'text/plain', csv: 'text/csv', json: 'application/json', zip: 'application/zip',
};

function guessMime(name, claimed) {
  const c = String(claimed || '').split(';')[0].trim().toLowerCase();
  if (/^[\w.+-]+\/[\w.+-]+$/.test(c) && c !== 'application/octet-stream') return c;
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  return EXT_TYPES[ext] || 'application/octet-stream';
}

// Only these are shown inline in the browser; everything else is a download.
// (SVG/HTML are deliberately excluded: they could run scripts.)
const INLINE_TYPES = /^(image\/(png|jpeg|gif|webp|avif|bmp)|video\/[\w.+-]+|audio\/[\w.+-]+|application\/pdf|text\/plain)$/;

function sanitizeFileName(name) {
  const clean = cleanText(name, 200).replace(/[\\/:*?"<>|]+/g, '_').replace(/^\.+/, '');
  return clean || 'file';
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* bad cookie */ }
  }
  return out;
}

function sessionFor(req) {
  const token = parseCookies(req.headers.cookie).sid;
  if (!token) return null;
  const key = hashToken(token);
  const s = sessions[key];
  const user = s && activeUser(s.username);
  return user ? { key, user } : null;
}

function revokeSessions(username) {
  for (const [key, s] of Object.entries(sessions)) if (s.username === username) delete sessions[key];
  saveSessions();
  for (const stream of streams.get(username) || []) stream.end();
}

async function readJsonBody(req, limit = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw httpError(413, 'Request too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return value && typeof value === 'object' ? value : {};
  } catch {
    throw httpError(400, 'Invalid JSON');
  }
}

function sendJson(res, status, body, headers = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(data);
}

// ---------- Live events (Server-Sent Events) ----------

const streams = new Map(); // username -> Set<res>

function sendEvent(res, event, data) {
  if (res.writableEnded || res.destroyed) return; // signed out / closing
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function broadcast(event, data, to = null) {
  for (const [username, set] of streams) {
    if (to && !to.has(username)) continue;
    for (const res of set) sendEvent(res, event, data);
  }
}

function openEventStream(req, res, session) {
  const { username } = session.user;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  res.sessionKey = session.key;
  res.on('error', () => {});

  let set = streams.get(username);
  const wasOnline = Boolean(set);
  if (!set) streams.set(username, (set = new Set()));
  set.add(res);
  sendEvent(res, 'ready', { online: [...streams.keys()] });
  if (!wasOnline) broadcast('presence', { username, online: true });

  const ping = setInterval(() => { if (!res.writableEnded) res.write(': ping\n\n'); }, 25000);
  req.on('close', () => {
    clearInterval(ping);
    set.delete(res);
    if (set.size === 0 && streams.get(username) === set) {
      streams.delete(username);
      const user = findUser(username);
      if (user) {
        user.lastSeen = Date.now();
        saveUsers();
      }
      broadcast('presence', { username, online: false, lastSeen: Date.now() });
    }
  });
}

// ---------- Login throttling ----------

const loginFailures = new Map(); // ip -> { count, resetAt }

function checkThrottle(ip) {
  const f = loginFailures.get(ip);
  if (f && f.count >= 10 && Date.now() < f.resetAt) {
    throw httpError(429, 'Too many wrong attempts. Try again in a few minutes.');
  }
}

function noteFailure(ip) {
  const now = Date.now();
  let f = loginFailures.get(ip);
  if (!f || now > f.resetAt) f = { count: 0, resetAt: now + 15 * 60e3 };
  f.count++;
  loginFailures.set(ip, f);
}

// ---------- API ----------

const CALL_SIGNALS = new Set(['ring', 'accept', 'decline', 'cancel', 'busy', 'offer', 'answer', 'ice', 'end']);

async function handleApi(req, res, url) {
  const route = `${req.method} ${url.pathname}`;

  if (route === 'GET /api/info') {
    return sendJson(res, 200, {
      teamName: config.teamName,
      needsPasscode: Boolean(config.passcode),
      maxUploadMB: config.maxUploadMB,
      signedIn: Boolean(sessionFor(req)),
    });
  }

  // Every state-changing request must carry this header. Browsers do not let
  // other websites add custom headers cross-origin, which blocks CSRF.
  if (req.method === 'POST' && req.headers['x-chat'] !== '1') throw httpError(403, 'Missing X-Chat header');

  if (route === 'POST /api/login') return login(req, res);

  const session = sessionFor(req);
  if (!session) throw httpError(401, 'Please sign in');
  const me = session.user;

  switch (route) {
    case 'GET /api/events':
      return openEventStream(req, res, session);

    case 'GET /api/bootstrap':
      return sendJson(res, 200, bootstrap(me));

    case 'POST /api/logout': {
      delete sessions[session.key];
      saveSessions();
      for (const stream of streams.get(me.username) || []) {
        if (stream.sessionKey === session.key) stream.end();
      }
      return sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookie('', 0) });
    }

    case 'GET /api/history': {
      const room = url.searchParams.get('room');
      if (!canAccess(me.username, room)) throw httpError(403, 'No access to this conversation');
      const list = rooms.get(room) || [];
      const before = url.searchParams.get('before');
      let end = list.length;
      if (before) {
        const i = list.findIndex((m) => m.id === before);
        if (i >= 0) end = i;
      }
      const start = Math.max(0, end - PAGE_SIZE);
      return sendJson(res, 200, { messages: list.slice(start, end), hasMore: start > 0 });
    }

    case 'POST /api/messages': {
      const body = await readJsonBody(req);
      const text = cleanText(body.text, MAX_TEXT);
      if (!text) throw httpError(400, 'Message is empty');
      assertCanPost(me.username, body.room);
      const fields = { room: body.room, from: me.username, text };
      const reply = replySnapshot(body.replyTo, body.room);
      if (reply) fields.reply = reply;
      const mentions = cleanMentions(body.mentions, body.room);
      if (mentions.length) fields.mentions = mentions;
      return sendJson(res, 200, postMessage(fields));
    }

    case 'POST /api/messages/delete': {
      const body = await readJsonBody(req);
      const m = messagesById.get(body.id);
      if (!m || !canAccess(me.username, m.room)) throw httpError(404, 'Message not found');
      if (m.from !== me.username && !isAdmin(me)) throw httpError(403, 'You can only delete your own messages');
      deleteMessage(m);
      return sendJson(res, 200, { ok: true });
    }

    case 'POST /api/messages/pin': {
      const body = await readJsonBody(req);
      const m = messagesById.get(body.id);
      if (!m || !canAccess(me.username, m.room)) throw httpError(404, 'Message not found');
      if (body.pinned) {
        m.pinned = { by: me.username, ts: Date.now() };
        appendLog({ op: 'pin', id: m.id, by: me.username, ts: m.pinned.ts });
      } else {
        delete m.pinned;
        appendLog({ op: 'unpin', id: m.id, ts: Date.now() });
      }
      broadcast('update', m, audience(m.room));
      return sendJson(res, 200, m);
    }

    case 'POST /api/read': {
      const body = await readJsonBody(req);
      if (!canAccess(me.username, body.room)) throw httpError(403, 'No access to this conversation');
      const ts = Number(body.ts) || 0;
      const roomReads = reads[body.room] || (reads[body.room] = {});
      if (ts > (roomReads[me.username] || 0)) {
        roomReads[me.username] = Math.min(ts, Date.now());
        saveReads();
        broadcast('read', { room: body.room, username: me.username, ts: roomReads[me.username] }, audience(body.room));
      }
      return sendJson(res, 200, { ok: true });
    }

    case 'GET /api/search': {
      const q = cleanText(url.searchParams.get('q'), 100).toLowerCase();
      if (q.length < 2) return sendJson(res, 200, { results: [] });
      const results = [];
      for (const [room, list] of rooms) {
        if (!canAccess(me.username, room)) continue;
        for (const m of list) {
          const hay = `${m.text || ''} ${m.file ? m.file.name : ''}`.toLowerCase();
          if (hay.includes(q)) results.push(m);
        }
      }
      results.sort((a, b) => b.ts - a.ts);
      return sendJson(res, 200, { results: results.slice(0, 80), total: results.length });
    }

    case 'GET /api/export':
      return exportRoom(res, url.searchParams.get('room'), me);

    case 'POST /api/upload':
      return upload(req, res, url, me);

    case 'POST /api/typing': {
      const body = await readJsonBody(req);
      if (!canAccess(me.username, body.room)) throw httpError(403, 'No access to this conversation');
      const to = audience(body.room) || new Set(streams.keys());
      to.delete(me.username);
      broadcast('typing', { room: body.room, username: me.username }, to);
      return sendJson(res, 200, { ok: true });
    }

    case 'POST /api/channels': {
      const body = await readJsonBody(req);
      const id = slugify(body.name);
      if (!id) throw httpError(400, 'Channel name is required');
      if (channels[id]) throw httpError(409, `#${id} already exists`);
      channels[id] = { id, topic: cleanText(body.topic, 200), createdBy: me.username, createdAt: Date.now() };
      saveChannels();
      broadcast('channel', channels[id]);
      return sendJson(res, 200, channels[id]);
    }

    case 'POST /api/profile': {
      const body = await readJsonBody(req);
      const displayName = cleanText(body.displayName, 60);
      if (displayName) me.displayName = displayName;
      if (body.title !== undefined) me.title = cleanText(body.title, 60);
      saveUsers();
      broadcast('user', publicUser(me));
      return sendJson(res, 200, publicUser(me));
    }

    case 'POST /api/broadcast': {
      const body = await readJsonBody(req);
      const text = cleanText(body.text, MAX_TEXT);
      if (!text) throw httpError(400, 'Message is empty');
      const wanted = Array.isArray(body.to) ? new Set(body.to.map(String)) : null;
      const recipients = Object.values(users)
        .filter((u) => !u.removed && u.username !== me.username && (!wanted || wanted.has(u.username)));
      if (!recipients.length) throw httpError(400, 'Choose at least one person');
      for (const u of recipients) {
        postMessage({ room: dmRoom(me.username, u.username), from: me.username, text, broadcast: true });
      }
      return sendJson(res, 200, { ok: true, count: recipients.length });
    }

    case 'POST /api/call/signal': {
      const body = await readJsonBody(req, 256 * 1024);
      const peer = activeUser(body.to);
      if (!peer || peer.username === me.username) throw httpError(400, 'Unknown person');
      if (!CALL_SIGNALS.has(body.type)) throw httpError(400, 'Unknown call signal');
      if (body.type === 'ring' && !streams.has(peer.username)) throw httpError(409, `${peer.displayName} is offline`);
      const signal = {
        type: body.type, callId: String(body.callId || '').slice(0, 40), tab: String(body.tab || '').slice(0, 40),
        from: me.username, to: peer.username, kind: body.kind === 'video' ? 'video' : 'audio', data: body.data ?? null,
      };
      broadcast('call', signal, new Set([peer.username, me.username]));
      return sendJson(res, 200, { ok: true });
    }

    case 'POST /api/call/log': {
      const body = await readJsonBody(req);
      const peer = activeUser(body.to);
      if (!peer) throw httpError(400, 'Unknown person');
      const call = {
        kind: body.kind === 'video' ? 'video' : 'audio',
        status: ['completed', 'missed', 'declined'].includes(body.status) ? body.status : 'completed',
        duration: Math.max(0, Math.min(Math.round(Number(body.duration) || 0), 24 * 3600)),
      };
      return sendJson(res, 200, postMessage({ room: dmRoom(me.username, peer.username), from: me.username, call }));
    }

    case 'GET /api/admin/overview':
      requireAdmin(me);
      return sendJson(res, 200, adminOverview());

    case 'POST /api/admin/user':
      requireAdmin(me);
      return sendJson(res, 200, adminUserAction(me, await readJsonBody(req)));

    case 'POST /api/admin/channel':
      requireAdmin(me);
      return sendJson(res, 200, adminChannelAction(await readJsonBody(req)));

    case 'POST /api/admin/backup':
      requireAdmin(me);
      await runBackup(true);
      return sendJson(res, 200, { backup: backupStatus });
  }
  throw httpError(404, 'Not found');
}

function cookie(token, maxAgeSeconds) {
  const secure = useTls ? '; Secure' : '';
  return `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}${secure}`;
}

async function login(req, res) {
  const ip = req.socket.remoteAddress;
  checkThrottle(ip);
  const body = await readJsonBody(req);

  if (config.passcode && !safeEqual(body.passcode || '', config.passcode)) {
    noteFailure(ip);
    throw httpError(403, 'Wrong team passcode');
  }
  const typedName = normalizeUsername(body.username);
  const username = typedName.toLowerCase();
  if (!USERNAME_RE.test(username)) {
    throw httpError(400, 'Username: 2–32 characters. Letters, numbers, spaces, dot, dash or underscore');
  }
  const pin = String(body.pin || '');
  if (pin.length < 4 || pin.length > 64) throw httpError(400, 'PIN must be at least 4 characters');

  const displayName = cleanText(body.displayName, 60);
  const title = cleanText(body.title, 60);
  let user = findUser(username);
  if (user) {
    if (user.removed) throw httpError(403, 'This account was removed by an admin');
    if (!safeEqual(hashPin(pin, user.salt), user.pinHash)) {
      noteFailure(ip);
      throw httpError(401, 'Wrong PIN for this username');
    }
    if (displayName) user.displayName = displayName;
    if (title) user.title = title;
  } else {
    const salt = crypto.randomBytes(16).toString('hex');
    user = users[username] = {
      username, displayName: displayName || typedName, title, salt,
      pinHash: hashPin(pin, salt), createdAt: Date.now(), lastSeen: null,
    };
    ensureAdmin();
  }
  saveUsers();
  broadcast('user', publicUser(user));

  const token = crypto.randomBytes(32).toString('base64url');
  sessions[hashToken(token)] = { username, createdAt: Date.now() };
  saveSessions();
  loginFailures.delete(ip);
  return sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookie(token, SESSION_DAYS * 86400) });
}

function bootstrap(me) {
  const roomsOut = {};
  const readsOut = {};
  const olderPins = {}; // pinned messages older than the first page, for the pins list
  const hasMore = [];
  for (const [room, list] of rooms) {
    if (!canAccess(me.username, room) || list.length === 0) continue;
    roomsOut[room] = list.slice(-PAGE_SIZE);
    if (list.length > PAGE_SIZE) {
      hasMore.push(room);
      const pins = list.slice(0, -PAGE_SIZE).filter((m) => m.pinned);
      if (pins.length) olderPins[room] = pins;
    }
  }
  for (const [room, r] of Object.entries(reads)) if (canAccess(me.username, room)) readsOut[room] = r;
  return {
    me: publicUser(me),
    teamName: config.teamName,
    maxUploadMB: config.maxUploadMB,
    users: Object.values(users).map(publicUser),
    channels: Object.values(channels),
    rooms: roomsOut,
    reads: readsOut,
    olderPins,
    hasMore,
  };
}

function postMessage(fields) {
  const m = { id: newId(), ts: Date.now(), ...fields };
  indexMessage(m);
  appendLog(m);
  broadcast('msg', m, audience(m.room));
  return m;
}

function deleteMessage(m) {
  unindexMessage(m);
  appendLog({ op: 'delete', id: m.id, ts: Date.now() });
  if (m.file) fs.rm(path.join(UPLOAD_DIR, m.file.id), { force: true }, () => {});
  broadcast('delete', { id: m.id, room: m.room }, audience(m.room));
}

function snippet(m) {
  if (m.text) return m.text.slice(0, 200);
  if (m.file) return m.file.voice ? 'Voice message' : m.file.name;
  if (m.call) return m.call.kind === 'video' ? 'Video call' : 'Voice call';
  return '';
}

function replySnapshot(id, room) {
  const m = id ? messagesById.get(String(id)) : null;
  return m && m.room === room ? { id: m.id, from: m.from, text: snippet(m) } : null;
}

function cleanMentions(list, room) {
  if (!Array.isArray(list)) return [];
  const out = new Set();
  for (const u of list.slice(0, 50)) {
    if (u === 'all' && !room.startsWith('dm:')) out.add('all');
    else if (activeUser(u) && canAccess(u, room)) out.add(u);
  }
  return [...out];
}

async function upload(req, res, url, me) {
  const room = url.searchParams.get('room');
  assertCanPost(me.username, room);
  const name = sanitizeFileName(url.searchParams.get('name'));
  const declared = Number(req.headers['content-length']);
  if (!Number.isFinite(declared)) throw httpError(411, 'Content-Length required');
  if (declared > MAX_UPLOAD_BYTES) throw httpError(413, `File is larger than the ${config.maxUploadMB} MB limit`);

  const fileId = newId();
  const finalPath = path.join(UPLOAD_DIR, fileId);
  const tmpPath = finalPath + '.part';
  let size = 0;
  const limiter = new Transform({
    transform(chunk, _enc, cb) {
      size += chunk.length;
      if (size > MAX_UPLOAD_BYTES) return cb(httpError(413, 'File too large'));
      cb(null, chunk);
    },
  });
  try {
    await pipeline(req, limiter, fs.createWriteStream(tmpPath));
  } catch (err) {
    fs.rm(tmpPath, { force: true }, () => {});
    throw err;
  }
  if (size === 0) {
    fs.rm(tmpPath, { force: true }, () => {});
    throw httpError(400, 'File is empty');
  }
  fs.renameSync(tmpPath, finalPath);
  const file = { id: fileId, name, size, mime: guessMime(name, req.headers['content-type']) };
  if (url.searchParams.get('voice') === '1' && file.mime.startsWith('audio/')) {
    file.voice = true;
    file.duration = Math.max(0, Math.min(Number(url.searchParams.get('duration')) || 0, 3600));
  }
  const fields = { room, from: me.username, file };
  const reply = replySnapshot(url.searchParams.get('replyTo'), room);
  if (reply) fields.reply = reply;
  return sendJson(res, 200, postMessage(fields));
}

function exportRoom(res, room, me) {
  if (!canAccess(me.username, room)) throw httpError(403, 'No access to this conversation');
  const name = (u) => (findUser(u) ? users[u].displayName : u);
  const stamp = (ts) => {
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const lines = [
    `${config.teamName} chat: ${roomLabel(room)}`,
    `Exported by ${me.displayName} on ${stamp(Date.now())}`,
    '',
  ];
  for (const m of rooms.get(room) || []) {
    let body = m.text || '';
    if (m.file) body = `${body ? body + ' ' : ''}[${m.file.voice ? 'voice message' : 'file'}: ${m.file.name}, ${Math.ceil(m.file.size / 1024)} KB]`;
    if (m.call) body = `[${m.call.kind} call, ${m.call.status}${m.call.duration ? `, ${Math.round(m.call.duration / 60)} min` : ''}]`;
    if (m.reply) body = `(reply to ${name(m.reply.from)}: "${m.reply.text.slice(0, 60)}") ${body}`;
    if (m.broadcast) body = `[broadcast] ${body}`;
    lines.push(`[${stamp(m.ts)}] ${name(m.from)}: ${body}`);
  }
  const fileName = `chat-${roomLabel(room).replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '')}-${stamp(Date.now()).slice(0, 10)}.txt`;
  const data = '\ufeff' + lines.join('\r\n') + '\r\n'; // BOM so Notepad shows Urdu text correctly
  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Disposition': `attachment; filename="chat-export.txt"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

// ---------- Admin ----------

function requireAdmin(me) {
  if (!isAdmin(me)) throw httpError(403, 'Only admins can do this');
}

function adminOverview() {
  let files = 0;
  let bytes = 0;
  for (const m of filesById.values()) { files++; bytes += m.file.size; }
  let messages = 0;
  for (const list of rooms.values()) messages += list.length;
  return {
    users: Object.values(users)
      .map((u) => ({ ...publicUser(u), createdAt: u.createdAt }))
      .sort((a, b) => a.removed - b.removed || a.displayName.localeCompare(b.displayName)),
    stats: { messages, files, bytes, channels: Object.keys(channels).length },
    backup: { ...backupStatus, dir: config.backupDir, keepDays: config.backupDays },
  };
}

function adminUserAction(me, body) {
  const u = findUser(String(body.username || ''));
  if (!u) throw httpError(404, 'User not found');
  const adminCount = Object.values(users).filter(isAdmin).length;
  switch (body.action) {
    case 'reset-pin': {
      const pin = String(body.pin || '');
      if (pin.length < 4 || pin.length > 64) throw httpError(400, 'New PIN must be at least 4 characters');
      u.salt = crypto.randomBytes(16).toString('hex');
      u.pinHash = hashPin(pin, u.salt);
      saveUsers();
      if (u.username !== me.username) revokeSessions(u.username);
      break;
    }
    case 'remove':
      if (u.username === me.username) throw httpError(400, 'You cannot remove yourself');
      if (isAdmin(u) && adminCount <= 1) throw httpError(400, 'Make someone else admin first');
      u.removed = true;
      delete u.role;
      saveUsers();
      revokeSessions(u.username);
      break;
    case 'restore':
      delete u.removed;
      saveUsers();
      break;
    case 'make-admin':
      if (u.removed) throw httpError(400, 'Restore this person first');
      u.role = 'admin';
      saveUsers();
      break;
    case 'remove-admin':
      if (adminCount <= 1 && isAdmin(u)) throw httpError(400, 'There must be at least one admin');
      delete u.role;
      saveUsers();
      break;
    default:
      throw httpError(400, 'Unknown action');
  }
  broadcast('user', publicUser(u));
  return publicUser(u);
}

function adminChannelAction(body) {
  const c = Object.hasOwn(channels, String(body.id)) ? channels[body.id] : null;
  if (!c) throw httpError(404, 'Channel not found');
  if (body.action === 'topic') {
    c.topic = cleanText(body.topic, 200);
    saveChannels();
    broadcast('channel', c);
    return c;
  }
  if (body.action === 'delete') {
    if (Object.keys(channels).length <= 1) throw httpError(400, 'Keep at least one channel');
    for (const m of [...(rooms.get(c.id) || [])]) deleteMessage(m);
    rooms.delete(c.id);
    delete channels[c.id];
    delete reads[c.id];
    saveChannels();
    saveReads();
    broadcast('channel-delete', { id: c.id });
    return { ok: true };
  }
  throw httpError(400, 'Unknown action');
}

// ---------- Daily backups ----------
// Every day: a dated copy of the chat history and accounts (kept for `backupDays`),
// plus a mirror of all shared files. Point backupDir at another drive for real safety.

const backupStatus = { lastAt: null, lastDir: null, ok: null, error: null, running: false };

async function runBackup(force = false) {
  if (!config.backupDir || backupStatus.running) return;
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const dayDir = path.join(config.backupDir, today);
  if (!force && fs.existsSync(path.join(dayDir, 'messages.jsonl'))) return;
  backupStatus.running = true;
  const fsp = fs.promises;
  try {
    await fsp.mkdir(dayDir, { recursive: true });
    for (const f of ['users.json', 'channels.json', 'reads.json', 'messages.jsonl']) {
      if (fs.existsSync(path.join(DATA_DIR, f))) await fsp.copyFile(path.join(DATA_DIR, f), path.join(dayDir, f));
    }
    // Mirror uploads: copy new files; keep deleted ones for backupDays before removing them.
    const mirror = path.join(config.backupDir, 'uploads');
    await fsp.mkdir(mirror, { recursive: true });
    const current = new Set((await fsp.readdir(UPLOAD_DIR)).filter((f) => !f.endsWith('.part')));
    for (const f of current) {
      const src = path.join(UPLOAD_DIR, f);
      const dst = path.join(mirror, f);
      const [a, b] = await Promise.all([fsp.stat(src), fsp.stat(dst).catch(() => null)]);
      if (!b || a.size !== b.size) await fsp.copyFile(src, dst);
    }
    // Remember when each file was first seen deleted, so it stays backupDays from deletion.
    const cutoff = Date.now() - config.backupDays * 864e5;
    const goneFile = path.join(config.backupDir, 'deleted-uploads.json');
    let gone = {};
    try { gone = JSON.parse(await fsp.readFile(goneFile, 'utf8')); } catch { /* first run */ }
    const next = {};
    for (const f of await fsp.readdir(mirror)) {
      if (current.has(f)) continue;
      const since = Number(gone[f]) || Date.now();
      if (since < cutoff) await fsp.rm(path.join(mirror, f), { force: true });
      else next[f] = since;
    }
    await fsp.writeFile(goneFile, JSON.stringify(next));
    // Remove dated folders older than backupDays.
    for (const entry of await fsp.readdir(config.backupDir)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(entry)) continue;
      if (new Date(`${entry}T00:00:00`).getTime() < cutoff) {
        await fsp.rm(path.join(config.backupDir, entry), { recursive: true, force: true });
      }
    }
    Object.assign(backupStatus, { lastAt: Date.now(), lastDir: dayDir, ok: true, error: null });
  } catch (err) {
    Object.assign(backupStatus, { lastAt: Date.now(), ok: false, error: err.message });
    console.error(`Backup failed: ${err.message}`);
  } finally {
    backupStatus.running = false;
  }
}

// ---------- Serving uploaded files (with Range support so videos can seek) ----------

function serveUpload(req, res, url) {
  const session = sessionFor(req);
  if (!session) throw httpError(401, 'Please sign in');
  const fileId = url.pathname.split('/')[2] || '';
  const m = filesById.get(fileId);
  if (!m || !canAccess(session.user.username, m.room)) throw httpError(404, 'File not found');

  const filePath = path.join(UPLOAD_DIR, m.file.id);
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    throw httpError(404, 'File is missing on the server');
  }
  const total = stat.size;
  const inline = INLINE_TYPES.test(m.file.mime) && !url.searchParams.has('download');
  const asciiName = m.file.name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const headers = {
    'Content-Type': inline ? m.file.mime : 'application/octet-stream',
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(m.file.name)}`,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': 'sandbox',
  };

  let start = 0;
  let end = total - 1;
  let status = 200;
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range && (range[1] || range[2])) {
    if (range[1] === '') {
      start = Math.max(0, total - Number(range[2]));
    } else {
      start = Number(range[1]);
      if (range[2] !== '') end = Math.min(Number(range[2]), total - 1);
    }
    if (start > end || start >= total) {
      res.writeHead(416, { 'Content-Range': `bytes */${total}` });
      return res.end();
    }
    status = 206;
    headers['Content-Range'] = `bytes ${start}-${end}/${total}`;
  }
  headers['Content-Length'] = end - start + 1;
  res.writeHead(status, headers);
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(filePath, { start, end }).on('error', () => res.destroy()).pipe(res);
}

// ---------- Static web app ----------

const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/setup': ['setup.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/calls.js': ['calls.js', 'text/javascript; charset=utf-8'],
  '/setup.js': ['setup.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/icon.svg': ['icon.svg', 'image/svg+xml'],
};

const pageCsp = (connect = "'self'") => [
  "default-src 'self'",
  "img-src 'self' blob: data:",
  "media-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  `connect-src ${connect}`,
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

function serveStatic(res, [file, type], csp = pageCsp()) {
  const body = fs.readFileSync(path.join(PUBLIC_DIR, file));
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': body.length,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    // Allow the microphone, camera and screen sharing for calls and voice messages.
    'Permissions-Policy': 'microphone=(self), camera=(self), display-capture=(self)',
    ...(type.startsWith('text/html') ? { 'Content-Security-Policy': csp } : {}),
  });
  res.end(body);
}

function serveCaCert(res) {
  if (!tls || !tls.caCertPath) throw httpError(404, 'HTTPS certificate is not managed by this server');
  const body = fs.readFileSync(tls.caCertPath);
  res.writeHead(200, {
    'Content-Type': 'application/x-x509-ca-cert',
    'Content-Disposition': 'attachment; filename="AI-Department-Chat-Certificate.crt"',
    'Content-Length': body.length,
    'Cache-Control': 'no-cache',
  });
  res.end(body);
}

// ---------- Server ----------

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  try {
    const isGet = req.method === 'GET' || req.method === 'HEAD';
    if (isGet && url.pathname === '/ca.crt') return serveCaCert(res);
    if (isGet && STATIC[url.pathname]) return serveStatic(res, STATIC[url.pathname]);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (isGet && url.pathname.startsWith('/files/')) return serveUpload(req, res, url);
    throw httpError(404, 'Not found');
  } catch (err) {
    if (!err.status) console.error(err);
    if (res.headersSent || res.destroyed) return res.destroy();
    sendJson(res, err.status || 500, { error: err.status ? err.message : 'Server error' });
  }
}

/**
 * Plain-http requests when HTTPS is on. Pages get the setup screen, which checks
 * whether this computer already trusts the chat certificate and, if so, moves
 * straight on to https. So old http:// bookmarks keep working.
 */
function handlePlain(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const isGet = req.method === 'GET' || req.method === 'HEAD';
  try {
    if (isGet && url.pathname === '/ca.crt') return serveCaCert(res);
    if (isGet && ['/', '/index.html', '/setup'].includes(url.pathname)) {
      return serveStatic(res, STATIC['/setup'], pageCsp("'self' https:"));
    }
    if (isGet && ['/setup.js', '/styles.css', '/icon.svg'].includes(url.pathname)) return serveStatic(res, STATIC[url.pathname]);
  } catch (err) {
    return sendJson(res, err.status || 500, { error: err.message });
  }
  const host = req.headers.host || `localhost:${config.port}`;
  res.writeHead(307, { Location: `https://${host}${req.url}` });
  res.end();
}

let tls = null;
if (config.tlsKey && config.tlsCert) {
  tls = { key: fs.readFileSync(config.tlsKey), cert: fs.readFileSync(config.tlsCert), caCertPath: null };
} else if (config.https) {
  tls = ensureCertificates(path.join(DATA_DIR, 'tls'));
}
const useTls = Boolean(tls);

const appServer = useTls ? https.createServer({ key: tls.key, cert: tls.cert }, handle) : http.createServer(handle);
appServer.requestTimeout = 0; // big video uploads on a slow network can take a long time
let listener = appServer;

if (useTls) {
  // Serve https and http on the same port: look at the first byte of each connection
  // (0x16 starts a TLS handshake) and hand it to the matching server.
  const plainServer = http.createServer(handlePlain);
  listener = net.createServer((socket) => {
    socket.setTimeout(30000, () => socket.destroy());
    socket.on('error', () => socket.destroy());
    socket.once('readable', () => {
      const first = socket.read(1);
      if (!first) return socket.destroy();
      socket.unshift(first);
      socket.setTimeout(0);
      (first[0] === 0x16 ? appServer : plainServer).emit('connection', socket);
    });
  });
}

listener.listen(config.port, config.host, () => {
  const scheme = useTls ? 'https' : 'http';
  const addresses = Object.values(os.networkInterfaces()).flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => `${scheme}://${a.address}:${config.port}`);
  console.log(`\n  ${config.teamName} chat is running.\n`);
  console.log(`  On this computer:      ${scheme}://localhost:${config.port}`);
  for (const a of addresses) console.log(`  Colleagues open:       ${a}`);
  if (useTls && tls.caCertPath) {
    console.log(`\n  Secure (https) is ON, needed for voice messages and calls.`);
    console.log(`  First time on each computer, open the address above and follow the 1-minute setup.`);
  }
  console.log(`\n  Team passcode: ${config.passcode ? 'required' : 'OFF (anyone on the network can join; set one in config.json)'}`);
  console.log(`  Upload limit:  ${config.maxUploadMB} MB per file`);
  console.log(`  Data folder:   ${DATA_DIR}`);
  console.log(`  Backups:       ${config.backupDir ? `${config.backupDir} (daily, kept ${config.backupDays} days)` : 'OFF'}\n`);
});

// Daily backup: shortly after start, then checked every hour.
if (config.backupDir) {
  setTimeout(() => runBackup(), 15000).unref();
  setInterval(() => runBackup(), 60 * 60e3).unref();
}

function shutdown() {
  console.log('\nStopping chat server…');
  clearTimeout(readsTimer);
  writeJSON('reads.json', reads);
  messageLog.end(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
