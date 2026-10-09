import { expect, test } from '@playwright/test';

test('panel follows system theme changes independently of the host page', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/demo.html');
  // A page's explicit theme must not override the user's preferred panel theme.
  await page.evaluate(() => document.documentElement.style.colorScheme = 'dark');
  await page.locator('#open-search').click();
  const panel = page.frameLocator('[data-semantic-find="panel"] iframe');
  const root = panel.locator('html');
  await expect(root).toHaveCSS('background-color', 'rgb(255, 250, 242)');
  await expect(root).toHaveCSS('color-scheme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.evaluate(() => document.documentElement.style.colorScheme = 'light');
  await expect(root).toHaveCSS('background-color', 'rgb(38, 33, 30)');
  await expect(root).toHaveCSS('color-scheme', 'dark');
  await expect(panel.locator('input')).toHaveCSS('color', 'rgb(243, 233, 221)');
  await expect(panel.locator('.search-field')).toHaveCSS('border-top-color', 'rgb(233, 173, 136)');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(root).toHaveCSS('background-color', 'rgb(255, 250, 242)');
  await expect(root).toHaveCSS('color-scheme', 'light');
});
