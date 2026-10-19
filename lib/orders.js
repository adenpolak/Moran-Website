/* Order rows: build one from a priced box, flip it to paid exactly once, and shape it for the public success page. */
'use strict';

const db = require('./db.js');
const mail = require('./mail.js');

const cents = dollars => Math.round(dollars * 100);

function makeRef() { return 'MB-' + String(1000 + Math.floor(Math.random() * 9000)); }
function cleanRef(ref) { return /^MB-\d{4}$/.test(String(ref || '')) ? String(ref) : makeRef(); }

// A `pending` orders row from Pricing.totals() output plus the checkout form.
function buildRow({ ref, name, email, phone, method, date, window, address, notes, totals, currency }) {
  return {
    ref, status: 'pending',
    customer_name: name, customer_email: email, customer_phone: phone,
    method, pickup_date: date, pickup_window: window,
    address: method === 'delivery' ? (address || null) : null,
    notes: notes ? String(notes).slice(0, 1000) : null,
    items: totals.lines.map(l => ({
      productId: l.product.id, name: l.product.name, options: l.item.options || {}, summary: l.summary,
      qty: l.qty, unit_cents: cents(l.unit), amount_cents: cents(l.amount)
    })),
    subtotal_cents: cents(totals.subtotal),
    delivery_fee_cents: cents(totals.deliveryFee),
    total_cents: cents(totals.total),
    currency: currency || 'usd'
  };
}

async function findBySession(sessionId) {
  const rows = await db.select('orders', `stripe_session_id=eq.${encodeURIComponent(sessionId)}&limit=1`);
  return rows[0] || null;
}

async function findById(id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return null;
  const rows = await db.select('orders', `id=eq.${id}&limit=1`);
  return rows[0] || null;
}

// Flip pending → paid. Atomic on the status filter, so a Stripe retry (or a race between the webhook and the success page)
// changes nothing the second time. Returns the updated row, or null when the row was not pending (already paid, or unknown).
async function markPaid({ orderId, sessionId, paymentIntent }) {
  const rows = await db.update('orders', `id=eq.${orderId}&status=eq.pending`, {
    status: 'paid', paid_at: new Date().toISOString(),
    stripe_session_id: sessionId || null, stripe_payment_intent: paymentIntent || null
  });
  return rows[0] || null;
}

// Mark paid, then email. Emails never throw; their outcome is returned for logging.
async function settle({ orderId, sessionId, paymentIntent }) {
  const order = await markPaid({ orderId, sessionId, paymentIntent });
  if (!order) return { order: null, emails: null, already: true };
  const emails = await mail.sendOrderEmails(order);
  return { order, emails, already: false };
}

function maskEmail(e) {
  const [u, d] = String(e || '').split('@');
  if (!d) return '';
  return `${u.slice(0, 1)}${'•'.repeat(Math.max(2, Math.min(u.length - 1, 6)))}@${d}`;
}
function maskPhone(p) { const digits = String(p || '').replace(/\D/g, ''); return digits ? `•••• ${digits.slice(-4)}` : ''; }

// What the success page is allowed to see.
function publicView(o) {
  return {
    ref: o.ref, status: o.status, method: o.method, pickup_date: o.pickup_date, pickup_window: o.pickup_window,
    first_name: String(o.customer_name || '').trim().split(/\s+/)[0] || '',
    email_masked: maskEmail(o.customer_email), phone_masked: maskPhone(o.customer_phone),
    has_address: !!o.address, notes: o.notes || '',
    items: (o.items || []).map(it => ({ name: it.name, summary: it.summary, qty: it.qty, amount_cents: it.amount_cents })),
    subtotal_cents: o.subtotal_cents, delivery_fee_cents: o.delivery_fee_cents, total_cents: o.total_cents, currency: o.currency
  };
}

module.exports = { cents, makeRef, cleanRef, buildRow, findBySession, findById, markPaid, settle, publicView, maskEmail, maskPhone };
