# Build plan

Five phases. Each one ends with something Aden can click on and test. Do them in order, stop after each,
tell him what to test and how, and wait. Read `CLAUDE.md` first.

Current state: the storefront, cart and checkout form are done. `api/checkout.js` creates a Stripe Checkout Session
but has never been run against a real Stripe key. Nothing stores orders, nothing emails anyone, there is no admin.

---

## Phase 0 — Prove the money path (half a day)

Goal: a test-mode purchase works end to end on this machine, with no design changes.

1. `npm i -g vercel`, `cp .env.example .env.local`, put a Stripe **test** secret key in it, run `vercel dev`.
2. Open http://localhost:3000. Build an "18" number cake, add bomboloni, check out as pickup, pay with 4242.
3. Confirm: Stripe redirects to `/?order=success&session_id=cs_test_…`, the success view shows the order, the cart is empty,
   and the payment appears in Stripe → Payments with the pickup date, window, phone and items in its metadata.
4. Repeat with delivery under $150 (fee $12) and over $150 (free). Repeat with a date that is too soon (server must refuse
   with a readable message) and with a Monday (server must refuse: pickup days are Thu–Sun).
5. Run through the site at 400px wide in devtools. No horizontal scroll, dialog usable, checkout usable.
6. Fix anything that breaks. If something in `index.html` has to change, change the smallest possible thing.

Done when: all of step 3–5 pass and you have written the exact clicks in a short `docs/TESTING.md`.

---

## Phase 1 — Orders the baker can see, and emails (1–2 days)

Goal: every paid order is a row in a database and two emails go out. This is the real gap in the product.

### 1a. Supabase table

Run in the Supabase SQL editor (Aden has a Supabase account; ask him for the project or create one named `marble-box`):

```sql
create table public.orders (
  id                    uuid primary key default gen_random_uuid(),
  created_at            timestamptz not null default now(),
  paid_at               timestamptz,
  ref                   text not null,
  status                text not null default 'pending'
                        check (status in ('pending','paid','in_progress','ready','completed','cancelled','refunded')),
  stripe_session_id     text unique,
  stripe_payment_intent text,
  customer_name         text not null,
  customer_email        text not null,
  customer_phone        text not null,
  method                text not null check (method in ('pickup','delivery')),
  pickup_date           date not null,
  pickup_window         text not null,
  address               text,
  notes                 text,
  items                 jsonb not null,   -- [{productId, name, options, summary, qty, unit_cents, amount_cents}]
  subtotal_cents        integer not null,
  delivery_fee_cents    integer not null default 0,
  total_cents           integer not null,
  currency              text not null default 'usd'
);
create index orders_pickup_date_idx on public.orders (pickup_date, status);
alter table public.orders enable row level security;   -- no policies: only the service role (server) can read/write
```

### 1b. Create the order before Stripe, not after

Stripe metadata is capped at 500 characters per value, which a three-item box can exceed. So:

1. In `api/checkout.js`, after validation and pricing, **insert a `pending` row** into `orders` via the Supabase REST API
   (`POST {SUPABASE_URL}/rest/v1/orders`, headers `apikey` and `Authorization: Bearer {SERVICE_ROLE_KEY}`,
   `Prefer: return=representation`). Store `items` as the full structured list from `Pricing.totals()`.
2. Put `order_id` (the row's uuid) in the Checkout Session metadata and `payment_intent_data.metadata`.
   Keep the existing human-readable metadata too; the baker reads it in the Stripe app.
3. Set `expires_at` on the session to 30 minutes so abandoned sessions die quickly.
4. Pending rows that never pay are simply ignored everywhere (filter `status <> 'pending'`). Clean-up can wait.

### 1c. Webhook: `api/webhook.js`

- Handles `checkout.session.completed` (and `checkout.session.async_payment_succeeded` for completeness).
- **Verify the signature.** Vercel parses JSON bodies by default, which breaks verification. Disable it for this file:
  `module.exports.config = { api: { bodyParser: false } }` and read the raw body from the stream.
  Verification without the SDK, using Node `crypto`:
  ```js
  // header: t=1700000000,v1=abc...   signed payload: `${t}.${rawBody}`
  const sig = Object.fromEntries(req.headers['stripe-signature'].split(',').map(p => p.split('=')));
  const expected = crypto.createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET).update(`${sig.t}.${raw}`).digest('hex');
  const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig.v1)) && Math.abs(Date.now()/1000 - sig.t) < 300;
  ```
  Using the official `stripe` npm package (`stripe.webhooks.constructEvent`) is also fine; if you add it, add it only here.
- On a paid session: update the row where `id = metadata.order_id` → `status='paid'`, `paid_at=now()`,
  `stripe_session_id`, `stripe_payment_intent`. Make it idempotent (Stripe retries): if the row is already `paid`, return 200.
- Respond 200 quickly; do the emails after the update, and never let an email failure turn into a non-2xx (Stripe would retry and double-send).
- Local testing: `stripe listen --forward-to localhost:3000/api/webhook`, then `stripe trigger checkout.session.completed`
  or just buy something at localhost:3000.

### 1d. Emails via Resend (`POST https://api.resend.com/emails`, bearer `RESEND_API_KEY`)

Two plain, well-set HTML emails that share the storefront's look (pink, the display face, the marble ticket).
Put the templates in `lib/emails.js` so they are testable.

- **To the baker** (`ORDER_EMAIL_TO`): subject `New order MB-1234 · Sat Oct 24 · 10:00–12:00 · pickup`. Body: customer,
  phone, method, date, window, address, notes, each item with its summary line, totals, a link to the Stripe payment.
- **To the customer**: subject `Your Marble Box order MB-1234 is in`. Body: what they ordered, when and how they get it,
  the "we text the day before" line, the allergen line, how to change the order (text the number, 48 h rule from the FAQ).
  Stripe's own receipt covers the payment; this email covers the pickup.
- Resend only delivers to Aden's own address until a sending domain is verified. Phase 4 handles the domain.

### 1e. Success page from the server

- `api/order.js`: `GET /api/order?session_id=cs_…` → returns the order's non-sensitive fields (ref, items, totals, method,
  date, window, first name, masked email). If the row is still `pending` (webhook not arrived yet), retrieve the session
  from Stripe, and if `payment_status === 'paid'`, mark the row paid yourself, then return it.
- `completeOrder()` in `index.html`: try the API first; fall back to the existing `localStorage` snapshot if it fails.
  This makes the confirmation page work on a different device, after a cleared browser, and when the user reloads.

Done when: a test purchase produces a `paid` row, two emails arrive at Aden's inbox, and the success page renders from the
API with `localStorage` cleared. A refused webhook (bad signature) returns 400 and changes nothing.

---

## Phase 2 — Admin: the day sheet (1 day)

Goal: the baker opens one page on her phone each morning and sees what to bake.

- `admin.html` + `api/admin/orders.js` (list, filter by date range/status) + `api/admin/order.js` (PATCH status).
- Auth: `ADMIN_PASSWORD` env var. The page asks for it once, keeps it in `sessionStorage`, sends `Authorization: Bearer`.
  Compare with `crypto.timingSafeEqual`. Rate-limit by returning 429 after 10 bad tries per hour per IP (in-memory is fine).
  This is enough for a two-person bakery; note in the README that Supabase Auth is the upgrade path.
- Views: **Today / This week / All upcoming**, grouped by pickup date then window. Each order card: ref, name, phone
  (tap to call), method + address, items with summary lines (the baker needs "50 · Gold & crown · Pistachio" at a glance),
  notes highlighted, total, status pill. Buttons: In progress → Ready → Picked up / Delivered. Search by name or ref.
- A **print view** of one day (plain, black on white, big type) for the kitchen wall. `@media print` only.
- Same tokens and fonts as the storefront. It is the same brand, used by the owner.

Done when: Aden can log in on a phone, see the test orders by day, change a status, and print a day sheet.

---

## Phase 3 — Capacity and promotions (half a day)

- `brand.maxOrdersPerDay` (number) and `brand.blackoutDates` (array of `YYYY-MM-DD`) in `catalog.json`.
- `api/availability.js`: `GET /api/availability?from=…&to=…` → `{ "2026-10-24": "open" | "full" | "closed" }`
  counting `status in ('paid','in_progress','ready')` plus `pending` rows younger than 30 minutes.
- Checkout page: fetch availability when it opens; show "Full" days under the date field and refuse them before submit.
  `api/checkout.js`: refuse full/blackout dates with a readable message (the browser check is only a courtesy).
- `allow_promotion_codes=true` on the Checkout Session, so the owner can make codes in the Stripe dashboard with no code change.
- Optional, ask first: Stripe Tax (`automatic_tax[enabled]=true`) once the owner has turned it on in Stripe.

Done when: setting `maxOrdersPerDay: 1` and placing one test order makes that day unselectable and the API refuses a second.

---

## Phase 4 — Launch (1 day, plus waiting on the owner)

### Hosting decision (ask Aden; do not pick silently)
Vercel's Hobby plan is for personal, non-commercial use, and a bakery taking payments is commercial. Options:
- **Vercel Pro** (~$20/month): zero code changes.
- **Cloudflare Pages** (free, commercial allowed): port `api/*.js` to Pages Functions (`functions/api/checkout.js` exporting
  `onRequestPost({ request, env })`, Web `Request`/`Response`, env from `env`, raw body via `request.text()`). Logic is
  identical; it is a thin wrapper per file. `vercel.json` headers move to `_headers`.
- Netlify is a similar port. Whatever is chosen, the domain goes there.

### Checklist
- Replace every placeholder in `catalog.json` with the real bakery's details (see "Ask Aden" below). Real prices.
- Stripe: the **bakery owner** opens the Stripe account in the business's name (payouts go to her bank; she carries the
  tax reporting). Aden joins as a team member. Switch the keys to `sk_live_` only after she has completed Stripe's business
  verification. Turn on "Successful payments" receipts in Stripe → Settings → Emails.
- Production webhook endpoint in Stripe → Developers → Webhooks → `https://<domain>/api/webhook`, event
  `checkout.session.completed`; copy its `whsec_` into the host's env.
- Resend: verify the sending domain (SPF/DKIM records at the registrar), set `ORDER_EMAIL_FROM`.
- Images: write `scripts/images.py` that makes 480/960/1600 px WebP + JPEG and update `<img>` to `srcset`/`sizes`
  with `<picture>`. Keep the originals. Lighthouse mobile ≥ 90 performance, ≥ 95 accessibility.
- SEO: `<title>`/description with the city, Open Graph + Twitter card using `images/number-50-marble.jpg` cropped to
  1200×630 (`images/og.jpg`), `robots.txt`, `sitemap.xml`, JSON-LD `Bakery` with address, hours, phone, Instagram.
- A real `favicon.svg` and `apple-touch-icon.png` from the pink "M" placeholder in `index.html`.
- `docs/TESTING.md` updated; a Playwright script `tests/purchase.spec.js` that walks: build cake → add → checkout →
  POST returns a `checkout.stripe.com` URL (do not automate Stripe's hosted page).
- Legal lines in the footer: refund policy (already in the FAQ), contact, allergen statement. No invented claims.

Done when: a real card buys a $1 test product on the live domain and is refunded, both emails arrive at real addresses,
the order shows in admin, and Lighthouse passes.

---

## Ask Aden before guessing

Everything below is a placeholder I (the previous session) invented so the design had real-looking content.
Do not ship any of it without confirmation:

| Placeholder | Where |
| --- | --- |
| Bakery name "Marble Box", tagline, "two-person kitchen" story | `catalog.json` → brand, `index.html` details/FAQ copy |
| City Houston, phone +1 (713) 555-0142, email, Instagram handle | `catalog.json` → brand |
| Pickup Thu–Sun 10–6, four 2-hour windows, 15-mile delivery, $12 fee, free over $150 | `catalog.json` |
| Every price, every lead time, serving counts | `catalog.json` → products, `index.html` specs table |
| Refund policy (72 h full / 48 h half / none inside 48 h), change policy | `index.html` FAQ |
| Allergen statement | `catalog.json` → brand.allergens |
| Which products exist at all (8 shown) and their option lists | `catalog.json` |

Also ask: who owns the Stripe account, the domain name, which host (see Phase 4), and whether SMS confirmations are wanted
later (Twilio needs US A2P 10DLC registration, which takes days and costs money; email first).
