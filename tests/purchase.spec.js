/* End-to-end walk of the storefront in a real browser: build an "18" cake, add bomboloni, open the box, check out,
   submit → the page POSTs to /api/checkout. With a real Stripe test key in .env.local the response is a
   checkout.stripe.com URL; without one the page shows the server's readable error. Stripe's hosted page is never
   automated.   npm run test:e2e   (starts scripts/dev-server.js on port 3100 by itself) */
const { test, expect } = require('@playwright/test');

const hasStripe = /^sk_test_/.test(process.env.STRIPE_SECRET_KEY || '');

test.describe('Marble Box purchase path', () => {
  test('build a cake, fill the box, reach Stripe', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/');
    await expect(page.locator('#grid .card')).toHaveCount(8);

    // Hero builder → product dialog with "18" carried over
    await page.fill('#hero-chars', '18');
    await expect(page.locator('#hero-price')).toContainText('$160');
    await page.click('#hero-build');
    const dlg = page.locator('#pdp');
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('#opt-chars')).toHaveValue('18');
    await dlg.locator('.choice[data-opt="topping"][data-choice="gold"]').click();
    await dlg.locator('.choice[data-opt="cream"][data-choice="pistachio"]').click();
    await expect(dlg.locator('#pdp-price')).toHaveText('$180');
    await dlg.locator('#pdp-addbtn').click();
    await expect(page.locator('#bag')).toHaveClass(/open/);
    await expect(page.locator('#bag-count')).toHaveText('1');
    await page.click('#bag-close');

    // Bomboloni from the grid
    await page.locator('.card-add[data-open="bomboloni"]').click();
    await expect(dlg).toBeVisible();
    await dlg.locator('#pdp-addbtn').click();
    await expect(page.locator('#bag-count')).toHaveText('2');
    await expect(page.locator('#bag-subtotal')).toHaveText('$216');
    await expect(page.locator('#bag-lead')).toContainText("2 days' notice");

    // Checkout form
    await page.click('#bag-checkout');
    await expect(page.locator('#checkout')).toBeVisible();
    await expect(page.locator('#t-total')).toHaveText('$216');
    await page.fill('#co-name', 'Playwright Tester');
    await page.fill('#co-email', 'tester@example.com');
    await page.fill('#co-phone', '713 555 0101');
    const date = await page.inputValue('#co-date');
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const day = new Date(date + 'T12:00:00').getDay();
    expect([4, 5, 6, 0]).toContain(day);                       // Thu–Sun only
    await page.selectOption('#co-window', { index: 1 });

    // Delivery toggles the fee line; back to pickup
    await page.click('label:has(#co-delivery)');
    await expect(page.locator('#t-del-row')).toBeVisible();
    await expect(page.locator('#t-total')).toHaveText('$216');   // over $150 → free
    await page.click('label:has(#co-pickup)');

    const [request, response] = await Promise.all([
      page.waitForRequest(r => r.url().endsWith('/api/checkout') && r.method() === 'POST'),
      page.waitForResponse(r => r.url().endsWith('/api/checkout')),
      page.click('#co-pay')
    ]);
    const payload = request.postDataJSON();
    expect(payload.items).toHaveLength(2);
    expect(payload.items[0]).toEqual({ productId: 'number-cake', options: { chars: '18', topping: 'gold', cream: 'pistachio', topper: 'gold' }, qty: 1 });
    expect(payload.customer.email).toBe('tester@example.com');
    expect(payload.fulfillment.method).toBe('pickup');
    expect(payload.ref).toMatch(/^MB-\d{4}$/);
    expect(payload).not.toHaveProperty('total');                 // the browser never sends prices

    const body = await response.json();
    if (hasStripe) {
      expect(response.status()).toBe(200);
      expect(body.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
      await page.waitForURL(/checkout\.stripe\.com/);
    } else {
      expect(response.status()).toBe(500);
      expect(body.error).toMatch(/STRIPE_SECRET_KEY/);
      await expect(page.locator('#co-msg .notice')).toContainText('STRIPE_SECRET_KEY');
    }
    expect(errors).toEqual([]);
  });

  test('server refuses a tampered date even though the form looks fine', async ({ request }) => {
    const r = await request.post('/api/checkout', { data: { items: [{ productId: 'bomboloni', options: { size: 'six', mix: 'assorted' }, qty: 1 }], customer: { name: 'A', email: 'a@b.co', phone: '7135550100' }, fulfillment: { method: 'pickup', date: '2020-01-06', window: '10:00 – 12:00' } } });
    const j = await r.json();
    if (hasStripe) { expect(r.status()).toBe(400); expect(j.error).toMatch(/too soon/i); }
    else { expect(r.status()).toBe(500); }
  });

  test('no horizontal scroll at 400px, dialog and checkout usable', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 400, height: 800 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto('/');
    await expect(page.locator('#grid .card').first()).toBeVisible();
    const over = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(await over()).toBeLessThanOrEqual(0);
    await page.locator('.card-add[data-open="number-cake"]').click();
    await expect(page.locator('#pdp')).toBeVisible();
    await page.fill('#pdp #opt-chars', '7');
    await page.locator('#pdp-addbtn').click();
    await expect(page.locator('#bag')).toHaveClass(/open/);
    await page.click('#bag-checkout');
    await expect(page.locator('#checkout')).toBeVisible();
    expect(await over()).toBeLessThanOrEqual(0);
    await ctx.close();
  });

  test('admin page asks for a password and refuses a wrong one', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.locator('#login')).toBeVisible();
    await page.fill('#pw', 'definitely-wrong');
    await page.click('#login-btn');
    await expect(page.locator('#login-err')).toContainText(/password|ADMIN_PASSWORD/);
  });
});
