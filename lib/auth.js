/* Admin password check for api/admin/*. One shared password in ADMIN_PASSWORD, sent as `Authorization: Bearer …`.
   Constant-time compare on SHA-256 digests (so lengths never leak), and 10 bad tries per hour per IP → 429.
   The counter is in memory, which on serverless means per warm instance; good enough for a two-person bakery.
   Upgrade path when there are several staff: Supabase Auth (magic links) and verify the JWT here instead. */
'use strict';

const crypto = require('crypto');
const { clientIp } = require('./http.js');

const WINDOW_MS = 60 * 60 * 1000;
const MAX_TRIES = 10;
const tries = new Map();   // ip -> { n, reset }

function digest(s) { return crypto.createHash('sha256').update(String(s), 'utf8').digest(); }

function bucket(ip) {
  const now = Date.now();
  let t = tries.get(ip);
  if (!t || t.reset < now) { t = { n: 0, reset: now + WINDOW_MS }; tries.set(ip, t); }
  if (tries.size > 5000) for (const [k, v] of tries) if (v.reset < now) tries.delete(k);
  return t;
}

// True when the request carries the admin password. Otherwise writes the 4xx/5xx itself and returns false.
function requireAdmin(req, res) {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw || pw.length < 8) { res.status(500).json({ error: 'ADMIN_PASSWORD is not set (or is under 8 characters) in the hosting dashboard.' }); return false; }
  const t = bucket(clientIp(req));
  if (t.n >= MAX_TRIES) { res.setHeader('Retry-After', String(Math.ceil((t.reset - Date.now()) / 1000))); res.status(429).json({ error: 'Too many wrong passwords. Try again in an hour.' }); return false; }
  const h = String(req.headers.authorization || '');
  const given = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!given || !crypto.timingSafeEqual(digest(given), digest(pw))) {
    t.n += 1;
    res.status(401).json({ error: 'Wrong password.' });
    return false;
  }
  return true;
}

function _reset() { tries.clear(); }   // tests only

module.exports = { requireAdmin, _reset, MAX_TRIES };
