import { expect, type Page } from '@playwright/test';

export async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Username').fill('designer');
  await page.getByLabel('Password').fill('designer');
  await page.getByRole('button', { name: 'Log in' }).click();
  // Logging in lands on a blank canvas with the File menu open.
  await expect(page.getByRole('heading', { name: 'Untitled flow' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /^New Flow/ })).toBeVisible();
}

export function uniqueName(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}`;
}

/**
 * Creates a flow and opens it, through File > New Flow (on the blank canvas or in the editor). From
 * the Open Flow page that means opening a flow first, unless there are none yet (then the page
 * offers New flow itself).
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
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/flows\/\d+$/);
  await expect(page.getByTestId('custom-node__route.from')).toBeVisible();
}

/** Picks an item from the flow editor's File menu (opening it first unless it is open already). */
export async function fileMenu(page: Page, item: string | RegExp) {
  const menuItem = page.getByRole('menuitem', { name: item });
  if (!(await menuItem.isVisible())) await page.getByRole('button', { name: 'File', exact: true }).click();
  await menuItem.click();
}

/** Picks an item from the Flow Design menu (which also opens the canvas). */
export async function designMenu(page: Page, item: string | RegExp) {
  await page.getByRole('button', { name: 'Flow Design', exact: true }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

/** Adds a processor (e.g. "setBody") at the end of the route through Kaoto's catalog. */
export async function addStep(page: Page, placeholderIndex: number, processor: string) {
  await page.getByTestId(`placeholder-node__route.from.steps.${placeholderIndex}.placeholder`).click();
  const catalog = page.getByRole('dialog');
  await catalog.getByPlaceholder('Filter by name, description or tag').fill(processor);
  await catalog.getByTestId(`tile-${processor}`).click();
}
