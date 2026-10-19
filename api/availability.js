/* GET /api/availability?from=YYYY-MM-DD&to=YYYY-MM-DD → { "2026-10-24": "open" | "full" | "closed", … }
   Open days come from catalog.json (pickupDays, blackoutDates, maxOrdersPerDay); counts come from Supabase. */

const availability = require('../lib/availability.js');
const { query, bad, noStore } = require('../lib/http.js');

const MAX_DAYS = 120;

module.exports = async (req, res) => {
  noStore(res);
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return bad(res, 405, 'GET only');
  const q = query(req);
  const today = new Date().toISOString().slice(0, 10);
  const from = availability.ISO.test(q.from || '') ? q.from : today;
  let to = availability.ISO.test(q.to || '') ? q.to : availability.addDays(from, 90);
  if (to < from) to = from;
  if (availability.addDays(from, MAX_DAYS) < to) to = availability.addDays(from, MAX_DAYS);
  try {
    return res.status(200).json(await availability.calendar(from, to));
  } catch (e) {
    console.error('availability failed', e.message);
    return bad(res, 502, 'Could not load availability.');
  }
};
