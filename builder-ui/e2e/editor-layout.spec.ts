import { expect, test } from '@playwright/test';
import { createFlow, designMenu, login, uniqueName } from './helpers';

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
  await expect(page.getByRole('button', { name: 'Openapi', exact: true })).toBeHidden();
  const pdf = await page.pdf({ format: 'A4' });
  const pages = pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? [];
  expect(pages.length).toBeGreaterThan(1);
});

test("the editor's controls share the line with Kaoto's tabs", async ({ page }) => {
  await login(page);
  const flowName = uniqueName('tabline');
  await createFlow(page, flowName);
  const tabBar = page.locator('.echo-kaoto-host__editor > .shell > div[role="region"]');
  const top = async (name: string) => (await page.getByRole('button', { name, exact: true }).boundingBox())!.y;
  const tabBox = (await tabBar.boundingBox())!;
  for (const name of ['File', 'Run', 'Advanced', 'Openapi']) {
    const y = await top(name);
    expect(y).toBeGreaterThanOrEqual(tabBox.y);
    expect(y).toBeLessThan(tabBox.y + tabBox.height);
  }
  // File comes first, as in most desktop software, then Openapi (API-first flows start from the
  // spec), then Kaoto's Design tab.
  const file = (await page.getByRole('button', { name: 'File', exact: true }).boundingBox())!;
  const spec = (await page.getByRole('button', { name: 'Openapi', exact: true }).boundingBox())!;
  const design = (await page.getByRole('button', { name: 'Flow', exact: true }).boundingBox())!;
  expect(file.x + file.width).toBeLessThanOrEqual(spec.x);
  expect(spec.x + spec.width).toBeLessThanOrEqual(design.x);
  await page.getByRole('button', { name: 'File', exact: true }).click();
  for (const item of [/^Open Template/, /^Open Flow/, /^Upload Flow/, /^Save$/, /^Save As(?! Template)/, /^Save As Template/]) {
    await expect(page.getByRole('menuitem', { name: item })).toBeVisible();
  }
  await page.keyboard.press('Escape');

  // The right end of the line names the flow. History is in the Flow menu, so there is no More menu either.
  const nameTag = page.getByTestId('flow-name-tag');
  await expect(nameTag).toHaveText(`Flow: ${flowName}`);
  const tagBox = (await nameTag.boundingBox())!;
  expect(tagBox.y).toBeGreaterThanOrEqual(tabBox.y);
  expect(tagBox.y + tagBox.height).toBeLessThanOrEqual(tabBox.y + tabBox.height);
  await expect(page.getByRole('button', { name: 'History', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'More actions' })).toHaveCount(0);

  await page.setViewportSize({ width: 1100, height: 900 });
  // The tab line still fits on one line: no taller than at full width, every item on it.
  const narrowBox = (await tabBar.boundingBox())!;
  const narrowTag = (await nameTag.boundingBox())!;
  expect(narrowTag.x + narrowTag.width).toBeLessThanOrEqual(1100);
  expect(narrowBox.height).toBeLessThanOrEqual(tabBox.height + 1);
  for (const name of ['File', 'Openapi', 'Flow', 'Run', 'Advanced']) {
    const y = await top(name);
    expect(y).toBeGreaterThanOrEqual(narrowBox.y);
    expect(y).toBeLessThan(narrowBox.y + narrowBox.height);
  }
});

test('the tab underline moves to the menu clicked, and to Flow and Advanced while their view is open', async ({ page }) => {
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

  await under('Flow');
  // From About straight to Advanced > Java Beans: the underline leaves About for Advanced.
  await page.getByRole('tab', { name: /About/ }).click();
  await expect(page.getByRole('button', { name: 'Flow', exact: true })).not.toHaveClass(/echo-tab-menu--current/);
  await page.getByRole('button', { name: 'Advanced', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Java Beans/ }).click();
  await under('Advanced');
  await designMenu(page, /^Design/);
  await under('Flow');

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
  await designMenu(page, /^Design/);
  await expect(page.getByText('No flow is open')).toBeVisible();
});

test('Advanced > Java Beans opens the Beans view, before About; Flow takes the Design tab\'s place', async ({ page }) => {
  await login(page);
  await createFlow(page, uniqueName('advanced'));
  await expect(page.getByRole('tab', { name: /Design/ })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Flow', exact: true })).toHaveClass(/echo-tab-menu--current/);
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
  await expect(page.getByRole('button', { name: 'Flow', exact: true })).not.toHaveClass(/echo-tab-menu--current/);
  // Flow only opens its menu: Design, History and the downloads. Design opens the canvas.
  await page.getByRole('button', { name: 'Flow', exact: true }).click();
  await expect(page.getByRole('menuitem')).toHaveCount(4);
  await expect(page.getByRole('menuitem', { name: /^History/ })).toBeEnabled();
  await expect(page).toHaveURL(/#\/beans$/);
  await page.getByRole('menuitem', { name: /^Design/ }).click();
  await expect(page.getByTestId('custom-node__route.from')).toBeVisible();
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

test('the canvas route list reads Routes and has no search box', async ({ page }) => {
  await login(page);
  const name = uniqueName('routes');
  await createFlow(page, name);
  const label = page.getByTestId('flows-list-route-id');
  // Kaoto writes the route's name; ECHO shows "Routes" in its place.
  await expect(page.getByTestId('flows-list-dropdown')).toBeVisible();
  expect(await label.evaluate((el) => getComputedStyle(el, '::before').content)).toBe('"Routes"');
  expect(await label.evaluate((el) => getComputedStyle(el).fontSize)).toBe('0px');
  await page.getByTestId('flows-list-dropdown').click();
  const list = page.getByTestId('flows-list-table');
  await expect(list).toBeVisible();
  await expect(list.getByRole('textbox')).toBeHidden();
  await expect(list.getByTestId('toggle-btn-all-flows')).toBeVisible();
  await expect(list.getByRole('row')).toHaveCount(2);
  // "All routes" heads the list in the same size as the route names.
  const header = await list.locator('thead th').first().evaluate((el) => getComputedStyle(el, '::before').fontSize);
  const routeName = await list.locator('tbody td').first().evaluate((el) => getComputedStyle(el).fontSize);
  expect(header).toBe(routeName);
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

  // Download Flow, Download Flow As Image, Validate, the REST settings and Publish take the place of Kaoto's copy to
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
  // Client Request Validation over Enable CORS, between Validate and Publish.
  const validation = (await page.getByRole('checkbox', { name: 'Client Request Validation' }).boundingBox())!;
  const cors = (await page.getByRole('checkbox', { name: 'Enable CORS' }).boundingBox())!;
  expect(validation.x).toBeGreaterThanOrEqual(validateBox.x + validateBox.width);
  expect(Math.abs(cors.x - validation.x)).toBeLessThan(2);
  expect(cors.y).toBeGreaterThanOrEqual(validation.y + validation.height);
  expect(validation.y).toBeGreaterThanOrEqual(publishBox.y - 6);
  expect(cors.y + cors.height).toBeLessThanOrEqual(publishBox.y + publishBox.height + 6);
  const settingsRight = (await page.locator('.echo-rest-settings').boundingBox())!;
  expect(publishBox.x).toBeGreaterThanOrEqual(settingsRight.x + settingsRight.width);
  expect(Math.abs(validateBox.y + validateBox.height / 2 - (clipboard.y + clipboard.height / 2))).toBeLessThan(4);
  await validate.click();
  await expect(page.getByTestId('validation-result')).toBeVisible();

  // They come back with the canvas after another tab.
  await page.getByRole('tab', { name: /DataMapper/ }).click();
  await expect(validate).toBeHidden();
  await designMenu(page, /^Design/);
  await expect(validate).toBeVisible();
  await expect(publish).toBeVisible();
});
