import { expect, type Page } from '@playwright/test';

export async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Username').fill('designer');
  await page.getByLabel('Password').fill('designer');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: 'Flows', exact: true })).toBeVisible();
}

export function uniqueName(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}`;
}

export async function createFlow(page: Page, name: string, description = '') {
  await page.getByRole('button', { name: 'New flow' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/Name/).fill(name);
  if (description) await dialog.getByLabel('Description').fill(description);
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/flows\/\d+$/);
  await expect(page.getByTestId('custom-node__route.from')).toBeVisible();
}

/** Adds a processor (e.g. "setBody") at the end of the route through Kaoto's catalog. */
export async function addStep(page: Page, placeholderIndex: number, processor: string) {
  await page.getByTestId(`placeholder-node__route.from.steps.${placeholderIndex}.placeholder`).click();
  const catalog = page.getByRole('dialog');
  await catalog.getByPlaceholder('Filter by name, description or tag').fill(processor);
  await catalog.getByTestId(`tile-${processor}`).click();
}
