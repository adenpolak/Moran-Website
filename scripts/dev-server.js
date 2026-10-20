#!/usr/bin/env node
/* A stand-in for `vercel dev` that needs no Vercel login: serves the static files with clean URLs and mounts every
   api/*.js function with the same (req, res) shape Vercel gives them. Reads .env.local if present.
     node scripts/dev-server.js            # http://localhost:3000
     PORT=4000 node scripts/dev-server.js
   Not used in production. */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 3000);

// .env.local → process.env (simple KEY=VALUE, quotes stripped, # comments)
const envFile = path.join(ROOT, '.env.local');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line.replace(/\s+#.*$/, ''));
    if (!m || m[1] in process.env) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.md': 'text/markdown; charset=utf-8' };
const REWRITES = { '/sitemap.xml': '/api/sitemap' };

function vercelify(req, res) {
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  req.query = Object.fromEntries(u.searchParams.entries());
  res.status = code => { res.statusCode = code; return res; };
  res.send = body => { if (!res.getHeader('Content-Type')) res.setHeader('Content-Type', typeof body === 'string' ? 'text/html; charset=utf-8' : 'application/octet-stream'); res.end(body); return res; };
  res.json = obj => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(obj)); return res; };
  res.redirect = (code, loc) => { if (typeof code === 'string') { loc = code; code = 307; } res.statusCode = code; res.setHeader('Location', loc); res.end(); return res; };
}

function readBody(req) {
  return new Promise(resolve => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => resolve(Buffer.concat(c))); });
}

async function runApi(pathname, req, res) {
  const rel = pathname.replace(/^\/api\//, '').replace(/\/+$/, '');
  if (!/^[a-z0-9/_-]+$/i.test(rel)) { res.status(404).json({ error: 'Not found' }); return; }
  const file = path.join(ROOT, 'api', rel + '.js');
  if (!file.startsWith(path.join(ROOT, 'api')) || !fs.existsSync(file)) { res.status(404).json({ error: 'Not found' }); return; }
  if (process.env.DEV_RELOAD) delete require.cache[require.resolve(file)];
  const handler = require(file);
  const parse = !(handler.config && handler.config.api && handler.config.api.bodyParser === false);
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const buf = await readBody(req);
    if (parse) {
      const ct = String(req.headers['content-type'] || '');
      if (ct.includes('application/json')) { try { req.body = JSON.parse(buf.toString('utf8') || 'null'); } catch (e) { req.body = null; } }
      else req.body = buf.toString('utf8');
    } else {
      req.body = buf;   // handler reads it via lib/http rawBody()
    }
  }
  try { await handler(req, res); }
  catch (e) { console.error(e); if (!res.headersSent) res.status(500).json({ error: 'Function crashed: ' + e.message }); }
  if (!res.writableEnded) res.end();
}

function serveStatic(pathname, res) {
  let p = decodeURIComponent(pathname);
  if (p === '/') p = '/index.html';
  let file = path.join(ROOT, p);
  if (!file.startsWith(ROOT)) { res.statusCode = 403; return res.end('Forbidden'); }
  if (!path.extname(file) && fs.existsSync(file + '.html')) file += '.html';   // cleanUrls
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; res.setHeader('Content-Type', 'text/plain'); return res.end('Not found'); }
  const ext = path.extname(file).toLowerCase();
  res.setHeader('Content-Type', TYPES[ext] || 'application/octet-stream');
  if (p.startsWith('/images/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  if (p === '/catalog.json') res.setHeader('Cache-Control', 'no-cache');
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  vercelify(req, res);
  let pathname = new URL(req.url, 'http://x').pathname;
  if (REWRITES[pathname]) pathname = REWRITES[pathname];
  if (pathname.startsWith('/api/')) return runApi(pathname, req, res);
  if (/^\/(\.env|\.git|node_modules|scripts|tests|docs|lib\/(?!pricing\.js))/.test(pathname) && pathname !== '/lib/pricing.js') { res.statusCode = 404; return res.end('Not found'); }
  return serveStatic(pathname, res);
});

server.listen(PORT, () => console.log(`My Sweetart dev server → http://localhost:${PORT}  (Stripe ${process.env.STRIPE_SECRET_KEY ? 'key set' : 'key missing'}, Supabase ${process.env.SUPABASE_URL ? 'set' : 'missing'})`));
