/* Supabase, through its REST API (PostgREST). Server only: uses the service-role key, so RLS does not apply.
   When SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are missing, `configured()` is false and callers skip the database
   (the shop still takes payments; orders then live only in Stripe). */
'use strict';

function env() {
  return { url: (process.env.SUPABASE_URL || '').replace(/\/+$/, ''), key: process.env.SUPABASE_SERVICE_ROLE_KEY || '' };
}

function configured() { const e = env(); return !!(e.url && e.key); }

class DbError extends Error {
  constructor(message, status, detail) { super(message); this.status = status; this.detail = detail; }
}

async function rest(path, { method = 'GET', body, prefer } = {}) {
  const { url, key } = env();
  if (!url || !key) throw new DbError('Supabase is not configured.', 500);
  const headers = { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(`${url}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch (e) { data = text; } }
  if (!r.ok) {
    const msg = (data && data.message) || (typeof data === 'string' ? data : '') || `Supabase ${r.status}`;
    throw new DbError(msg, r.status, data);
  }
  return data;
}

// Rows matching a PostgREST filter string, e.g. select('orders', 'status=eq.paid&order=pickup_date.asc').
function select(table, filter) { return rest(`${table}?${filter}`); }

async function insert(table, row) {
  const rows = await rest(table, { method: 'POST', body: row, prefer: 'return=representation' });
  return Array.isArray(rows) ? rows[0] : rows;
}

// PATCH rows matching the filter; returns the rows that changed (empty when nothing matched).
async function update(table, filter, patch) {
  const rows = await rest(`${table}?${filter}`, { method: 'PATCH', body: patch, prefer: 'return=representation' });
  return Array.isArray(rows) ? rows : [];
}

// Escape a value for PostgREST filters (commas, parens and dots have meaning inside in.() and or=()).
function quote(v) { return '"' + String(v).replace(/["\\]/g, '\\$&') + '"'; }

module.exports = { configured, rest, select, insert, update, quote, DbError };
