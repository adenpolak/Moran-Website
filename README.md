# My Sweetart storefront

A cake-shop store that works like a small Shopify site: product options, a cart, a checkout form, Stripe payments,
an orders table, two confirmation emails and a day sheet for the kitchen. Plain HTML/CSS/JS and a handful of
serverless functions, no framework, no build step.

```
index.html           the storefront
admin.html           the baker's day sheet (/admin, password-protected)
catalog.json         menu, prices, options, brand details, capacity  ← edit this to change the shop
lib/pricing.js       pricing rules shared by the page and the server
lib/                 db (Supabase REST), stripe, orders, emails, mail (Resend), availability, admin auth
api/checkout.js      validates + re-prices the box, saves a pending order, creates the Stripe Checkout Session
api/webhook.js       Stripe → marks the order paid, sends the two emails (signature verified, idempotent)
api/order.js         the paid order behind a session id, for the success page
api/availability.js  which pickup days are open / full / closed
api/admin/*.js       list orders, change status
api/sitemap.js, api/robots.js   built from the live domain
images/              product photos (see images/README.md for the expected files)
scripts/             dev-server.js (vercel dev without a login), images.py (resize, WebP, OG image, marble tile)
tests/               api.test.js (node --test, no keys needed), purchase.spec.js (Playwright)
supabase/schema.sql  the orders table
docs/                BUILD_PLAN.md (the phases), TESTING.md (exact clicks)
CLAUDE.md            rules and context for Claude Code
```

## Run it locally

```bash
npm install                      # Playwright test runner only; the site itself has no dependencies
cp .env.example .env.local       # put a Stripe test key (sk_test_…) in STRIPE_SECRET_KEY; the rest is optional
npm run serve                    # http://localhost:3000  (or `vercel dev` once you are logged in to Vercel)
npm test && npm run test:e2e     # unit + browser tests
```
Test card: 4242 4242 4242 4242, any future date, any CVC.
Webhooks locally: `stripe listen --forward-to localhost:3000/api/webhook` prints the `whsec_` for `.env.local`.

## Environment variables

All in `.env.example`. Everything degrades gracefully: with only `STRIPE_SECRET_KEY` the shop takes payments and the
order lives in Stripe's metadata; add Supabase for the orders table, success page and admin; add Resend for emails;
add `ADMIN_PASSWORD` for `/admin`; add `STRIPE_WEBHOOK_SECRET` for the webhook.

| Variable | Used by |
| --- | --- |
| `STRIPE_SECRET_KEY` | checkout, order lookup |
| `STRIPE_WEBHOOK_SECRET` | webhook |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | checkout, webhook, order, availability, admin |
| `RESEND_API_KEY`, `ORDER_EMAIL_TO`, `ORDER_EMAIL_FROM` | emails (FROM defaults to `onboarding@resend.dev` until a domain is verified) |
| `ADMIN_PASSWORD` | `/admin` (8+ characters) |

## Deploy (Vercel)

Import the GitHub repo at vercel.com/new, framework **Other**, no build command, add the variables above, Deploy.
Then create the Stripe webhook (`https://<domain>/api/webhook`, event `checkout.session.completed`), paste its
signing secret as `STRIPE_WEBHOOK_SECRET`, redeploy. Every push to `main` redeploys.
Vercel's Hobby plan is for non-commercial use; see "Hosting decision" in `docs/BUILD_PLAN.md` before the shop takes real money.

## Database

Create a Supabase project and run `supabase/schema.sql` in its SQL editor once. Row-level security is on with no
policies, so only the server (service-role key) can read or write. Never ship that key to the browser.

## Admin

`/admin` asks for `ADMIN_PASSWORD` once per browser session and compares it in constant time; ten wrong tries from one
IP lock that IP out for an hour. That is right-sized for a two-person bakery. When more staff need logins, the upgrade
path is Supabase Auth (magic-link sign-in) with the JWT checked in `lib/auth.js` instead of the shared password.

## Change the shop

Everything a bakery owner would change lives in `catalog.json`: name, city, phone, pickup days and windows, delivery fee,
products, options, prices, lead times, which photos show, `maxOrdersPerDay`, `blackoutDates`. The page reads it on load
and the checkout function reads the same file, so the amount Stripe charges always matches the menu. Promotion codes
are made in the Stripe dashboard (Products → Coupons); checkout already accepts them.
