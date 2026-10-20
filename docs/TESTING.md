# Testing

Two automated suites and one manual walk. Run the automated ones before every push.

```bash
npm test          # 13 unit tests: pricing, checkout rules, webhook signature + idempotency, order lookup, admin auth
npm run test:e2e  # Playwright: builds a cake in a real browser, checks out, POSTs to /api/checkout, 400px layout, admin login
```

The unit tests fake Stripe, Supabase and Resend in memory, so they need no keys. The browser test starts
`scripts/dev-server.js` on port 3100 by itself. Without a `STRIPE_SECRET_KEY` it asserts the server's readable
"missing key" error; with a test key in `.env.local` it asserts the `checkout.stripe.com` URL and follows it.

## Local server without a Vercel login

```bash
cp .env.example .env.local      # fill in what you have; everything degrades gracefully when a key is missing
npm run serve                   # http://localhost:3000 — static files + every api/*.js, same req/res shape as Vercel
```
`vercel dev` works too once you are logged in to Vercel.

## Manual walk on the live site (Phase 0 acceptance)

Stripe test card: **4242 4242 4242 4242**, any future expiry, any CVC, any ZIP.

1. Open the site. In the "Try it" box type **18**, tap **Build this cake**. Pick *Gold & crown* and *Pistachio*.
   The button should read **Add to box · $180**. Tap it. The photo flies into the bag and the drawer opens.
2. Tap **×**, scroll to the menu, tap **Choose & add** under *Bomboloni box*, tap **Add to box · $36**.
   The bag shows **$216** and "Earliest pickup for this box: … (2 days' notice)".
3. Tap **Checkout**. Fill name, email, mobile. Leave **Pickup**. The date is already the next Thu–Sun at least two days
   out. Pick a window. Tap **Pay $216 on Stripe**.
4. On Stripe, pay with 4242. You land on `/?order=success&session_id=cs_test_…`: "Thank you, <first name>.", the
   order number, the items and **Paid $216**, and the bag badge is **0**.
5. In Stripe → Payments the charge shows the pickup date, window, phone and item list under **Metadata**.
6. In **/admin** (password from `ADMIN_PASSWORD`) the order is under **Today / This week** with its summary lines.
   Tap **Start baking → Mark ready → Picked up / delivered**; each tap updates the pill.
7. Two emails: *New order MS-xxxx · … · pickup* to `ORDER_EMAIL_TO`, and *Your My Sweetart order MS-xxxx is in* to the
   address you typed (until a domain is verified in Resend, only the Resend account owner's address receives mail).
8. Delivery: repeat with only the bomboloni box (**$36**), choose **Delivery**, type an address. Total **$48** ($12 fee).
   Repeat with the cake in the box too (**$216**): Delivery shows **Free**.
9. Refusals (the server, not just the form):
   - Change the date in the address bar of a request, or with devtools, to tomorrow → "That date is too soon…".
   - A Monday → "We bake for Thu–Sun only."
   - A date in `brand.blackoutDates` → "We are closed that day."
   - Set `maxOrdersPerDay: 1` in `catalog.json`, redeploy, buy once, try again the same day → "That day is fully booked…"
     and the checkout page lists it under **Full:** and moves the date forward.
10. Phone layout: in devtools set 400 px wide. No sideways scroll on the home page, in the product dialog, or at checkout.
11. Webhook check: in Stripe → Developers → Webhooks → your endpoint, the recent deliveries are **200**. Send a test event
    from there: it returns 200 with `ignored` or `no order_id`, never 500. A request with a bad signature returns **400**.

## Print the day sheet

In `/admin`, pick a day, tap **Print this day**. Only that day prints, black on white, big type, one card per order.
