/* Sends the order emails through Resend. Never throws: a failed email must not fail a webhook (Stripe would retry and
   the customer would get the email twice). Until a sending domain is verified in Resend, ORDER_EMAIL_FROM can stay unset
   and mail goes from onboarding@resend.dev, which Resend only delivers to the account owner's own address. */
'use strict';

const catalog = require('../catalog.json');
const emails = require('./emails.js');
const stripe = require('./stripe.js');

function configured() { return !!process.env.RESEND_API_KEY; }
function from() { return process.env.ORDER_EMAIL_FROM || `${catalog.brand.name} <onboarding@resend.dev>`; }

async function send({ to, subject, html, text, replyTo }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, skipped: true, reason: 'RESEND_API_KEY not set' };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: from(), to: Array.isArray(to) ? to : [to], subject, html, text, ...(replyTo ? { reply_to: replyTo } : {}) })
    });
    const data = await r.json().catch(() => null);
    if (!r.ok) return { ok: false, status: r.status, reason: (data && data.message) || 'Resend refused the email' };
    return { ok: true, id: data && data.id };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

// Both emails for a paid order. Returns what happened so the caller can log it.
async function sendOrderEmails(order) {
  const results = {};
  const bakerTo = process.env.ORDER_EMAIL_TO;
  if (bakerTo) {
    const m = emails.bakerEmail(order, { paymentUrl: stripe.paymentUrl(order.stripe_payment_intent) });
    results.baker = await send({ to: bakerTo, replyTo: order.customer_email, ...m });
  } else {
    results.baker = { ok: false, skipped: true, reason: 'ORDER_EMAIL_TO not set' };
  }
  const c = emails.customerEmail(order);
  results.customer = await send({ to: order.customer_email, replyTo: bakerTo || undefined, ...c });
  return results;
}

module.exports = { configured, send, sendOrderEmails, from };
