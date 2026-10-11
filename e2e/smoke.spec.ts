import { expect, test } from '@playwright/test';

// M0 smoke test: the exported web build loads, renders the home screen without
// console errors, imports the engine, and fits a phone-width viewport.
test('home screen renders cleanly at phone width', async ({ page }, testInfo) => {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console.error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));

  await page.goto('/');

  await expect(page.getByTestId('home-screen')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Frontline Duel' })).toBeVisible();
  await expect(page.getByTestId('rules-version')).toHaveText(/Comprehensive Rules v2\.10/);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, 'no horizontal scroll').toBeLessThanOrEqual(0);

  await page.screenshot({ path: `e2e/artifacts/screenshots/home-${testInfo.project.name}.png`, fullPage: true });
  expect(problems).toEqual([]);
});
