#!/usr/bin/env node
'use strict';
/*
 * AI Department Office Chat — a messenger for the office network (LAN).
 * Text chat, channels, direct messages and file / image / video sharing.
 *
 * Zero dependencies: needs only Node.js 18 or newer.  Run:  node server.js
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');

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
  return {
    port: Number(pick('PORT', 'port', 8080)),
    host: String(pick('HOST', 'host', '0.0.0.0')),
    teamName: String(pick('TEAM_NAME', 'teamName', 'AI Department')),
    passcode: String(pick('TEAM_PASSCODE', 'passcode', '')),
    maxUploadMB: Number(pick('MAX_UPLOAD_MB', 'maxUploadMB', 2048)),
    dataDir: path.resolve(__dirname, String(pick('DATA_DIR', 'dataDir', 'data'))),
    tlsKey: String(pick('TLS_KEY', 'tlsKey', '')),
    tlsCert: String(pick('TLS_CERT', 'tlsCert', '')),
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

const users = readJSON('users.json', {}); // username -> { username, displayName, title, salt, pinHash, createdAt, lastSeen }
const sessions = readJSON('sessions.json', {}); // sha256(token) -> { username, createdAt }
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

// Expire old sessions on startup.
for (const [key, s] of Object.entries(sessions)) {
  if (Date.now() - s.createdAt > SESSION_DAYS * 864e5 || !users[s.username]) delete sessions[key];
}
saveSessions();

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
    if (rec.op === 'delete') {
      const m = messagesById.get(rec.id);
      if (m) unindexMessage(m);
    } else {
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
const findUser = (u) => (Object.hasOwn(users, u) ? users[u] : null);
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
  return typeof room === 'string' && Object.prototype.hasOwnProperty.call(channels, room);
}

/** Who receives events for a room: a set of usernames, or null for everyone. */
function audience(room) {
  const dm = dmMembers(room);
  return dm ? new Set(dm) : null;
}

function publicUser(u) {
  return {
    username: u.username,
    displayName: u.displayName,
    title: u.title || '',
    online: streams.has(u.username),
    lastSeen: u.lastSeen || null,
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
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function sessionFor(req) {
  const token = parseCookies(req.headers.cookie).sid;
  if (!token) return null;
  const key = hashToken(token);
  const s = sessions[key];
  if (!s || !users[s.username]) return null;
  return { key, user: users[s.username] };
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

  let set = streams.get(username);
  const wasOnline = Boolean(set);
  if (!set) streams.set(username, (set = new Set()));
  set.add(res);
  sendEvent(res, 'ready', { online: [...streams.keys()] });
  if (!wasOnline) broadcast('presence', { username, online: true });

  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    set.delete(res);
    if (set.size === 0 && streams.get(username) === set) {
      streams.delete(username);
      const user = users[username];
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
      if (!canAccess(me.username, body.room)) throw httpError(403, 'No access to this conversation');
      return sendJson(res, 200, postMessage({ room: body.room, from: me.username, text }));
    }

    case 'POST /api/messages/delete': {
      const body = await readJsonBody(req);
      const m = messagesById.get(body.id);
      if (!m) throw httpError(404, 'Message not found');
      if (m.from !== me.username) throw httpError(403, 'You can only delete your own messages');
      unindexMessage(m);
      appendLog({ op: 'delete', id: m.id, ts: Date.now() });
      if (m.file) fs.rm(path.join(UPLOAD_DIR, m.file.id), { force: true }, () => {});
      broadcast('delete', { id: m.id, room: m.room }, audience(m.room));
      return sendJson(res, 200, { ok: true });
    }

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
  }
  throw httpError(404, 'Not found');
}

function cookie(token, maxAgeSeconds) {
  const secure = config.tlsKey && config.tlsCert ? '; Secure' : '';
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
  const hasMore = [];
  for (const [room, list] of rooms) {
    if (!canAccess(me.username, room) || list.length === 0) continue;
    roomsOut[room] = list.slice(-PAGE_SIZE);
    if (list.length > PAGE_SIZE) hasMore.push(room);
  }
  return {
    me: publicUser(me),
    teamName: config.teamName,
    maxUploadMB: config.maxUploadMB,
    users: Object.values(users).map(publicUser),
    channels: Object.values(channels),
    rooms: roomsOut,
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

async function upload(req, res, url, me) {
  const room = url.searchParams.get('room');
  if (!canAccess(me.username, room)) throw httpError(403, 'No access to this conversation');
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
  return sendJson(res, 200, postMessage({ room, from: me.username, file }));
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
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/icon.svg': ['icon.svg', 'image/svg+xml'],
};

const PAGE_CSP = [
  "default-src 'self'",
  "img-src 'self' blob: data:",
  "media-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

function serveStatic(res, [file, type]) {
  const body = fs.readFileSync(path.join(PUBLIC_DIR, file));
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': body.length,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...(type.startsWith('text/html') ? { 'Content-Security-Policy': PAGE_CSP } : {}),
  });
  res.end(body);
}

// ---------- Server ----------

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  try {
    if ((req.method === 'GET' || req.method === 'HEAD') && STATIC[url.pathname]) return serveStatic(res, STATIC[url.pathname]);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname.startsWith('/files/')) return serveUpload(req, res, url);
    throw httpError(404, 'Not found');
  } catch (err) {
    if (!err.status) console.error(err);
    if (res.headersSent || res.destroyed) return res.destroy();
    sendJson(res, err.status || 500, { error: err.status ? err.message : 'Server error' });
  }
}

const useTls = Boolean(config.tlsKey && config.tlsCert);
const server = useTls
  ? https.createServer({ key: fs.readFileSync(config.tlsKey), cert: fs.readFileSync(config.tlsCert) }, handle)
  : http.createServer(handle);
server.requestTimeout = 0; // big video uploads on a slow network can take a long time

server.listen(config.port, config.host, () => {
  const scheme = useTls ? 'https' : 'http';
  const addresses = Object.values(os.networkInterfaces()).flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => `${scheme}://${a.address}:${config.port}`);
  console.log(`\n  ${config.teamName} chat is running.\n`);
  console.log(`  On this computer:      ${scheme}://localhost:${config.port}`);
  for (const a of addresses) console.log(`  Colleagues open:       ${a}`);
  console.log(`\n  Team passcode: ${config.passcode ? 'required' : 'OFF (anyone on the network can join; set one in config.json)'}`);
  console.log(`  Upload limit:  ${config.maxUploadMB} MB per file`);
  console.log(`  Data folder:   ${DATA_DIR}\n`);
});

function shutdown() {
  console.log('\nStopping chat server…');
  messageLog.end(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
