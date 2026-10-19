/* GET /api/order?session_id=cs_… → the order behind a Checkout Session, for the success page.
   Only non-sensitive fields come back (see lib/orders.js publicView). If the webhook has not landed yet,
   the session is checked with Stripe and, when it is paid, the row is settled here (same idempotent path). */

const db = require('../lib/db.js');
const stripe = require('../lib/stripe.js');
const orders = require('../lib/orders.js');
const { query, bad, noStore } = require('../lib/http.js');

module.exports = async (req, res) => {
  noStore(res);
  if (req.method !== 'GET') return bad(res, 405, 'GET only');
  const sessionId = String(query(req).session_id || '');
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) return bad(res, 400, 'Missing session.');
  if (!db.configured()) return bad(res, 503, 'Order lookup is not set up yet.');

  let order;
  try { order = await orders.findBySession(sessionId); }
  catch (e) { console.error('order lookup failed', e.message); return bad(res, 502, 'Could not look up the order.'); }

  let session = null;
  if (!order || order.status === 'pending') {
    // Ask Stripe. This also covers the case where the session id never got attached to the row.
    try { session = await stripe.retrieveSession(sessionId); } catch (e) { console.error('session retrieve failed', e.message); }
    if (!order && session && session.metadata && session.metadata.order_id) {
      try { order = await orders.findById(session.metadata.order_id); } catch (e) { /* fall through */ }
    }
  }
  if (!order) return bad(res, 404, 'We could not find that order.');

  if (order.status === 'pending') {
    if (session && session.payment_status === 'paid') {
      try {
        const r = await orders.settle({ orderId: order.id, sessionId, paymentIntent: typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent && session.payment_intent.id) });
        order = r.order || (await orders.findById(order.id)) || order;
      } catch (e) { console.error('settle from success page failed', e.message); }
    } else {
      return res.status(202).json({ pending: true, ref: order.ref });
    }
  }
  return res.status(200).json(orders.publicView(order));
};
