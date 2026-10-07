'use strict';
/*
 * Creates the HTTPS certificates for the office chat, with no extra software.
 *
 * - A private "certificate authority" (CA) for the chat, made once and valid for 10 years.
 *   Colleagues install ca.crt once to remove the browser's "Not secure" warning.
 * - A server certificate signed by that CA, listing this computer's IP addresses and name.
 *   It is renewed automatically when the IP address changes or it gets close to expiry,
 *   and because the CA stays the same, nobody has to install anything again.
 *
 * Browsers only allow the microphone, camera and screen sharing on https pages,
 * which is why voice messages and calls need this.
 */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ---------- Minimal DER (ASN.1) encoder ----------

function len(n) {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = [];
  while (n > 0) { bytes.unshift(n & 0xff); n >>= 8; }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const tlv = (tag, body) => Buffer.concat([Buffer.from([tag]), len(body.length), body]);
const seq = (...items) => tlv(0x30, Buffer.concat(items));
const set = (...items) => tlv(0x31, Buffer.concat(items));
const explicit = (n, body) => tlv(0xa0 + n, body);
const nul = () => Buffer.from([0x05, 0x00]);
const bool = (v) => tlv(0x01, Buffer.from([v ? 0xff : 0x00]));
const octets = (b) => tlv(0x04, b);
const utf8 = (s) => tlv(0x0c, Buffer.from(s, 'utf8'));
const bitString = (b, unused = 0) => tlv(0x03, Buffer.concat([Buffer.from([unused]), b]));

function integer(buf) {
  let b = Buffer.from(buf);
  while (b.length > 1 && b[0] === 0 && !(b[1] & 0x80)) b = b.subarray(1);
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
  return tlv(0x02, b);
}

function oid(str) {
  const parts = str.split('.').map(Number);
  const out = [40 * parts[0] + parts[1]];
  for (const p of parts.slice(2)) {
    const stack = [p & 0x7f];
    let v = p >> 7;
    while (v > 0) { stack.unshift((v & 0x7f) | 0x80); v >>= 7; }
    out.push(...stack);
  }
  return tlv(0x06, Buffer.from(out));
}

function time(date) {
  // UTCTime for years before 2050, GeneralizedTime after (RFC 5280).
  const iso = date.toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z';
  return date.getUTCFullYear() < 2050 ? tlv(0x17, Buffer.from(iso.slice(2))) : tlv(0x18, Buffer.from(iso));
}

const name = (cn) => seq(
  set(seq(oid('2.5.4.10'), utf8('AI Department Office Chat'))),
  set(seq(oid('2.5.4.3'), utf8(cn))),
);

const ext = (id, critical, value) => seq(oid(id), ...(critical ? [bool(true)] : []), octets(value));
const SHA256_RSA = seq(oid('1.2.840.113549.1.1.11'), nul());

function keyId(publicKey) {
  return crypto.createHash('sha1').update(publicKey.export({ type: 'spki', format: 'der' })).digest();
}

function makeCert({ subject, issuer, publicKey, signingKey, days, extensions }) {
  const now = new Date(Date.now() - 60 * 60e3); // an hour of slack for clock differences
  const tbs = seq(
    explicit(0, integer(Buffer.from([2]))), // version 3
    integer(crypto.randomBytes(16)),
    SHA256_RSA,
    name(issuer),
    seq(time(now), time(new Date(now.getTime() + days * 864e5))),
    name(subject),
    publicKey.export({ type: 'spki', format: 'der' }),
    explicit(3, seq(...extensions)),
  );
  const signature = crypto.sign('sha256', tbs, signingKey);
  const der = seq(tbs, SHA256_RSA, bitString(signature));
  return `-----BEGIN CERTIFICATE-----\n${der.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`;
}

// ---------- CA + server certificate management ----------

function localAddresses() {
  return Object.values(os.networkInterfaces()).flat()
    .filter((a) => a && a.family === 'IPv4')
    .map((a) => a.address);
}

function ipBytes(ip) {
  return Buffer.from(ip.split('.').map(Number));
}

/**
 * Returns { key, cert, caCertPath } for the HTTPS server, creating or renewing
 * certificates in `dir` as needed.
 */
function ensureCertificates(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const p = (f) => path.join(dir, f);

  // 1. The CA (made once).
  if (!fs.existsSync(p('ca.key')) || !fs.existsSync(p('ca.crt'))) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const cert = makeCert({
      subject: 'AI Department Chat CA', issuer: 'AI Department Chat CA',
      publicKey, signingKey: privateKey, days: 3650,
      extensions: [
        ext('2.5.29.19', true, seq(bool(true))), // basicConstraints: CA
        ext('2.5.29.15', true, bitString(Buffer.from([0x06]), 1)), // keyUsage: keyCertSign, cRLSign
        ext('2.5.29.14', false, octets(keyId(publicKey))), // subjectKeyIdentifier
      ],
    });
    fs.writeFileSync(p('ca.key'), privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    fs.writeFileSync(p('ca.crt'), cert);
  }
  const caKey = crypto.createPrivateKey(fs.readFileSync(p('ca.key')));
  const caCert = new crypto.X509Certificate(fs.readFileSync(p('ca.crt')));

  // 2. The server certificate (renewed when addresses change or it nears expiry).
  const hostname = os.hostname().toLowerCase();
  const ips = [...new Set(['127.0.0.1', ...localAddresses()])].sort();
  const dns = [...new Set(['localhost', hostname, `${hostname}.local`].filter((h) => /^[a-z0-9.-]+$/.test(h)))];
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(p('server.json'), 'utf8')); } catch { /* first run */ }
  const fresh = fs.existsSync(p('server.key')) && fs.existsSync(p('server.crt')) &&
    JSON.stringify(meta.ips) === JSON.stringify(ips) && JSON.stringify(meta.dns) === JSON.stringify(dns) &&
    meta.expires - Date.now() > 30 * 864e5;

  if (!fresh) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const altNames = [
      ...dns.map((d) => tlv(0x82, Buffer.from(d))),
      ...ips.map((ip) => tlv(0x87, ipBytes(ip))),
    ];
    const days = 397; // browsers reject server certificates valid for longer
    const cert = makeCert({
      subject: ips.find((ip) => ip !== '127.0.0.1') || 'localhost', issuer: 'AI Department Chat CA',
      publicKey, signingKey: caKey, days,
      extensions: [
        ext('2.5.29.19', true, seq()), // basicConstraints: not a CA
        ext('2.5.29.15', true, bitString(Buffer.from([0xa0]), 5)), // digitalSignature, keyEncipherment
        ext('2.5.29.37', false, seq(oid('1.3.6.1.5.5.7.3.1'))), // extKeyUsage: serverAuth
        ext('2.5.29.17', false, seq(...altNames)), // subjectAltName
        ext('2.5.29.14', false, octets(keyId(publicKey))),
        ext('2.5.29.35', false, seq(tlv(0x80, keyId(caCert.publicKey)))), // authorityKeyIdentifier
      ],
    });
    fs.writeFileSync(p('server.key'), privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    fs.writeFileSync(p('server.crt'), cert);
    fs.writeFileSync(p('server.json'), JSON.stringify({ ips, dns, expires: Date.now() + days * 864e5 }, null, 2));
  }

  return {
    key: fs.readFileSync(p('server.key')),
    // Send the CA along with the server certificate so the browser can build the chain.
    cert: Buffer.concat([fs.readFileSync(p('server.crt')), fs.readFileSync(p('ca.crt'))]),
    caCertPath: p('ca.crt'),
  };
}

module.exports = { ensureCertificates };
