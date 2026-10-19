/* Stripe webhook: flips the pending order to paid and sends the two emails.
   Point Stripe at https://<domain>/api/webhook with the event checkout.session.completed
   (async_payment_succeeded is handled too) and put the endpoint's signing secret in STRIPE_WEBHOOK_SECRET.

   The signature is verified by hand with Node crypto, so there is no SDK. Vercel's JSON body parser is turned off
   for this file because verification needs the exact bytes Stripe sent. */

const crypto = require('crypto');
const db = require('../lib/db.js');
const orders = require('../lib/orders.js');
const { rawBody } = require('../lib/http.js');

const TOLERANCE_S = 300;

// Returns the parsed event, or null when the signature does not check out.
function verify(raw, header, secret, nowS = Date.now() / 1000) {
  if (!raw || !header || !secret) return null;
  const parts = {};
  for (const p of String(header).split(',')) {
    const i = p.indexOf('=');
    if (i < 0) continue;
    const k = p.slice(0, i).trim(), v = p.slice(i + 1).trim();
    if (k === 'v1') (parts.v1 = parts.v1 || []).push(v); else parts[k] = v;
  }
  if (!parts.t || !parts.v1 || !/^\d+$/.test(parts.t)) return null;
  if (Math.abs(nowS - Number(parts.t)) > TOLERANCE_S) return null;
  const expected = crypto.createHmac('sha256', secret).update(`${parts.t}.${raw}`, 'utf8').digest('hex');
  const ok = parts.v1.some(sig => sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig, 'utf8'), Buffer.from(expected, 'utf8')));
  if (!ok) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return res.status(500).json({ error: 'STRIPE_WEBHOOK_SECRET is not set.' });

  let raw;
  try { raw = await rawBody(req); } catch (e) { return res.status(400).json({ error: 'Could not read the body.' }); }
  const event = verify(raw, req.headers['stripe-signature'], secret);
  if (!event) return res.status(400).json({ error: 'Bad signature.' });

  const type = event.type;
  const session = event.data && event.data.object;
  if (type !== 'checkout.session.completed' && type !== 'checkout.session.async_payment_succeeded') {
    return res.status(200).json({ received: true, ignored: type });
  }
  if (!session || session.payment_status !== 'paid') {
    // completed-but-unpaid happens with delayed methods; async_payment_succeeded follows later.
    return res.status(200).json({ received: true, waiting: session && session.payment_status });
  }
  const orderId = session.metadata && session.metadata.order_id;
  if (!orderId) return res.status(200).json({ received: true, note: 'no order_id in metadata' });
  if (!db.configured()) { console.warn('webhook: Supabase not configured'); return res.status(200).json({ received: true, note: 'no database' }); }

  let result;
  try {
    result = await orders.settle({ orderId, sessionId: session.id, paymentIntent: typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent && session.payment_intent.id) });
  } catch (e) {
    console.error('webhook: could not mark order paid', e.message, e.detail || '');
    return res.status(500).json({ error: 'Database update failed; Stripe will retry.' });
  }
  if (result.emails) {
    const bad = Object.entries(result.emails).filter(([, r]) => !r.ok);
    if (bad.length) console.warn('webhook: email problems', JSON.stringify(result.emails));
  }
  return res.status(200).json({ received: true, order: orderId, already_paid: result.already, emails: result.emails });
};

module.exports.config = { api: { bodyParser: false } };
module.exports.verify = verify;
