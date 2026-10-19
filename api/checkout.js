/* Creates a Stripe Checkout Session from the box the customer built.
   Runs as a Vercel serverless function (api/checkout.js). No npm dependencies: it calls Stripe's REST API directly.
   Needs one environment variable: STRIPE_SECRET_KEY (sk_test_… while testing, sk_live_… to go live).

   Every price is re-computed here from catalog.json through lib/pricing.js, so a tampered browser
   cannot pay $1 for a cake. The pickup date is re-checked against each item's lead time too. */

const catalog = require('../catalog.json');
const Pricing = require('../lib/pricing.js');

const META_MAX = 500; // Stripe metadata values are capped at 500 characters

function meta(v) { return String(v == null ? '' : v).slice(0, META_MAX); }

function originFrom(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const origin = req.headers.origin;
  if (origin && /^https?:\/\//.test(origin)) return origin;
  return `${proto}://${host}`;
}

function bad(res, status, error) { return res.status(status).json({ error }); }

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return bad(res, 405, 'POST only');

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return bad(res, 500, 'The server is missing STRIPE_SECRET_KEY. Add it in the hosting dashboard and redeploy.');

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
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
  const name = String(customer.name || '').trim();
  const email = String(customer.email || '').trim();
  const phone = String(customer.phone || '').trim();
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
  if (method === 'delivery' && String(f.address || '').trim().length < 8) return bad(res, 400, 'Enter the full delivery address.');

  // 4. Price it ourselves.
  const t = Pricing.totals(catalog, items, method);
  if (!(t.total > 0)) return bad(res, 400, 'Nothing to charge.');

  // 5. Build the Checkout Session.
  const form = new URLSearchParams();
  form.set('mode', 'payment');
  t.lines.forEach((l, i) => {
    form.set(`line_items[${i}][quantity]`, String(l.qty));
    form.set(`line_items[${i}][price_data][currency]`, catalog.brand.currency);
    form.set(`line_items[${i}][price_data][unit_amount]`, String(Math.round(l.unit * 100)));
    form.set(`line_items[${i}][price_data][product_data][name]`, l.product.name);
    if (l.summary) form.set(`line_items[${i}][price_data][product_data][description]`, l.summary.slice(0, 300));
  });
  if (t.deliveryFee > 0) {
    const i = t.lines.length;
    form.set(`line_items[${i}][quantity]`, '1');
    form.set(`line_items[${i}][price_data][currency]`, catalog.brand.currency);
    form.set(`line_items[${i}][price_data][unit_amount]`, String(Math.round(t.deliveryFee * 100)));
    form.set(`line_items[${i}][price_data][product_data][name]`, 'Delivery');
  }
  const origin = originFrom(req);
  form.set('success_url', `${origin}/?order=success&session_id={CHECKOUT_SESSION_ID}`);
  form.set('cancel_url', `${origin}/?order=cancelled`);
  form.set('customer_email', email);
  form.set('submit_type', 'pay');
  form.set('payment_intent_data[description]', `${method} ${date} ${f.window} — ${name}`.slice(0, 1000));

  const md = {
    order_ref: body.ref || '', customer_name: name, phone, method, date, window: f.window,
    address: f.address || '', notes: f.notes || '', lead_days: String(lead),
    items: t.lines.map(l => `${l.qty}× ${l.product.name} (${l.summary})`).join(' | ')
  };
  Object.entries(md).forEach(([k, v]) => {
    if (v === '' || v == null) return;
    form.set(`metadata[${k}]`, meta(v));
    form.set(`payment_intent_data[metadata][${k}]`, meta(v));
  });

  let data;
  try {
    const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form
    });
    data = await r.json();
    if (!r.ok) return bad(res, 502, (data && data.error && data.error.message) || 'Stripe refused the request.');
  } catch (e) {
    return bad(res, 502, 'Could not reach Stripe. Try again in a moment.');
  }
  return res.status(200).json({ url: data.url, id: data.id });
};
