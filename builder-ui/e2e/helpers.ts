import { expect, type Page } from '@playwright/test';

export async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Username').fill('designer');
  await page.getByLabel('Password').fill('designer');
  await page.getByRole('button', { name: 'Log in' }).click();
  // Logging in lands on the start page: work starts on a new flow or one that exists.
  await expect(page.getByRole('heading', { name: 'Start with a flow' })).toBeVisible();
}

export function uniqueName(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}`;
}

/**
 * Creates a flow and opens it, through New Flow on the start page (or the Open Flow page with no
 * flows yet) or File > New Flow in the editor. From the Open Flow page with flows that means
 * opening a flow first.
 */
export async function createFlow(page: Page, name: string, description = '') {
  const fileButton = page.getByRole('button', { name: 'File', exact: true });
  const newButton = page.getByRole('button', { name: 'New flow' });
  const firstFlow = page.getByRole('row').getByRole('link').first();
  await expect(fileButton.or(newButton).or(firstFlow).first()).toBeVisible();
  if (await newButton.isVisible()) {
    await newButton.click();
  } else {
    if (!(await fileButton.isVisible())) await firstFlow.click();
    await fileMenu(page, /^New Flow/);
  }
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/Name/).fill(name);
  if (description) await dialog.getByLabel('Description').fill(description);
  const before = page.url();
  await dialog.getByRole('button', { name: 'Create' }).click();
  // From another flow's editor the address already looks like a flow's: wait for the new one.
  await expect(page).toHaveURL((url) => /\/flows\/\d+$/.test(url.pathname) && url.href !== before);
  await expect(page.getByTestId('custom-node__route.from')).toBeVisible();
}

/** Picks an item from the flow editor's File menu (opening it first unless it is open already). */
export async function fileMenu(page: Page, item: string | RegExp) {
  const menuItem = page.getByRole('menuitem', { name: item });
  if (!(await menuItem.isVisible())) await page.getByRole('button', { name: 'File', exact: true }).click();
  await menuItem.click();
}

/** Picks an item from the Flow menu (Design opens the canvas). */
export async function designMenu(page: Page, item: string | RegExp) {
  await page.getByRole('button', { name: 'Flow', exact: true }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

/** Picks an item from the Interface menu (Design opens the flow's OpenAPI spec). */
export async function interfaceMenu(page: Page, item: string | RegExp) {
  await page.getByRole('button', { name: 'Interface', exact: true }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

/** Clicks an item of the Interface's list on the left (Info, Paths, Data Types...), which shows it on the right. */
export async function interfaceItem(page: Page, item: 'Info' | 'Tag Definitions' | 'Paths' | 'Data Types' | 'Responses' | 'Source') {
  await page.frameLocator('iframe[title="OpenAPI editor"]').locator('.echo-nav-item', { hasText: item }).click();
}

/** Adds a processor (e.g. "setBody") at the end of the route through Kaoto's catalog. */
export async function addStep(page: Page, placeholderIndex: number, processor: string) {
  await page.getByTestId(`placeholder-node__route.from.steps.${placeholderIndex}.placeholder`).click();
  const catalog = page.getByRole('dialog');
  await catalog.getByPlaceholder('Filter by name, description or tag').fill(processor);
  await catalog.getByTestId(`tile-${processor}`).click();
}
