/* Stripe REST calls without the SDK. */
'use strict';

function key() { return process.env.STRIPE_SECRET_KEY || ''; }
function configured() { return !!key(); }
function isTestMode() { return key().startsWith('sk_test_'); }

class StripeError extends Error {
  constructor(message, status, raw) { super(message); this.status = status; this.raw = raw; }
}

async function call(path, { method = 'GET', form } = {}) {
  const k = key();
  if (!k) throw new StripeError('The server is missing STRIPE_SECRET_KEY. Add it in the hosting dashboard and redeploy.', 500);
  const r = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: { Authorization: `Bearer ${k}`, ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body: form
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new StripeError((data && data.error && data.error.message) || 'Stripe refused the request.', r.status, data);
  return data;
}

function createCheckoutSession(form) { return call('checkout/sessions', { method: 'POST', form }); }
function retrieveSession(id) { return call(`checkout/sessions/${encodeURIComponent(id)}`); }

// Dashboard link the baker can tap from the order email.
function paymentUrl(paymentIntentId) {
  if (!paymentIntentId) return '';
  return `https://dashboard.stripe.com/${isTestMode() ? 'test/' : ''}payments/${paymentIntentId}`;
}

module.exports = { configured, isTestMode, call, createCheckoutSession, retrieveSession, paymentUrl, StripeError };
