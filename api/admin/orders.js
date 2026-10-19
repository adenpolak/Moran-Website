/* GET /api/admin/orders?from=YYYY-MM-DD&to=YYYY-MM-DD&status=paid,ready&q=levi
   Lists orders for the day sheet. Pending (never paid) rows are hidden unless status=pending is asked for. */

const db = require('../../lib/db.js');
const { requireAdmin } = require('../../lib/auth.js');
const { query, bad, noStore } = require('../../lib/http.js');

const STATUSES = ['pending', 'paid', 'in_progress', 'ready', 'completed', 'cancelled', 'refunded'];
const ISO = /^\d{4}-\d{2}-\d{2}$/;

module.exports = async (req, res) => {
  noStore(res);
  if (req.method !== 'GET') return bad(res, 405, 'GET only');
  if (!requireAdmin(req, res)) return;
  if (!db.configured()) return bad(res, 503, 'Supabase is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');

  const q = query(req);
  const filters = ['select=*', 'order=pickup_date.asc,pickup_window.asc,paid_at.asc', 'limit=500'];
  if (ISO.test(q.from || '')) filters.push(`pickup_date=gte.${q.from}`);
  if (ISO.test(q.to || '')) filters.push(`pickup_date=lte.${q.to}`);
  const wanted = String(q.status || '').split(',').map(s => s.trim()).filter(s => STATUSES.includes(s));
  if (wanted.length) filters.push(`status=in.(${wanted.join(',')})`);
  else filters.push('status=neq.pending');
  const search = String(q.q || '').trim().slice(0, 60);
  if (search) {
    const pat = db.quote(`*${search.replace(/[%*,()"]/g, ' ')}*`);
    filters.push(`or=(ref.ilike.${pat},customer_name.ilike.${pat},customer_phone.ilike.${pat},customer_email.ilike.${pat})`);
  }
  try {
    const rows = await db.select('orders', filters.join('&'));
    return res.status(200).json({ orders: rows });
  } catch (e) {
    console.error('admin list failed', e.message, e.detail || '');
    return bad(res, 502, `Could not load orders: ${e.message}`);
  }
};
