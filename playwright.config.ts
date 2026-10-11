import { defineConfig, devices } from '@playwright/test';

// Tests run against the static web export (`npm run build:web` -> dist/),
// not the dev server, so results are deterministic. Chromium only: it is the
// only browser installed in the cloud container (see docs/TOOLCHAIN.md).
const PORT = 4173;

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'e2e/artifacts/test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'e2e/artifacts/report', open: 'never' }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'phone-390', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } },
    { name: 'phone-360', use: { ...devices['Desktop Chrome'], viewport: { width: 360, height: 640 }, hasTouch: true, isMobile: true } },
  ],
  webServer: {
    command: `npx serve -s dist -l ${PORT} --no-port-switching`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
