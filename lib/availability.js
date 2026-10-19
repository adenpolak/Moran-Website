/* Which pickup days are open, full or closed. Reads brand.pickupDays / blackoutDates / maxOrdersPerDay from catalog.json
   and counts live orders in Supabase. Without Supabase every allowed day is "open". */
'use strict';

const catalog = require('../catalog.json');
const db = require('./db.js');

const COUNTED = ['paid', 'in_progress', 'ready'];
const PENDING_TTL_MS = 30 * 60 * 1000;   // a pending row younger than this holds a slot (the session may still pay)
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function weekday(dateStr) { return new Date(dateStr + 'T12:00:00Z').getUTCDay(); }

function isBlackout(dateStr) { return (catalog.brand.blackoutDates || []).includes(dateStr); }

// 'closed' | 'full' | 'open' for one date given how many orders already sit on it.
function dayStatus(dateStr, count) {
  if (!ISO.test(dateStr)) return 'closed';
  if (!catalog.brand.pickupDays.includes(weekday(dateStr)) || isBlackout(dateStr)) return 'closed';
  const max = catalog.brand.maxOrdersPerDay;
  if (max > 0 && count >= max) return 'full';
  return 'open';
}

// { 'YYYY-MM-DD': n } of orders that hold a slot, for pickup dates between from and to inclusive.
async function countsBetween(from, to) {
  const counts = {};
  if (!db.configured()) return counts;
  const rows = await db.select('orders',
    `select=pickup_date,status,created_at&pickup_date=gte.${from}&pickup_date=lte.${to}&status=in.(${[...COUNTED, 'pending'].join(',')})`);
  const now = Date.now();
  for (const r of rows) {
    const holds = COUNTED.includes(r.status) || (r.status === 'pending' && now - Date.parse(r.created_at) < PENDING_TTL_MS);
    if (holds) counts[r.pickup_date] = (counts[r.pickup_date] || 0) + 1;
  }
  return counts;
}

async function statusFor(dateStr) {
  if (!ISO.test(dateStr)) return 'closed';
  const counts = await countsBetween(dateStr, dateStr);
  return dayStatus(dateStr, counts[dateStr] || 0);
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// { date: status } for every day from..to.
async function calendar(from, to) {
  const counts = await countsBetween(from, to);
  const out = {};
  for (let d = from; d <= to; d = addDays(d, 1)) out[d] = dayStatus(d, counts[d] || 0);
  return out;
}

module.exports = { dayStatus, countsBetween, statusFor, calendar, addDays, ISO, COUNTED };
