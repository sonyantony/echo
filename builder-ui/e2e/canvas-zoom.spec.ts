import { expect, test } from '@playwright/test';
import { createFlow, login, uniqueName } from './helpers';

// Kaoto sizes a route's box to its steps and its Fit to Screen stops at 100%, so a route looks
// small on a big canvas. ECHO adds Fit Route and Maximize to the canvas control bar (canvasZoom.ts).
test('Fit Route enlarges the route and Maximize gives the canvas the window', async ({ page }) => {
  await login(page);
  await createFlow(page, uniqueName('zoom'));
  const route = page.locator("g[data-id$='|route']").first();
  const width = () => route.evaluate((g) => g.getBoundingClientRect().width);
  const before = await width();

  // Nothing selected: the whole flow (one route) is fitted, past its 100% size (as far as the canvas height allows).
  await page.getByRole('button', { name: 'Fit Route' }).click();
  await expect.poll(width).toBeGreaterThan(before * 1.3);
  const canvas = (await page.locator('.pf-topology-visualization-surface').boundingBox())!;
  const box = (await route.boundingBox())!;
  expect(Math.abs(box.x + box.width / 2 - (canvas.x + canvas.width / 2))).toBeLessThan(5);

  // With a step selected, Fit Route fits that step's route, not the whole flow.
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Route/ }).first().click();
  await expect(page.getByRole('button', { name: /^Routes/ })).toContainText('2/2');
  await page.getByTestId('custom-node__route.from').nth(1).click();
  const second = page.locator("g[data-id$='|route']").nth(1);
  await page.getByRole('button', { name: 'Fit Route' }).click();
  const centred = async () => {
    const view = (await page.locator('.pf-topology-visualization-surface').boundingBox())!;
    const b = (await second.boundingBox())!;
    return Math.abs(b.y + b.height / 2 - (view.y + view.height / 2)) < 5 && Math.abs(b.x + b.width / 2 - (view.x + view.width / 2)) < 5;
  };
  await expect.poll(centred).toBe(true);

  // Maximize: the editor covers the window and Kaoto's tab line steps aside; Escape restores.
  const tabLine = page.getByRole('tab', { name: /DataMapper/ });
  await expect(tabLine).toBeVisible();
  await page.getByRole('button', { name: 'Maximize Canvas' }).click();
  const host = page.getByTestId('kaoto-editor-host');
  await expect.poll(async () => (await host.boundingBox())?.y).toBe(0);
  // Over the Builder's header too: the top of the window is the editor's.
  expect(await page.evaluate(() => !!document.elementFromPoint(700, 20)?.closest('[data-testid=kaoto-editor-host]'))).toBe(true);
  await expect(page.getByRole('button', { name: 'Validate' })).toBeVisible();
  await expect(tabLine).toBeHidden();
  await expect(page.getByRole('button', { name: 'Restore Canvas' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(tabLine).toBeVisible();
  await expect(page.getByRole('button', { name: 'Maximize Canvas' })).toBeVisible();
});
