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
  await expect(page.getByRole('button', { name: 'API spec' })).toBeHidden();
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
  for (const name of ['File', 'Run', 'Advanced', 'API spec', 'History']) {
    const y = await top(name);
    expect(y).toBeGreaterThanOrEqual(tabBox.y);
    expect(y).toBeLessThan(tabBox.y + tabBox.height);
  }
  // File comes first, as in most desktop software, then API spec (API-first flows start from the
  // spec), then Kaoto's Design tab.
  const file = (await page.getByRole('button', { name: 'File', exact: true }).boundingBox())!;
  const spec = (await page.getByRole('button', { name: 'API spec', exact: true }).boundingBox())!;
  const design = (await page.getByRole('button', { name: 'Flow Design', exact: true }).boundingBox())!;
  expect(file.x + file.width).toBeLessThanOrEqual(spec.x);
  expect(spec.x + spec.width).toBeLessThanOrEqual(design.x);
  await page.getByRole('button', { name: 'File', exact: true }).click();
  for (const item of [/^Open Template/, /^Open Flow/, /^Upload Flow/, /^Save$/, /^Save As(?! Template)/, /^Save As Template/]) {
    await expect(page.getByRole('menuitem', { name: item })).toBeVisible();
  }
  await page.keyboard.press('Escape');

  // On a narrow screen History moves into the More menu.
  await page.setViewportSize({ width: 1100, height: 900 });
  await expect(page.getByRole('button', { name: 'History', exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'More actions' }).click();
  await expect(page.getByRole('menuitem', { name: 'History' })).toBeVisible();
  const more = (await page.getByRole('button', { name: 'More actions' }).boundingBox())!;
  expect(more.x + more.width).toBeLessThanOrEqual(1100);
  // The tab line still fits on one line: no taller than at full width, every item on it.
  const narrowBox = (await tabBar.boundingBox())!;
  expect(narrowBox.height).toBeLessThanOrEqual(tabBox.height + 1);
  for (const name of ['File', 'API spec', 'Flow Design', 'Run', 'Advanced']) {
    const y = await top(name);
    expect(y).toBeGreaterThanOrEqual(narrowBox.y);
    expect(y).toBeLessThan(narrowBox.y + narrowBox.height);
  }
});

test('the tab underline moves to the menu clicked, and to Flow Design and Advanced while their view is open', async ({ page }) => {
  await login(page);
  await createFlow(page, uniqueName('underline'));
  const list = page.locator('.echo-kaoto-host__editor > .shell > div[role="region"] > .pf-v6-c-tabs__list');
  // Where the underline is drawn (PatternFly's accent), relative to the left of the tab list.
  const underline = () =>
    list.evaluate((el) => {
      const accent = getComputedStyle(el, '::after');
      return { start: parseFloat(accent.translate), length: parseFloat(accent.width) };
    });
  const under = async (name: string) => {
    const listBox = (await list.boundingBox())!;
    const box = (await page.getByRole('button', { name, exact: true }).boundingBox())!;
    await expect.poll(async () => Math.round((await underline()).start)).toBe(Math.round(box.x - listBox.x));
    await expect.poll(async () => Math.round((await underline()).length)).toBe(Math.round(box.width));
  };

  await under('Flow Design');
  // From About straight to Advanced > Java Beans: the underline leaves About for Advanced.
  await page.getByRole('tab', { name: /About/ }).click();
  await expect(page.getByRole('button', { name: 'Flow Design', exact: true })).not.toHaveClass(/echo-tab-menu--current/);
  await page.getByRole('button', { name: 'Advanced', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Java Beans/ }).click();
  await under('Advanced');
  await page.getByRole('button', { name: 'Flow Design', exact: true }).click();
  await page.keyboard.press('Escape');
  await under('Flow Design');

  // Clicking File, Run or Advanced moves it there, and it stays after Escape closes the menu.
  for (const menu of ['File', 'Run', 'Advanced']) {
    await page.getByRole('button', { name: menu, exact: true }).click();
    await under(menu);
    await page.keyboard.press('Escape');
    await under(menu);
  }
  // A Kaoto tab takes it back.
  await page.getByRole('tab', { name: /About/ }).click();
  await expect.poll(() => list.evaluate((el) => el.style.getPropertyValue('--pf-v6-c-tabs--link-accent--length'))).toBe('');
  await expect(page.getByRole('button', { name: 'Advanced', exact: true })).not.toHaveClass(/echo-tab-menu--underlined/);
});

test('the About tab shows EY ECHO and its developer', async ({ page }) => {
  await login(page);
  await createFlow(page, uniqueName('about'));
  await page.getByRole('tab', { name: /About/ }).click();
  await expect(page.getByText('EY ECHO (V2.0).', { exact: true })).toBeVisible();
  await expect(page.getByText('Developed By : Sony Antony', { exact: true })).toBeVisible();
  await expect(page.getByAltText('Kaoto about page logo')).toHaveCount(0);
});

test('About opens on the blank canvas after login', async ({ page }) => {
  await login(page);
  await expect(page.getByRole('menuitem', { name: /New Flow/ })).toBeVisible();
  await page.getByRole('tab', { name: /About/ }).click();
  await expect(page.getByText('EY ECHO (V2.0).', { exact: true })).toBeVisible();
  await expect(page.getByText('No flow is open')).toBeHidden();
  await page.getByRole('button', { name: 'Flow Design', exact: true }).click();
  await expect(page.getByText('No flow is open')).toBeVisible();
});

test('Advanced > Java Beans opens the Beans view, before About; Flow Design takes the Design tab\'s place', async ({ page }) => {
  await login(page);
  await createFlow(page, uniqueName('advanced'));
  await expect(page.getByRole('tab', { name: /Design/ })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Flow Design', exact: true })).toHaveClass(/echo-tab-menu--current/);
  await expect(page.getByRole('tab', { name: /Beans/ })).toBeHidden();
  const advanced = page.getByRole('button', { name: 'Advanced', exact: true });
  const advancedBox = (await advanced.boundingBox())!;
  const about = (await page.getByRole('tab', { name: /About/ }).boundingBox())!;
  const dataMapper = (await page.getByRole('tab', { name: /DataMapper/ }).boundingBox())!;
  expect(advancedBox.x).toBeGreaterThanOrEqual(dataMapper.x + dataMapper.width);
  expect(advancedBox.x + advancedBox.width).toBeLessThanOrEqual(about.x);
  await advanced.click();
  await page.getByRole('menuitem', { name: /^Java Beans/ }).click();
  await expect(page).toHaveURL(/#\/beans$/);
  await expect(page.locator('.shell__tab-content--scrollable')).toBeVisible();
  await expect(advanced).toHaveClass(/echo-tab-menu--current/);
  await expect(page.getByRole('button', { name: 'Flow Design', exact: true })).not.toHaveClass(/echo-tab-menu--current/);
  // Flow Design opens the canvas and its menu of downloads.
  await page.getByRole('button', { name: 'Flow Design', exact: true }).click();
  await expect(page.getByTestId('custom-node__route.from')).toBeVisible();
  await expect(page.getByRole('menuitem')).toHaveCount(2);
  await expect(advanced).not.toHaveClass(/echo-tab-menu--current/);
});

test('the canvas New menu shows Route without its long description', async ({ page }) => {
  await login(page);
  await createFlow(page, uniqueName('newmenu'));
  await page.getByTestId('new-entity-list-dropdown').click();
  const route = page.getByTestId('new-entity-route');
  await expect(route).toBeVisible();
  await expect(route.locator('.pf-v6-c-menu__item-description')).toBeHidden();
  await expect(page.getByTestId('new-entity-list').getByText('Configuration')).toBeVisible();
  await expect(page.getByTestId('new-entity-list').getByText('Error Handling')).toBeVisible();
});

test('the Run menu, just before Advanced, holds Run <flow>; downloads, Validate and Publish replace copy to clipboard', async ({ page }) => {
  await login(page);
  const name = uniqueName('runmenu');
  await createFlow(page, name);
  const run = page.getByRole('button', { name: 'Run', exact: true });
  const runBox = (await run.boundingBox())!;
  const advanced = (await page.getByRole('button', { name: 'Advanced', exact: true }).boundingBox())!;
  const dataMapper = (await page.getByRole('tab', { name: /DataMapper/ }).boundingBox())!;
  expect(runBox.x).toBeGreaterThanOrEqual(dataMapper.x + dataMapper.width);
  expect(runBox.x + runBox.width).toBeLessThanOrEqual(advanced.x);
  await run.click();
  await expect(page.getByRole('menuitem', { name: new RegExp(`^Run ${name}`) })).toBeVisible();
  await expect(page.getByRole('menuitem')).toHaveCount(1);
  await page.keyboard.press('Escape');

  // Download Flow, Download Flow As Image, Validate and Publish take the place of Kaoto's copy to
  // clipboard, after undo and redo.
  await expect(page.getByTestId('clipboardButton')).toBeHidden();
  const redo = (await page.getByRole('button', { name: 'Redo' }).boundingBox())!;
  const zip = (await page.getByRole('button', { name: 'Download Flow', exact: true }).boundingBox())!;
  const image = (await page.getByRole('button', { name: 'Download Flow As Image', exact: true }).boundingBox())!;
  expect(zip.x).toBeGreaterThanOrEqual(redo.x + redo.width);
  expect(image.x).toBeGreaterThanOrEqual(zip.x + zip.width);
  const clipboard = image;
  const validate = page.getByRole('button', { name: 'Validate', exact: true });
  const publish = page.getByRole('button', { name: 'Publish', exact: true });
  const validateBox = (await validate.boundingBox())!;
  const publishBox = (await publish.boundingBox())!;
  expect(validateBox.x).toBeGreaterThanOrEqual(clipboard.x + clipboard.width);
  expect(publishBox.x).toBeGreaterThanOrEqual(validateBox.x + validateBox.width);
  expect(Math.abs(validateBox.y + validateBox.height / 2 - (clipboard.y + clipboard.height / 2))).toBeLessThan(4);
  await validate.click();
  await expect(page.getByTestId('validation-result')).toBeVisible();

  // They come back with the canvas after another tab.
  await page.getByRole('tab', { name: /Rest/ }).click();
  await expect(validate).toBeHidden();
  await page.getByRole('button', { name: 'Flow Design', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(validate).toBeVisible();
  await expect(publish).toBeVisible();
});
