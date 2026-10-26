/* Unit tests for the serverless functions. Stripe, Supabase and Resend are replaced by an in-memory fake `fetch`,
   so this runs anywhere with Node ≥ 18:   npm test
   What is covered: server-side pricing, lead time, open days, delivery fee, capacity, the pending→paid flow,
   webhook signature + idempotency, the success-page lookup, and the admin password + rate limit. */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_fake_secret';
process.env.SUPABASE_URL = 'https://fake.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-fake';
process.env.RESEND_API_KEY = 're_fake';
process.env.ORDER_EMAIL_TO = 'owner@example.com';
process.env.ADMIN_PASSWORD = 'correct-horse-battery';

const catalog = require('../catalog.json');
const Pricing = require('../lib/pricing.js');
const checkout = require('../api/checkout.js');
const webhook = require('../api/webhook.js');
const orderApi = require('../api/order.js');
const availabilityApi = require('../api/availability.js');
const adminList = require('../api/admin/orders.js');
const adminPatch = require('../api/admin/order.js');
const auth = require('../lib/auth.js');
const emails = require('../lib/emails.js');

/* ---------- fakes ---------- */
const fake = { rows: [], stripeCalls: [], sessions: {}, resend: [], nextId: 1 };

function parseFilter(qs) {
  const u = new URLSearchParams(qs);
  const preds = [];
  for (const [k, v] of u) {
    if (['select', 'order', 'limit'].includes(k)) continue;
    if (k === 'or') {
      const m = /^\((.*)\)$/.exec(v); const parts = m[1].split(/,(?=[a-z_]+\.ilike\.)/);
      preds.push(r => parts.some(p => { const [col, , pat] = p.split('.', 3); const needle = pat.replace(/^"|"$/g, '').replace(/\*/g, '').toLowerCase(); return String(r[col] || '').toLowerCase().includes(needle); }));
      continue;
    }
    const m = /^(eq|neq|gte|lte|in)\.(.*)$/s.exec(v);
    if (!m) throw new Error('unsupported filter ' + k + '=' + v);
    const [, op, val] = m;
    preds.push(r => {
      const x = r[k];
      if (op === 'eq') return String(x) === val;
      if (op === 'neq') return String(x) !== val;
      if (op === 'gte') return String(x) >= val;
      if (op === 'lte') return String(x) <= val;
      if (op === 'in') return val.slice(1, -1).split(',').includes(String(x));
      return false;
    });
  }
  return r => preds.every(p => p(r));
}

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  if (u.startsWith('https://api.stripe.com/v1/checkout/sessions')) {
    const idm = /checkout\/sessions\/(cs_[a-z_0-9]+)/i.exec(u);
    if (idm) return fake.sessions[idm[1]] ? json(200, fake.sessions[idm[1]]) : json(404, { error: { message: 'No such session' } });
    const form = new URLSearchParams(String(opts.body));
    fake.stripeCalls.push(form);
    const id = 'cs_test_' + String(fake.nextId++).padStart(6, '0');
    const md = {}; for (const [k, v] of form) { const m = /^metadata\[(\w+)\]$/.exec(k); if (m) md[m[1]] = v; }
    fake.sessions[id] = { id, object: 'checkout.session', payment_status: 'unpaid', payment_intent: 'pi_' + id.slice(-6), metadata: md, url: 'https://checkout.stripe.com/c/pay/' + id };
    return json(200, fake.sessions[id]);
  }
  if (u.startsWith('https://fake.supabase.co/rest/v1/orders')) {
    assert.equal(opts.headers.apikey, 'service-role-fake');
    const qs = u.split('?')[1] || '';
    const method = opts.method || 'GET';
    if (method === 'POST') { const row = { id: crypto.randomUUID(), created_at: new Date().toISOString(), paid_at: null, stripe_session_id: null, stripe_payment_intent: null, address: null, notes: null, ...JSON.parse(opts.body) }; fake.rows.push(row); return json(201, [row]); }
    const match = parseFilter(qs);
    if (method === 'PATCH') { const patch = JSON.parse(opts.body); const hit = fake.rows.filter(match); hit.forEach(r => Object.assign(r, patch)); return json(200, hit); }
    return json(200, fake.rows.filter(match));
  }
  if (u === 'https://api.resend.com/emails') { const b = JSON.parse(opts.body); fake.resend.push(b); return json(200, { id: 'email_' + fake.resend.length }); }
  throw new Error('unexpected fetch ' + u);
};

function mockReq({ method = 'GET', url = '/', body, headers = {}, raw } = {}) {
  const req = { method, url, headers: { host: 'localhost:3000', ...headers }, body, socket: { remoteAddress: '127.0.0.1' } };
  if (raw != null) { req.body = undefined; const { Readable } = require('stream'); const s = Readable.from([Buffer.from(raw)]); req.on = s.on.bind(s); }
  return req;
}
function mockRes() {
  const res = { statusCode: 200, headers: {}, body: undefined };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.getHeader = k => res.headers[k.toLowerCase()];
  res.status = c => { res.statusCode = c; return res; };
  res.json = o => { res.body = o; res.ended = true; return res; };
  res.send = s => { res.body = s; res.ended = true; return res; };
  res.end = () => { res.ended = true; return res; };
  return res;
}
async function call(fn, reqOpts) { const req = mockReq(reqOpts), res = mockRes(); await fn(req, res); return res; }

function nextOpenDate(daysOut) {
  const d = new Date(); d.setUTCHours(12, 0, 0, 0); d.setUTCDate(d.getUTCDate() + daysOut);
  while (!catalog.brand.pickupDays.includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
function closedDate() {
  const d = new Date(); d.setUTCHours(12, 0, 0, 0); d.setUTCDate(d.getUTCDate() + 7);
  while (catalog.brand.pickupDays.includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
const WINDOW = catalog.brand.pickupWindows[0];
const good = over => ({
  items: [{ productId: 'number-cake', options: { chars: '18', topping: 'gold', cream: 'pistachio', topper: 'gold' }, qty: 1 }, { productId: 'bomboloni', options: { size: 'dozen', mix: 'assorted' }, qty: 1 }],
  customer: { name: 'Dana Levi', email: 'dana@example.com', phone: '713 555 0199' },
  fulfillment: { method: 'pickup', date: nextOpenDate(4), window: WINDOW, address: '', notes: 'candles' },
  ref: 'MS-1234', ...over
});
const post = body => call(checkout, { method: 'POST', url: '/api/checkout', body, headers: { origin: 'http://localhost:3000' } });
const reset = () => { fake.rows = []; fake.stripeCalls = []; fake.sessions = {}; fake.resend = []; auth._reset(); };

function sign(raw, secret = process.env.STRIPE_WEBHOOK_SECRET, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`;
}
const paidEvent = (sessionId, orderId) => JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: sessionId, payment_status: 'paid', payment_intent: 'pi_abc', metadata: { order_id: orderId } } } });

/* ---------- pricing (shared module) ---------- */
test('pricing: number cake prices by character count plus deltas', () => {
  const p = Pricing.findProduct(catalog, 'number-cake');
  assert.equal(Pricing.unitPrice(p, { chars: '18', topping: 'gold', cream: 'pistachio', topper: 'gold' }), 350 + 12 + 8);
  assert.equal(Pricing.describe(p, { chars: '50', topping: 'gold', cream: 'pistachio', topper: 'gold' }), '50 · Gold & crown · Pistachio · gold topper');
  assert.match(Pricing.validate(p, { chars: '', topping: 'gold', cream: 'vanilla', topper: 'none' }), /required/);
});

/* ---------- checkout ---------- */
test('checkout: pickup order → pending row + Stripe session with server prices', async () => {
  reset();
  const res = await post(good());
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.match(res.body.url, /^https:\/\/checkout\.stripe\.com\//);
  assert.equal(res.body.ref, 'MS-1234');
  assert.equal(fake.rows.length, 1);
  const row = fake.rows[0];
  assert.equal(row.status, 'pending');
  assert.equal(row.subtotal_cents, (370 + 55) * 100);
  assert.equal(row.delivery_fee_cents, 0);
  assert.equal(row.total_cents, 42500);
  assert.equal(row.items[0].summary, '18 · Gold & crown · Pistachio · gold topper');
  assert.equal(row.stripe_session_id, res.body.id, 'session id attached to the row');
  const form = fake.stripeCalls[0];
  assert.equal(form.get('line_items[0][price_data][unit_amount]'), '37000');
  assert.equal(form.get('line_items[1][price_data][unit_amount]'), '5500');
  assert.equal(form.get('metadata[order_id]'), row.id);
  assert.equal(form.get('payment_intent_data[metadata][order_id]'), row.id);
  assert.equal(form.get('allow_promotion_codes'), 'true');
  assert.equal(form.get('client_reference_id'), 'MS-1234');
  assert.ok(Number(form.get('expires_at')) > Date.now() / 1000 + 30 * 60);
  assert.match(form.get('success_url'), /^http:\/\/localhost:3000\/\?order=success&session_id=\{CHECKOUT_SESSION_ID\}$/);
});

test('checkout: ignores any prices sent by the browser', async () => {
  reset();
  const res = await post(good({ items: [{ productId: 'number-cake', options: { chars: '18', topping: 'gold', cream: 'pistachio', topper: 'gold' }, qty: 1, price: 1, amount: 1 }], total: 1 }));
  assert.equal(res.statusCode, 200);
  assert.equal(fake.stripeCalls[0].get('line_items[0][price_data][unit_amount]'), '37000');
});

test('checkout: delivery under the free threshold adds the fee, over it does not', async () => {
  reset();
  let res = await post(good({ items: [{ productId: 'bomboloni', options: { size: 'dozen', mix: 'assorted' }, qty: 1 }], fulfillment: { method: 'delivery', date: nextOpenDate(3), window: WINDOW, address: '12 Main St, Houston TX 77002' } }));
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(fake.stripeCalls[0].get('line_items[1][price_data][product_data][name]'), 'Delivery');
  assert.equal(fake.stripeCalls[0].get('line_items[1][price_data][unit_amount]'), String(catalog.fulfillment.delivery.fee * 100));
  assert.equal(fake.rows[0].delivery_fee_cents, catalog.fulfillment.delivery.fee * 100);
  res = await post(good({ fulfillment: { method: 'delivery', date: nextOpenDate(4), window: WINDOW, address: '12 Main St, Houston TX 77002' } }));
  assert.equal(res.statusCode, 200);
  assert.equal(fake.stripeCalls[1].get('line_items[2][quantity]'), null, 'no delivery line when free');
  assert.equal(fake.rows[1].delivery_fee_cents, 0);
});

test('checkout: refuses a date that is too soon, a closed weekday, a missing window, a short address', async () => {
  reset();
  const tomorrow = new Date(); tomorrow.setUTCDate(tomorrow.getUTCDate() + 0);
  let res = await post(good({ fulfillment: { method: 'pickup', date: tomorrow.toISOString().slice(0, 10), window: WINDOW } }));
  assert.equal(res.statusCode, 400); assert.match(res.body.error, /too soon/i);
  res = await post(good({ fulfillment: { method: 'pickup', date: closedDate(), window: WINDOW } }));
  assert.equal(res.statusCode, 400); assert.match(res.body.error, new RegExp(catalog.brand.pickupDaysLabel));
  res = await post(good({ fulfillment: { method: 'pickup', date: nextOpenDate(4), window: '9 – 10' } }));
  assert.equal(res.statusCode, 400); assert.match(res.body.error, /window/i);
  res = await post(good({ fulfillment: { method: 'delivery', date: nextOpenDate(4), window: WINDOW, address: 'x' } }));
  assert.equal(res.statusCode, 400); assert.match(res.body.error, /address/i);
  res = await post(good({ items: [{ productId: 'number-cake', options: { chars: '', topping: 'gold', cream: 'pistachio', topper: 'gold' }, qty: 1 }] }));
  assert.equal(res.statusCode, 400); assert.match(res.body.error, /required/i);
  res = await post({ items: [] });
  assert.equal(res.statusCode, 400);
  assert.equal(fake.rows.length, 0, 'nothing was saved');
});

test('checkout: refuses a full day (maxOrdersPerDay) and a blackout date', async () => {
  reset();
  const date = nextOpenDate(5);
  for (let i = 0; i < catalog.brand.maxOrdersPerDay; i++) fake.rows.push({ id: crypto.randomUUID(), status: 'paid', pickup_date: date, created_at: new Date().toISOString() });
  let res = await post(good({ fulfillment: { method: 'pickup', date, window: WINDOW } }));
  assert.equal(res.statusCode, 400); assert.match(res.body.error, /fully booked/i);
  const avail = await call(availabilityApi, { url: `/api/availability?from=${date}&to=${date}` });
  assert.equal(avail.body[date], 'full');
  catalog.brand.blackoutDates.push(nextOpenDate(10));
  res = await post(good({ fulfillment: { method: 'pickup', date: nextOpenDate(10), window: WINDOW } }));
  assert.equal(res.statusCode, 400); assert.match(res.body.error, /closed/i);
  catalog.brand.blackoutDates.pop();
});

test('availability: old pending rows do not hold a slot, fresh ones do', async () => {
  reset();
  const date = nextOpenDate(6);
  const old = new Date(Date.now() - 40 * 60 * 1000).toISOString();
  for (let i = 0; i < catalog.brand.maxOrdersPerDay; i++) fake.rows.push({ id: crypto.randomUUID(), status: 'pending', pickup_date: date, created_at: old });
  let r = await call(availabilityApi, { url: `/api/availability?from=${date}&to=${date}` });
  assert.equal(r.body[date], 'open');
  fake.rows.forEach(x => { x.created_at = new Date().toISOString(); });
  r = await call(availabilityApi, { url: `/api/availability?from=${date}&to=${date}` });
  assert.equal(r.body[date], 'full');
  assert.equal(r.body[closedDate()], undefined);
  r = await call(availabilityApi, { url: `/api/availability?from=${closedDate()}&to=${closedDate()}` });
  assert.equal(r.body[closedDate()], 'closed');
});

/* ---------- webhook ---------- */
test('webhook: bad signature → 400 and nothing changes; good signature → paid + two emails; replay → no second email', async () => {
  reset();
  const co = await post(good());
  const row = fake.rows[0];
  const raw = paidEvent(co.body.id, row.id);
  let res = await call(webhook, { method: 'POST', raw, headers: { 'stripe-signature': sign(raw, 'whsec_wrong') } });
  assert.equal(res.statusCode, 400);
  assert.equal(row.status, 'pending');
  assert.equal(fake.resend.length, 0);
  res = await call(webhook, { method: 'POST', raw, headers: { 'stripe-signature': sign(raw, undefined, Math.floor(Date.now() / 1000) - 3600) } });
  assert.equal(res.statusCode, 400, 'stale timestamp is refused');
  res = await call(webhook, { method: 'POST', raw, headers: { 'stripe-signature': sign(raw) } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(row.status, 'paid');
  assert.ok(row.paid_at);
  assert.equal(row.stripe_payment_intent, 'pi_abc');
  assert.equal(fake.resend.length, 2);
  const [baker, customer] = fake.resend;
  assert.deepEqual(baker.to, ['owner@example.com']);
  assert.match(baker.subject, /^New order MS-1234 · \w{3} \w{3} \d{1,2} · 10:00 – 12:00 · pickup$/);
  assert.match(baker.html, /candles/);
  assert.match(baker.html, /dashboard\.stripe\.com\/test\/payments\/pi_abc/);
  assert.deepEqual(customer.to, ['dana@example.com']);
  assert.equal(customer.subject, 'Your My Sweetart order MS-1234 is in');
  assert.match(customer.html, /18 · Gold &amp; crown · Pistachio · gold topper/);
  res = await call(webhook, { method: 'POST', raw, headers: { 'stripe-signature': sign(raw) } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.already_paid, true);
  assert.equal(fake.resend.length, 2, 'retry did not email again');
});

test('webhook: ignores other events and unpaid sessions', async () => {
  reset();
  let raw = JSON.stringify({ type: 'payment_intent.created', data: { object: {} } });
  let res = await call(webhook, { method: 'POST', raw, headers: { 'stripe-signature': sign(raw) } });
  assert.equal(res.statusCode, 200); assert.equal(res.body.ignored, 'payment_intent.created');
  raw = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_test_x', payment_status: 'unpaid', metadata: { order_id: 'nope' } } } });
  res = await call(webhook, { method: 'POST', raw, headers: { 'stripe-signature': sign(raw) } });
  assert.equal(res.statusCode, 200); assert.equal(res.body.waiting, 'unpaid');
});

/* ---------- success page lookup ---------- */
test('order api: pending until paid; settles from Stripe when the webhook is late; never leaks the email', async () => {
  reset();
  const co = await post(good({ fulfillment: { method: 'delivery', date: nextOpenDate(4), window: WINDOW, address: '12 Main St, Houston TX 77002' } }));
  const sid = co.body.id;
  let res = await call(orderApi, { url: `/api/order?session_id=${sid}` });
  assert.equal(res.statusCode, 202); assert.equal(res.body.pending, true);
  fake.sessions[sid].payment_status = 'paid';
  res = await call(orderApi, { url: `/api/order?session_id=${sid}` });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.ref, 'MS-1234');
  assert.equal(res.body.status, 'paid');
  assert.equal(res.body.first_name, 'Dana');
  assert.equal(res.body.email_masked, 'd•••@example.com');
  assert.equal(res.body.phone_masked, '•••• 0199');
  assert.equal(res.body.customer_email, undefined);
  assert.equal(res.body.address, undefined);
  assert.equal(res.body.has_address, true);
  assert.equal(res.body.total_cents, 42500);
  assert.equal(fake.resend.length, 2, 'emails went out from the success-page path');
  res = await call(orderApi, { url: '/api/order?session_id=cs_test_unknown' });
  assert.equal(res.statusCode, 404);
  res = await call(orderApi, { url: '/api/order?session_id=../etc' });
  assert.equal(res.statusCode, 400);
});

/* ---------- admin ---------- */
test('admin: password required, constant-time compare, 429 after 10 bad tries', async () => {
  reset();
  let res = await call(adminList, { url: '/api/admin/orders' });
  assert.equal(res.statusCode, 401);
  for (let i = 0; i < 9; i++) res = await call(adminList, { url: '/api/admin/orders', headers: { authorization: 'Bearer nope' } });
  assert.equal(res.statusCode, 401);
  res = await call(adminList, { url: '/api/admin/orders', headers: { authorization: 'Bearer nope' } });
  assert.equal(res.statusCode, 429);
  res = await call(adminList, { url: '/api/admin/orders', headers: { authorization: 'Bearer correct-horse-battery' } });
  assert.equal(res.statusCode, 429, 'even the right password waits once locked out');
  auth._reset();
  res = await call(adminList, { url: '/api/admin/orders', headers: { authorization: 'Bearer correct-horse-battery' } });
  assert.equal(res.statusCode, 200);
});

test('admin: lists paid orders by date range and search, hides pending, moves status along', async () => {
  reset();
  const H = { authorization: 'Bearer correct-horse-battery' };
  await post(good());                                                     // pending, hidden
  const co = await post(good({ ref: 'MS-2222', customer: { name: 'Noa Cohen', email: 'noa@example.com', phone: '713 555 0100' } }));
  const raw = paidEvent(co.body.id, fake.rows[1].id);
  await call(webhook, { method: 'POST', raw, headers: { 'stripe-signature': sign(raw) } });
  let res = await call(adminList, { url: `/api/admin/orders?from=${nextOpenDate(4)}&to=${nextOpenDate(4)}`, headers: H });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.orders.length, 1);
  assert.equal(res.body.orders[0].ref, 'MS-2222');
  res = await call(adminList, { url: '/api/admin/orders?q=cohen', headers: H });
  assert.equal(res.body.orders.length, 1);
  res = await call(adminList, { url: '/api/admin/orders?q=zzz', headers: H });
  assert.equal(res.body.orders.length, 0);
  const id = fake.rows[1].id;
  res = await call(adminPatch, { method: 'PATCH', url: '/api/admin/order', body: { id, status: 'in_progress' }, headers: H });
  assert.equal(res.statusCode, 200); assert.equal(res.body.order.status, 'in_progress');
  res = await call(adminPatch, { method: 'PATCH', url: '/api/admin/order', body: { id, status: 'bogus' }, headers: H });
  assert.equal(res.statusCode, 400);
  res = await call(adminPatch, { method: 'PATCH', url: '/api/admin/order', body: { id: fake.rows[0].id, status: 'ready' }, headers: H });
  assert.equal(res.statusCode, 404, 'a pending row cannot be moved');
  res = await call(adminPatch, { method: 'PATCH', url: '/api/admin/order', body: { id, status: 'ready' } });
  assert.equal(res.statusCode, 401);
});

/* ---------- emails ---------- */
test('emails: templates render the sample order with totals and the change policy', () => {
  const o = emails.sampleOrder();
  const b = emails.bakerEmail(o, { paymentUrl: 'https://dashboard.stripe.com/test/payments/pi_sample' });
  assert.equal(b.subject, 'New order MS-1234 · Sat Oct 24 · 10:00 – 12:00 · pickup');
  assert.match(b.html, /\$460/); assert.match(b.text, /Paid \$460/);
  assert.match(b.html, /Candles please/);
  const c = emails.customerEmail(o);
  assert.match(c.html, /Thank you, Dana\./); assert.match(c.html, /48 hours/); assert.match(c.html, /tree nuts/);
  assert.doesNotMatch(c.html, /<script/i);
  const x = emails.customerEmail(emails.sampleOrder({ customer_name: '<img src=x onerror=alert(1)>', notes: '<b>hi</b>' }));
  assert.doesNotMatch(x.html, /<img src=x/); assert.match(x.html, /&lt;b&gt;hi&lt;\/b&gt;/);
});
