/* Creates a Stripe Checkout Session from the box the customer built.
   Runs as a Vercel serverless function (api/checkout.js). No npm dependencies: it calls Stripe's REST API directly.
   Needs STRIPE_SECRET_KEY (sk_test_… while testing, sk_live_… to go live). With SUPABASE_URL and
   SUPABASE_SERVICE_ROLE_KEY set it also writes a `pending` orders row first, and the webhook flips it to `paid`.

   Every price is re-computed here from catalog.json through lib/pricing.js, so a tampered browser
   cannot pay $1 for a cake. The pickup date is re-checked against each item's lead time, the open days,
   blackout dates and the per-day capacity too. */

const catalog = require('../catalog.json');
const Pricing = require('../lib/pricing.js');
const db = require('../lib/db.js');
const stripe = require('../lib/stripe.js');
const orders = require('../lib/orders.js');
const availability = require('../lib/availability.js');
const { bad, jsonBody, noStore } = require('../lib/http.js');

const META_MAX = 500; // Stripe metadata values are capped at 500 characters
const SESSION_TTL_S = 31 * 60; // Stripe's minimum is 30 minutes; one extra so clock drift never rejects it

function meta(v) { return String(v == null ? '' : v).slice(0, META_MAX); }

function originFrom(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const origin = req.headers.origin;
  if (origin && /^https?:\/\//.test(origin)) return origin;
  return `${proto}://${host}`;
}

module.exports = async (req, res) => {
  noStore(res);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return bad(res, 405, 'POST only');

  if (!stripe.configured()) return bad(res, 500, 'The server is missing STRIPE_SECRET_KEY. Add it in the hosting dashboard and redeploy.');

  const body = jsonBody(req);
  if (!body || !Array.isArray(body.items) || !body.items.length) return bad(res, 400, 'Your box is empty.');

  const items = body.items.slice(0, 20);
  const customer = body.customer || {};
  const f = body.fulfillment || {};

  // 1. Every item must exist and have valid options.
  for (const it of items) {
    const p = Pricing.findProduct(catalog, it && it.productId);
    if (!p) return bad(res, 400, 'One of the items in your box is no longer on the menu. Remove it and try again.');
    const err = Pricing.validate(p, it.options || {});
    if (err) return bad(res, 400, `${p.name}: ${err}`);
  }

  // 2. Customer details.
  const name = String(customer.name || '').trim().slice(0, 120);
  const email = String(customer.email || '').trim().slice(0, 200);
  const phone = String(customer.phone || '').trim().slice(0, 40);
  if (!name) return bad(res, 400, 'We need a name for the box.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad(res, 400, 'Enter a valid email for the receipt.');
  if (phone.replace(/\D/g, '').length < 7) return bad(res, 400, 'Enter a mobile number we can text.');

  // 3. Date and lead time (one day of slack so time zones never block a legitimate order).
  const method = f.method === 'delivery' ? 'delivery' : 'pickup';
  const date = String(f.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return bad(res, 400, 'Pick a pickup date.');
  const lead = Pricing.leadDays(catalog, items);
  const minDate = new Date(); minDate.setUTCHours(0, 0, 0, 0); minDate.setUTCDate(minDate.getUTCDate() + lead - 1);
  const chosen = new Date(date + 'T12:00:00Z');
  if (!(chosen >= minDate)) return bad(res, 400, `That date is too soon. This box needs ${lead} day${lead > 1 ? 's' : ''}' notice.`);
  if (!catalog.brand.pickupDays.includes(chosen.getUTCDay())) return bad(res, 400, `We bake for ${catalog.brand.pickupDaysLabel} only.`);
  if (!catalog.brand.pickupWindows.includes(String(f.window || ''))) return bad(res, 400, 'Pick a time window.');
  const address = String(f.address || '').trim().slice(0, 300);
  if (method === 'delivery' && address.length < 8) return bad(res, 400, 'Enter the full delivery address.');
  const notes = String(f.notes || '').trim().slice(0, 1000);

  // 3b. Capacity: blackout dates and the per-day order cap (the browser check is only a courtesy).
  let dayState = 'open';
  try { dayState = await availability.statusFor(date); } catch (e) { console.error('availability check failed', e.message); }
  if (dayState === 'closed') return bad(res, 400, 'We are closed that day. Pick another date.');
  if (dayState === 'full') return bad(res, 400, 'That day is fully booked. Pick another date and we will make it worth the wait.');

  // 4. Price it ourselves.
  const t = Pricing.totals(catalog, items, method);
  if (!(t.total > 0)) return bad(res, 400, 'Nothing to charge.');
  const ref = orders.cleanRef(body.ref);

  // 5. Save a pending order first (Stripe metadata is too small to hold a whole box).
  let order = null;
  if (db.configured()) {
    try {
      order = await db.insert('orders', orders.buildRow({ ref, name, email, phone, method, date, window: f.window, address, notes, totals: t, currency: catalog.brand.currency }));
    } catch (e) {
      console.error('order insert failed', e.message, e.detail || '');
      return bad(res, 502, 'We could not save your order just now. Give it a minute and try again.');
    }
  } else {
    console.warn('Supabase is not configured: taking payment without saving an order row.');
  }

  // 6. Build the Checkout Session.
  const form = new URLSearchParams();
  form.set('mode', 'payment');
  t.lines.forEach((l, i) => {
    form.set(`line_items[${i}][quantity]`, String(l.qty));
    form.set(`line_items[${i}][price_data][currency]`, catalog.brand.currency);
    form.set(`line_items[${i}][price_data][unit_amount]`, String(orders.cents(l.unit)));
    form.set(`line_items[${i}][price_data][product_data][name]`, l.product.name);
    if (l.summary) form.set(`line_items[${i}][price_data][product_data][description]`, l.summary.slice(0, 300));
  });
  if (t.deliveryFee > 0) {
    const i = t.lines.length;
    form.set(`line_items[${i}][quantity]`, '1');
    form.set(`line_items[${i}][price_data][currency]`, catalog.brand.currency);
    form.set(`line_items[${i}][price_data][unit_amount]`, String(orders.cents(t.deliveryFee)));
    form.set(`line_items[${i}][price_data][product_data][name]`, 'Delivery');
  }
  const origin = originFrom(req);
  form.set('success_url', `${origin}/?order=success&session_id={CHECKOUT_SESSION_ID}`);
  form.set('cancel_url', `${origin}/?order=cancelled`);
  form.set('customer_email', email);
  form.set('submit_type', 'pay');
  form.set('client_reference_id', ref);
  form.set('allow_promotion_codes', 'true');
  form.set('expires_at', String(Math.floor(Date.now() / 1000) + SESSION_TTL_S));
  form.set('payment_intent_data[description]', `${ref} · ${method} ${date} ${f.window} — ${name}`.slice(0, 1000));

  const md = {
    order_ref: ref, order_id: order ? order.id : '', customer_name: name, phone, method, date, window: f.window,
    address, notes, lead_days: String(lead),
    items: t.lines.map(l => `${l.qty}× ${l.product.name} (${l.summary})`).join(' | ')
  };
  Object.entries(md).forEach(([k, v]) => {
    if (v === '' || v == null) return;
    form.set(`metadata[${k}]`, meta(v));
    form.set(`payment_intent_data[metadata][${k}]`, meta(v));
  });

  let session;
  try {
    session = await stripe.createCheckoutSession(form);
  } catch (e) {
    if (e instanceof stripe.StripeError && e.status && e.status !== 500) return bad(res, 502, e.message);
    return bad(res, 502, e.status === 500 ? e.message : 'Could not reach Stripe. Try again in a moment.');
  }

  // 7. Remember the session on the row so the success page can find the order even before the webhook lands.
  if (order) {
    try { await db.update('orders', `id=eq.${order.id}`, { stripe_session_id: session.id }); }
    catch (e) { console.error('could not attach session to order', e.message); }
  }

  return res.status(200).json({ url: session.url, id: session.id, ref });
};
