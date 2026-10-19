/* PATCH /api/admin/order  body {id, status}  → moves an order along: paid → in_progress → ready → completed,
   or to cancelled / refunded. (Refunds themselves are done in the Stripe dashboard; this only records it.) */

const db = require('../../lib/db.js');
const { requireAdmin } = require('../../lib/auth.js');
const { bad, jsonBody, noStore } = require('../../lib/http.js');

const SETTABLE = ['paid', 'in_progress', 'ready', 'completed', 'cancelled', 'refunded'];

module.exports = async (req, res) => {
  noStore(res);
  if (req.method !== 'PATCH' && req.method !== 'POST') return bad(res, 405, 'PATCH only');
  if (!requireAdmin(req, res)) return;
  if (!db.configured()) return bad(res, 503, 'Supabase is not configured.');
  const body = jsonBody(req) || {};
  const id = String(body.id || '');
  const status = String(body.status || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return bad(res, 400, 'Missing order id.');
  if (!SETTABLE.includes(status)) return bad(res, 400, `Status must be one of ${SETTABLE.join(', ')}.`);
  try {
    const rows = await db.update('orders', `id=eq.${id}&status=neq.pending`, { status });
    if (!rows.length) return bad(res, 404, 'No such order (or it was never paid).');
    return res.status(200).json({ order: rows[0] });
  } catch (e) {
    console.error('admin update failed', e.message, e.detail || '');
    return bad(res, 502, `Could not update: ${e.message}`);
  }
};
