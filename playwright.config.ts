import { defineConfig } from '@playwright/test';
const port = Number(process.env.PORT || 4173);
export default defineConfig({
  testDir: './tests/browser',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  workers: 1,
  use: { baseURL: `http://127.0.0.1:${port}`, channel: 'chromium', headless: true, trace: 'retain-on-failure', launchOptions: { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } },
  webServer: { command: 'npm run demo', port, reuseExistingServer: !process.env.CI },
});
