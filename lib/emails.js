/* The two order emails, as {subject, html, text}. Pure functions over an orders row, so they are easy to test and preview:
     node -e "const e=require('./lib/emails.js');console.log(e.customerEmail(e.sampleOrder()).html)" > /tmp/mail.html
   Styling mirrors the storefront (Studio Light, Oct 2026): white paper, near-black ink, one grey, hairline rules, raspberry
   for the one link that matters, a near-black ticket head. Email clients ignore web fonts, so the display face falls back
   to Georgia; the structure is what carries the brand. */
'use strict';

const catalog = require('../catalog.json');

const C = { paper: '#FFFFFF', paper2: '#F3F3F1', ink: '#111111', ink2: '#5F5F5F', line: '#E6E6E3', pink: '#FF5C9A', pinkDeep: '#D81B60', pinkSoft: '#FFE9F0', night: '#111111', cream: '#F7F5F0' };

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = c => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

function fmtDate(iso, long) {
  const d = new Date(iso + 'T12:00:00Z');
  return d.toLocaleDateString('en-US', long
    ? { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }
    : { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).replace(/^(\w{3}),/, '$1');   // "Sat Oct 24", as the plan spells it
}

function itemsHtml(items) {
  return items.map(it => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px dotted ${C.line};font:15px/1.4 'Instrument Sans',Helvetica,Arial,sans-serif;color:${C.ink};">
        ${esc(it.name)}${it.qty > 1 ? ` <span style="color:${C.ink2};font-size:12px;">× ${it.qty}</span>` : ''}
        <div style="font:12px/1.5 'DM Mono',Menlo,monospace;color:${C.ink2};">${esc(it.summary)}</div>
      </td>
      <td align="right" style="padding:10px 0 10px 16px;border-bottom:1px dotted ${C.line};font:14px/1.4 'DM Mono',Menlo,monospace;white-space:nowrap;vertical-align:top;">${money(it.amount_cents)}</td>
    </tr>`).join('');
}

function itemsText(items) {
  return items.map(it => `  ${it.qty > 1 ? it.qty + '× ' : ''}${it.name} — ${it.summary} — ${money(it.amount_cents)}`).join('\n');
}

function totalsHtml(o) {
  const row = (label, v, strong) => `<tr><td style="padding:4px 0;font:${strong ? '600 18px' : '14px'}/1.4 ${strong ? "'DM Mono',Menlo,monospace" : "'Instrument Sans',Helvetica,Arial,sans-serif"};color:${C.ink};">${label}</td><td align="right" style="padding:4px 0;font:${strong ? '600 18px' : '14px'}/1.4 'DM Mono',Menlo,monospace;">${v}</td></tr>`;
  return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-top:10px;">
    ${row('Subtotal', money(o.subtotal_cents))}
    ${o.method === 'delivery' ? row('Delivery', o.delivery_fee_cents ? money(o.delivery_fee_cents) : 'Free') : ''}
    <tr><td colspan="2" style="border-top:1.5px solid ${C.ink};padding-top:6px;"></td></tr>
    ${row('Paid', money(o.total_cents), true)}
  </table>`;
}

function ticket(o, head) {
  return `
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border:1.5px solid ${C.ink};border-radius:12px;overflow:hidden;background:#ffffff;">
    <tr><td style="background:${C.night};padding:12px 18px;">
      <table width="100%" role="presentation"><tr>
        <td style="font:400 20px/1 Georgia,'Times New Roman',serif;color:${C.cream};">${esc(head)}</td>
        <td align="right" style="font:500 12px/1 'DM Mono',Menlo,monospace;letter-spacing:.06em;color:${C.cream};">No. ${esc(o.ref)}</td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:6px 18px 16px;">
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation">${itemsHtml(o.items)}</table>
      ${totalsHtml(o)}
    </td></tr>
  </table>`;
}

function shell(title, bodyHtml) {
  const b = catalog.brand;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:${C.paper2};">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:${C.paper2};"><tr><td align="center" style="padding:28px 12px;">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;background:${C.paper};border-radius:14px;overflow:hidden;">
  <tr><td style="background:${C.pink};height:8px;line-height:8px;font-size:0;">&nbsp;</td></tr>
  <tr><td style="padding:26px 28px 6px;">
    <div style="font:400 26px/1 Georgia,'Times New Roman',serif;color:${C.ink};">${esc(b.name)} <span style="font:500 10px/1 'DM Mono',Menlo,monospace;letter-spacing:.16em;text-transform:uppercase;color:${C.ink2};">${esc(b.descriptor)}</span></div>
  </td></tr>
  <tr><td style="padding:10px 28px 28px;font:16px/1.55 'Instrument Sans',Helvetica,Arial,sans-serif;color:${C.ink};">
    ${bodyHtml}
  </td></tr>
  <tr><td style="padding:16px 28px 24px;border-top:1px solid ${C.line};font:12px/1.6 'DM Mono',Menlo,monospace;color:${C.ink2};">
    ${esc(b.name)} ${esc(b.descriptor)} · ${esc(b.city)} · ${esc(b.phone)} · ${esc(b.email)}
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function kv(rows) {
  return `<table cellpadding="0" cellspacing="0" role="presentation" style="margin:14px 0 18px;">${rows.filter(r => r[1]).map(([k, v, hl]) => `
    <tr><td style="padding:3px 14px 3px 0;font:500 11px/1.8 'DM Mono',Menlo,monospace;letter-spacing:.12em;text-transform:uppercase;color:${C.ink2};vertical-align:top;white-space:nowrap;">${esc(k)}</td>
        <td style="padding:3px 0;font:15px/1.5 'Instrument Sans',Helvetica,Arial,sans-serif;color:${C.ink};${hl ? `background:${C.pinkSoft};padding:6px 10px;border-radius:6px;border:1px dashed ${C.pink};` : ''}">${v}</td></tr>`).join('')}</table>`;
}

/* ---------- to the baker ---------- */
function bakerEmail(o, { paymentUrl } = {}) {
  const subject = `New order ${o.ref} · ${fmtDate(o.pickup_date)} · ${o.pickup_window} · ${o.method}`;
  const tel = String(o.customer_phone).replace(/[^\d+]/g, '');
  const html = shell(subject, `
    <h1 style="margin:0 0 6px;font:400 30px/1.1 Georgia,'Times New Roman',serif;color:${C.ink};">New order.</h1>
    <p style="margin:0;color:${C.ink2};">${esc(o.method === 'delivery' ? 'Delivery' : 'Pickup')} <strong style="color:${C.ink};">${esc(fmtDate(o.pickup_date, true))}</strong>, ${esc(o.pickup_window)}.</p>
    ${kv([
      ['Customer', esc(o.customer_name)],
      ['Phone', `<a href="tel:${esc(tel)}" style="color:${C.pinkDeep};">${esc(o.customer_phone)}</a>`],
      ['Email', `<a href="mailto:${esc(o.customer_email)}" style="color:${C.pinkDeep};">${esc(o.customer_email)}</a>`],
      ['Method', esc(o.method)],
      ['Address', o.address ? esc(o.address) : ''],
      ['Notes', o.notes ? esc(o.notes) : '', true]
    ])}
    ${ticket(o, 'Order')}
    <p style="margin:18px 0 0;font:13px/1.6 'DM Mono',Menlo,monospace;color:${C.ink2};">
      ${paymentUrl ? `<a href="${esc(paymentUrl)}" style="color:${C.pinkDeep};">Open the payment in Stripe</a> · ` : ''}paid ${esc(o.paid_at ? new Date(o.paid_at).toLocaleString('en-US', { timeZone: 'UTC' }) + ' UTC' : 'just now')}
    </p>`);
  const text = [
    subject, '',
    `Customer: ${o.customer_name}`, `Phone: ${o.customer_phone}`, `Email: ${o.customer_email}`,
    `Method: ${o.method} — ${fmtDate(o.pickup_date, true)}, ${o.pickup_window}`,
    o.address ? `Address: ${o.address}` : '', o.notes ? `NOTES: ${o.notes}` : '', '',
    'Items:', itemsText(o.items), '',
    `Subtotal ${money(o.subtotal_cents)}`, o.method === 'delivery' ? `Delivery ${o.delivery_fee_cents ? money(o.delivery_fee_cents) : 'Free'}` : '', `Paid ${money(o.total_cents)}`,
    paymentUrl ? `\nStripe: ${paymentUrl}` : ''
  ].filter(l => l !== '').join('\n');
  return { subject, html, text };
}

/* ---------- to the customer ---------- */
function customerEmail(o) {
  const b = catalog.brand;
  const first = String(o.customer_name).trim().split(/\s+/)[0] || 'there';
  const subject = `Your ${b.name} order ${o.ref} is in`;
  const when = `${fmtDate(o.pickup_date, true)}, ${o.pickup_window}`;
  const how = o.method === 'delivery'
    ? `we deliver to <strong>${esc(o.address || 'the address you gave us')}</strong>. Someone needs to be home to take the box.`
    : `pick up at the address in your text. Bring a flat surface in the car and a fridge shelf at home.`;
  const html = shell(subject, `
    <h1 style="margin:0 0 6px;font:400 30px/1.1 Georgia,'Times New Roman',serif;color:${C.ink};">Thank you, ${esc(first)}.</h1>
    <p style="margin:0 0 18px;color:${C.ink2};">Your order is in and the kitchen has it. Here is what we have down.</p>
    ${ticket(o, 'Your order')}
    <h2 style="margin:26px 0 8px;font:400 20px/1.2 Georgia,'Times New Roman',serif;">What happens now</h2>
    <ol style="margin:0;padding-left:20px;color:${C.ink2};">
      <li style="margin-bottom:8px;"><strong style="color:${C.ink};">Today:</strong> Stripe sends your payment receipt to ${esc(o.customer_email)}.</li>
      <li style="margin-bottom:8px;"><strong style="color:${C.ink};">The day before:</strong> we text ${esc(o.customer_phone)} to confirm your ${esc(o.method === 'delivery' ? 'delivery' : 'pickup')} window.</li>
      <li style="margin-bottom:8px;"><strong style="color:${C.ink};">${esc(when)}:</strong> ${how}</li>
      ${o.notes ? `<li style="margin-bottom:8px;"><strong style="color:${C.ink};">Your notes:</strong> ${esc(o.notes)}</li>` : ''}
    </ol>
    <p style="margin:22px 0 0;padding:12px 14px;border:1.5px dashed ${C.pink};border-radius:8px;background:${C.pinkSoft};font-size:14px;">
      <strong>Need to change something?</strong> Text ${esc(b.phone)} with your order number ${esc(o.ref)}. Changes are free up to 48 hours before your ${esc(o.method)}; inside 48 hours the bases are already made, so we can only swap toppings.
    </p>
    <p style="margin:16px 0 0;font:12px/1.6 'DM Mono',Menlo,monospace;color:${C.ink2};">${esc(b.allergens)}</p>`);
  const text = [
    `Thank you, ${first}.`, '', `Order ${o.ref}`, '', itemsText(o.items), '',
    `Subtotal ${money(o.subtotal_cents)}`, o.method === 'delivery' ? `Delivery ${o.delivery_fee_cents ? money(o.delivery_fee_cents) : 'Free'}` : '', `Paid ${money(o.total_cents)}`, '',
    `${o.method === 'delivery' ? 'Delivery' : 'Pickup'}: ${when}`, o.address ? `Address: ${o.address}` : '',
    `We text ${o.customer_phone} the day before to confirm the window.`,
    o.notes ? `Your notes: ${o.notes}` : '', '',
    `Need to change something? Text ${b.phone} with your order number ${o.ref}. Changes are free up to 48 hours before; inside 48 hours we can only swap toppings.`, '',
    b.allergens
  ].filter(l => l !== '').join('\n');
  return { subject, html, text };
}

// A realistic row for previews and tests.
function sampleOrder(over) {
  return Object.assign({
    id: '00000000-0000-4000-8000-000000000000', ref: 'MB-1234', status: 'paid', paid_at: '2026-10-19T18:02:00Z',
    stripe_session_id: 'cs_test_sample', stripe_payment_intent: 'pi_sample',
    customer_name: 'Dana Levi', customer_email: 'dana@example.com', customer_phone: '+1 (713) 555-0199',
    method: 'pickup', pickup_date: '2026-10-24', pickup_window: '10:00 – 12:00', address: null, notes: 'Candles please, and no silver topper.',
    items: [
      { productId: 'number-cake', name: 'Number & letter cake', options: { chars: '50', topping: 'gold', cream: 'pistachio', topper: 'gold' }, summary: '50 · Gold & crown · Pistachio · gold topper', qty: 1, unit_cents: 18000, amount_cents: 18000 },
      { productId: 'bomboloni', name: 'Bomboloni box', options: { size: 'six', mix: 'assorted' }, summary: "Box of 6 · Baker's assortment", qty: 2, unit_cents: 3600, amount_cents: 7200 }
    ],
    subtotal_cents: 25200, delivery_fee_cents: 0, total_cents: 25200, currency: 'usd'
  }, over || {});
}

module.exports = { bakerEmail, customerEmail, sampleOrder, fmtDate };
