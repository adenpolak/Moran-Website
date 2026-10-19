/* Small helpers shared by the api/ functions. Works under `vercel dev`, on Vercel, and under scripts/dev-server.js. */
'use strict';

function query(req) {
  if (req.query && typeof req.query === 'object' && Object.keys(req.query).length) return req.query;
  const u = new URL(req.url || '/', 'http://x');
  return Object.fromEntries(u.searchParams.entries());
}

function bad(res, status, error) { return res.status(status).json({ error }); }

// Parsed JSON body, whether the host already parsed it or handed us a string.
function jsonBody(req) {
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  return body && typeof body === 'object' ? body : null;
}

// Raw request body as a string (for webhook signature checks). Needs bodyParser disabled on Vercel.
function rawBody(req) {
  if (typeof req.body === 'string') return Promise.resolve(req.body);
  if (Buffer.isBuffer(req.body)) return Promise.resolve(req.body.toString('utf8'));
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function clientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || (req.socket && req.socket.remoteAddress) || 'unknown';
}

function noStore(res) { res.setHeader('Cache-Control', 'no-store'); }

module.exports = { query, bad, jsonBody, rawBody, clientIp, noStore };
