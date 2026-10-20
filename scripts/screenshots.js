#!/usr/bin/env node
/* Screenshots of every view that matters, for design review.
     node scripts/screenshots.js http://localhost:3000 ./shots
   Needs a running server (npm run serve) and the Playwright package (npm install). Prints the files it wrote. */
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');

const [base = 'http://localhost:3000', out = './shots'] = process.argv.slice(2);
const CHROME = process.env.PW_CHROMIUM_PATH || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(p => fs.existsSync(p));
fs.mkdirSync(out, { recursive: true });
const written = [];
const shot = async (page, name, opts = {}) => { const file = path.resolve(out, name + '.png'); await page.screenshot({ path: file, ...opts }); written.push(file); };
const settle = (page, ms = 1400) => page.waitForTimeout(ms);
// The gallery photos are fetched as they come within a screen of the viewport, so a full-page capture first walks the
// page the way a visitor would, then returns to the top.
const scrollThrough = async page => {
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < h; y += 500) { await page.evaluate(y => window.scrollTo({ top: y, behavior: 'instant' }), y); await page.waitForTimeout(60); }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' })); await settle(page, 1200);
};

async function tour(page, tag, { full = true } = {}) {
  await page.goto(base + '/'); await page.waitForSelector('#grid .card'); await settle(page);
  await shot(page, `home-${tag}`);
  if (full) { await scrollThrough(page); await shot(page, `home-${tag}-full`, { fullPage: true }); }
  await page.locator('#shop').scrollIntoViewIfNeeded(); await settle(page, 900);
  await shot(page, `menu-${tag}`);
  await page.locator('#gallery').scrollIntoViewIfNeeded(); await settle(page, 900);
  await shot(page, `gallery-${tag}`);
  await page.locator('#faq').scrollIntoViewIfNeeded(); await settle(page, 900);
  await shot(page, `faq-footer-${tag}`);
  await page.locator('.card-add[data-open="number-cake"]').click(); await page.waitForSelector('#pdp[open]'); await settle(page, 800);
  await page.fill('#pdp #opt-chars', '50'); await settle(page, 500);
  await shot(page, `dialog-${tag}`);
  await page.locator('#pdp-addbtn').click(); await settle(page, 1300);
  await shot(page, `bag-${tag}`);
  await page.click('#bag-checkout'); await settle(page, 700);
  await shot(page, `checkout-${tag}`);
  if (full) await shot(page, `checkout-${tag}-full`, { fullPage: true });
  await page.fill('#co-name', 'Dana Levi'); await page.fill('#co-email', 'dana@example.com'); await page.fill('#co-phone', '7135550199');
  await page.selectOption('#co-window', { index: 1 });
  await page.click('#co-pay'); await settle(page, 900);                     // saves the snapshot; the API answers with an error or Stripe
  if (!page.url().includes('stripe.com')) {
    await page.goto(base + '/?order=success'); await settle(page, 1200);      // success view from the snapshot
    await shot(page, `success-${tag}`);
  }
}

(async () => {
  const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {});
  const desk = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await tour(desk, 'desktop');
  const mob = await browser.newPage({ viewport: { width: 400, height: 820 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await tour(mob, 'mobile');
  const narrow = await browser.newPage({ viewport: { width: 360, height: 760 }, isMobile: true, hasTouch: true });
  await narrow.goto(base + '/'); await narrow.waitForSelector('#grid .card'); await settle(narrow);
  const overflow = await narrow.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await shot(narrow, 'home-360');
  const adm = await browser.newPage({ viewport: { width: 400, height: 820 }, isMobile: true });
  await adm.goto(base + '/admin'); await settle(adm, 600);
  await shot(adm, 'admin-login-mobile');
  await browser.close();
  console.log(written.join('\n'));
  console.log(`horizontal overflow at 360px: ${overflow}px${overflow > 0 ? '  ← FIX THIS' : ''}`);
})().catch(e => { console.error(e); process.exit(1); });
