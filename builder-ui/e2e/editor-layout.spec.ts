import { expect, test } from '@playwright/test';
import { createFlow, login, uniqueName } from './helpers';

test('editor fits the page and prints the whole open tab', async ({ page }) => {
  await login(page);
  await createFlow(page, uniqueName('layout'));
  await page.getByRole('tab', { name: /DataMapper/ }).click();
  const tab = page.locator('.shell__tab-content--scrollable');
  await expect(tab).toBeVisible();

  // The editor is no wider than the page, so its vertical scroll bar is on screen.
  const main = page.locator('.pf-v6-c-page__main');
  const overflow = await main.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const tabRight = await tab.evaluate((el) => el.getBoundingClientRect().right);
  expect(tabRight).toBeLessThanOrEqual(await page.evaluate(() => document.documentElement.clientWidth));

  // In print the tab is not clipped to the window: all of its content is laid out.
  await page.emulateMedia({ media: 'print' });
  const clipped = await tab.evaluate((el) => el.scrollHeight - el.clientHeight);
  expect(clipped).toBeLessThanOrEqual(1);
  await expect(page.getByRole('button', { name: 'Publish' })).toBeHidden();
  const pdf = await page.pdf({ format: 'A4' });
  const pages = pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? [];
  expect(pages.length).toBeGreaterThan(1);
});
