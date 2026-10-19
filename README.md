# Marble Box storefront

A cake-shop store that works like a small Shopify site: product options, a cart, a checkout form and Stripe payments.
Plain HTML/CSS/JS, one serverless function, no framework, no build step.

```
index.html       the storefront
catalog.json     menu, prices, options, brand details  ← edit this to change the shop
lib/pricing.js   pricing rules shared by the page and the server
api/checkout.js  creates the Stripe Checkout Session (re-prices everything server-side)
images/          product photos
docs/            BUILD_PLAN.md — what to build next, phase by phase
CLAUDE.md        rules and context for Claude Code
```

## Run it locally

```bash
npm i -g vercel
cp .env.example .env.local      # put a Stripe test key (sk_test_…) in STRIPE_SECRET_KEY
vercel dev                      # http://localhost:3000
```
Test card: 4242 4242 4242 4242, any future date, any CVC.

## Deploy

`vercel` once to create the project, `vercel env add STRIPE_SECRET_KEY`, then `vercel --prod`.
Vercel's free plan is for non-commercial use; see "Hosting decision" in `docs/BUILD_PLAN.md` before the shop takes real money.

## Change the shop

Everything a bakery owner would change lives in `catalog.json`: name, city, phone, pickup days and windows, delivery fee,
products, options, prices, lead times, which photos show. The page reads it on load and the checkout function reads
the same file, so the amount Stripe charges always matches the menu.

## Hand this to Claude Code

Open a terminal in this folder, run `claude`, and paste:

> Read CLAUDE.md and docs/BUILD_PLAN.md. Start with Phase 0: run the store locally with `vercel dev`, complete a Stripe
> test-mode purchase end to end, and fix anything that breaks without changing the design. Then stop and show me exactly
> what to test. After I confirm, do Phase 1. Ask me before adding any paid service or changing prices or copy.
