# My Sweetart — cake storefront

A Shopify-style store for a small bakery: number/letter cakes, bomboloni, kunafa cups, vintage cakes.
Customers build a cake (number, cream, toppings), add it to a box, pick a pickup/delivery date, and pay on Stripe Checkout.
The front end is finished and deliberately designed. Your job is the parts behind it: orders, emails, admin, launch.
The full plan with acceptance criteria is in `docs/BUILD_PLAN.md`. Work through it phase by phase and stop after each one.

## Non-negotiables

1. **Do not rewrite the front end.** No React, Next, Vue, Tailwind, Bootstrap, or a bundler. It is one `index.html` with
   vanilla CSS/JS on purpose, and the owner asked for a site that does not look AI-generated. Keep the fonts
   (Shrikhand / Instrument Sans / DM Mono), the colour tokens at the top of `<style>`, the copy voice, and the animations.
   Add to it; do not "modernize" it. The look (Oct 2026, chosen by the owner after his father reviewed two earlier
   versions) is photo-led and premium: white page, near-black type, one raspberry accent on the money actions, the real
   photos doing the work (edge-to-edge hero crossfade, tall photo cards, a balanced gallery grid with a lightbox), hairline
   dividers, a translucent sticky header, Instrument Sans headings at large sizes, DM Mono for data, Shrikhand for the
   wordmark only. No illustrations, stickers, sprinkles, drips or tilts. Photos ship as NAME-480/960/1600 JPEG + WebP via
   scripts/images.py; keep the home page under 2.5 MB and LCP under 3 s on a phone.
2. **The server sets every price.** `lib/pricing.js` is shared by the browser and `api/`. Any server code that charges money
   must re-price from `catalog.json` through that file and must never trust an amount, a total, or a price sent by the browser.
3. **`catalog.json` is the single source of truth** for brand text, pickup days/windows, delivery fee, products, options,
   prices and lead times. Do not duplicate any of it in JS, HTML or SQL.
4. **Secrets live in `.env.local` (git-ignored) and the host's environment settings.** Never commit a key, never print one,
   never put a secret key in client code. `SUPABASE_SERVICE_ROLE_KEY` is server-only.
5. **Stripe stays in test mode** (`sk_test_`) until Aden explicitly says to go live.
6. **Keep what already works:** keyboard focus states, `prefers-reduced-motion`, form labels, no horizontal scroll at 400px,
   the fly-to-bag animation, the preview notice when no backend is present.
7. **Ask before**: adding a paid service, changing prices or policy copy, picking a production host, sending any real email
   to anyone but Aden, or deleting anything in Stripe/Supabase.

## Repo map

```
index.html          the whole storefront: styles, markup, and the app script (shop → product dialog → box → checkout → success)
catalog.json        brand, fulfillment rules, products with options and prices
lib/pricing.js      UMD module: unitPrice / describe / validate / totals / leadDays — used by index.html AND api/
api/checkout.js     Vercel serverless function: validates the box, re-prices it, creates a Stripe Checkout Session
images/             product photos (JPEG, ≤1600px) and marble-tile.jpg (texture cut from the real packaging)
vercel.json         clean URLs + cache headers
.env.example        every environment variable, by phase
docs/BUILD_PLAN.md  phases, acceptance criteria, SQL, snippets
```

## How the site works (read before touching anything)

- **Views.** `#main` (shop), `#checkout`, `#success` are sections toggled with `hidden` by `showView()`. No router.
- **Catalog load.** `boot()` fetches `catalog.json`, then renders. Opening `index.html` from disk breaks `fetch`; run a server.
- **Options model.** Each product has `options[]` of type `size` (sets the base price), `choice` (adds `delta`), or `text`
  (free text with `pattern`/`maxLength`; `charPrices` prices a number cake by character count; `priceIfFilled` adds a flat
  amount when filled). `Pricing.validate()` is the rule set; the UI only mirrors it.
- **Cart.** `cart[]` of `{key, productId, options, qty}` in `localStorage` under `marblebox.cart.v1`. `key` is
  productId + JSON of options, so identical builds merge.
- **Dates.** `brand.pickupDays` are JS weekday numbers (0 = Sunday). The earliest date is today + the longest `leadDays`
  in the box, moved forward to the next open day. The server re-checks this with one day of slack for time zones.
- **Checkout.** The form POSTs JSON `{items, customer, fulfillment, ref}` to `CONFIG.checkoutEndpoint` (`/api/checkout`).
  The function answers `{url}` and the browser navigates to Stripe. Stripe returns to `/?order=success&session_id=…` or
  `/?order=cancelled`. The success view currently renders from a `localStorage` snapshot saved just before paying —
  Phase 1 replaces that with a server lookup.
- **Preview mode.** If the endpoint returns a non-JSON or JSON-without-`error` failure (no function deployed), the page
  shows a "Preview mode" notice and a demo success page instead of an error. Keep this behaviour.
- **Metadata.** `api/checkout.js` copies the order details (ref, phone, method, date, window, address, notes, item list)
  into the Checkout Session and PaymentIntent metadata, so even with nothing else built the baker can read an order in
  the Stripe dashboard.

## Local development

```bash
npm i -g vercel            # once
cp .env.example .env.local # fill STRIPE_SECRET_KEY with a test key
vercel dev                 # serves index.html and api/* at http://localhost:3000
```
Stripe test card: `4242 4242 4242 4242`, any future date, any CVC, any ZIP.
Webhooks locally: `stripe listen --forward-to localhost:3000/api/webhook` (prints the `whsec_` secret).

## Conventions

- Plain CommonJS in `api/` (`module.exports = async (req, res) => {}`), `fetch` for outbound calls, no SDKs unless
  the plan says so. Return `{ error: "plain sentence a customer can read" }` with a 4xx for anything the customer caused.
- Money is integer cents on the server and in the database; dollars only when displaying.
- New pages (admin, order lookup) reuse the tokens, fonts and components from `index.html`. Copy the `:root` block; do not
  invent a second palette.
- Commit after each phase with a message that says what a human can now do that they could not before.
