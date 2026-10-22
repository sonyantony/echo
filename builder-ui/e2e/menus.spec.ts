import { expect, test, type Page } from '@playwright/test';
import { createFlow, login, uniqueName } from './helpers';

// Tab-line menus close on any press outside them, including in the Apicurio frame (Openapi Design)
// and on the Kaoto canvas, and on Escape.

const menuItem = (page: Page, name: string | RegExp) => page.getByRole('menuitem', { name });
const tab = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

test('tab-line menus close on an outside press and on Escape', async ({ page }) => {
  await login(page);
  await createFlow(page, uniqueName('menus'));

  // Openapi Design: a press inside the Apicurio frame closes its menu.
  await tab(page, 'Openapi Design').click();
  await expect(menuItem(page, /^Upload/)).toBeVisible();
  // Away from where the menus hang, in Apicurio's right-hand pane.
  const frame = page.locator('iframe[title="OpenAPI editor"]');
  const inFrame = () => frame.click({ position: { x: 800, y: 400 } });
  await inFrame();
  await expect(menuItem(page, /^Upload/)).toBeHidden();

  // File, from the Openapi Design view: a press in the frame, then Escape after focus is in it.
  await tab(page, 'File').click();
  await expect(menuItem(page, /^New Flow/)).toBeVisible();
  await inFrame();
  await expect(menuItem(page, /^New Flow/)).toBeHidden();
  await tab(page, 'File').click();
  await expect(menuItem(page, /^New Flow/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menuItem(page, /^New Flow/)).toBeHidden();

  // Flow Design, Run and Advanced: a press on the Kaoto canvas closes each, and so does Escape.
  await tab(page, 'Flow Design').click();
  await expect(menuItem(page, /^Download .* As Image/)).toBeVisible();
  const canvas = page.locator('.pf-topology-visualization-surface').first();
  await canvas.click({ position: { x: 20, y: 300 } });
  await expect(menuItem(page, /^Download .* As Image/)).toBeHidden();

  for (const [name, item] of [
    ['Run', /^Run /],
    ['Advanced', /^Java Beans/],
  ] as const) {
    await tab(page, 'Flow Design').click();
    await page.keyboard.press('Escape');
    await tab(page, name).click();
    await expect(menuItem(page, item)).toBeVisible();
    await canvas.click({ position: { x: 20, y: 300 } });
    await expect(menuItem(page, item)).toBeHidden();
    await tab(page, name).click();
    await expect(menuItem(page, item)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menuItem(page, item)).toBeHidden();
  }

  // Opening one menu closes another.
  await tab(page, 'File').click();
  await expect(menuItem(page, /^New Flow/)).toBeVisible();
  await tab(page, 'Run').click();
  await expect(menuItem(page, /^Run /)).toBeVisible();
  await expect(menuItem(page, /^New Flow/)).toBeHidden();
});
