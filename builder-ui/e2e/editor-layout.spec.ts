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

test("the editor's controls share the line with Kaoto's tabs", async ({ page }) => {
  await login(page);
  await createFlow(page, uniqueName('tabline'));
  const tabBar = page.locator('.echo-kaoto-host__editor > .shell > div[role="region"]');
  const top = async (name: string) => (await page.getByRole('button', { name, exact: true }).boundingBox())!.y;
  const tabBox = (await tabBar.boundingBox())!;
  for (const name of ['File', 'Validate', 'API spec', 'History', 'Publish']) {
    const y = await top(name);
    expect(y).toBeGreaterThanOrEqual(tabBox.y);
    expect(y).toBeLessThan(tabBox.y + tabBox.height);
  }
  // File comes first, before Kaoto's Design tab, as in most desktop software.
  const file = (await page.getByRole('button', { name: 'File', exact: true }).boundingBox())!;
  const design = (await page.getByRole('tab', { name: /Design/ }).boundingBox())!;
  expect(file.x + file.width).toBeLessThanOrEqual(design.x);
  await page.getByRole('button', { name: 'File', exact: true }).click();
  for (const item of [/^Open Template/, /^Open Flow/, /^Upload Flow/, /^Save$/, /^Save As(?! Template)/, /^Save As Template/, /Download \.zip/, /Download diagram/]) {
    await expect(page.getByRole('menuitem', { name: item })).toBeVisible();
  }
  await page.keyboard.press('Escape');

  // On a narrow screen History moves into the More menu.
  await page.setViewportSize({ width: 1100, height: 900 });
  await expect(page.getByRole('button', { name: 'History', exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'More actions' }).click();
  await expect(page.getByRole('menuitem', { name: 'History' })).toBeVisible();
  const publish = (await page.getByRole('button', { name: 'Publish', exact: true }).boundingBox())!;
  expect(publish.x + publish.width).toBeLessThanOrEqual(1100);
});

test('the About tab shows EY ECHO and its developer', async ({ page }) => {
  await login(page);
  await createFlow(page, uniqueName('about'));
  await page.getByRole('tab', { name: /About/ }).click();
  await expect(page.getByText('EY ECHO (V2.0).', { exact: true })).toBeVisible();
  await expect(page.getByText('Developed By : Sony Antony', { exact: true })).toBeVisible();
  await expect(page.getByAltText('Kaoto about page logo')).toHaveCount(0);
});
