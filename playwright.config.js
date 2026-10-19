// @ts-check
const { defineConfig } = require('@playwright/test');
const fs = require('fs');

const PORT = Number(process.env.PW_PORT || 3100);   // PW_PORT lets several checkouts test side by side
// Use a Chromium that is already on the machine when there is one (CI images, Claude's sandbox); otherwise
// Playwright's own download (`npx playwright install chromium`).
const CHROME = process.env.PW_CHROMIUM_PATH || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(p => fs.existsSync(p));

module.exports = defineConfig({
  testDir: './tests',
  testMatch: /.*\.spec\.js/,
  timeout: 60_000,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure', ...(CHROME ? { launchOptions: { executablePath: CHROME } } : {}) },
  webServer: {
    command: `node scripts/dev-server.js`,
    port: PORT,
    env: { PORT: String(PORT) },
    reuseExistingServer: !process.env.CI,
    timeout: 15_000
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }]
});
