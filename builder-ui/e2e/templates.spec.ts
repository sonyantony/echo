import { expect, test, type Page } from '@playwright/test';
import { addStep, createFlow, fileMenu, login, uniqueName } from './helpers';

async function saveMenu(page: Page, item: 'Save As' | 'Save As Template') {
  await fileMenu(page, new RegExp(`^${item}(?! Template)`));
}

async function saveAs(page: Page, item: 'Save As' | 'Save As Template', name: string) {
  await saveMenu(page, item);
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByRole('button', { name: 'Save' }).click();
  return dialog;
}

// Save As: copies what is on screen to a new draft and opens it; asks before replacing a draft.
test('Save As copies the flow to a new name and asks before replacing one', async ({ page }) => {
  await login(page);
  const original = uniqueName('orig');
  await createFlow(page, original);
  const originalUrl = page.url();
  await addStep(page, 1, 'setBody'); // unsaved: Save As takes what is on screen

  const copy = uniqueName('copy');
  await saveAs(page, 'Save As', copy);
  await expect(page.getByTestId('flow-name-tag')).toHaveText(`Flow: ${copy}`);
  expect(page.url()).not.toBe(originalUrl);
  await expect(page.getByTestId('custom-node__route.from.steps.1.setBody')).toBeVisible();
  await expect(page.getByTestId('unsaved')).toHaveCount(0);

  // The original keeps its last saved version (without the step).
  await page.goto(originalUrl);
  await expect(page.getByTestId('custom-node__route.from')).toBeVisible();
  await expect(page.getByTestId('custom-node__route.from.steps.1.setBody')).toHaveCount(0);

  // Saving the original under the copy's name warns first; Cancel leaves the copy alone.
  const dialog = await saveAs(page, 'Save As', copy);
  await expect(dialog.getByTestId('overwrite-warning')).toContainText(`A flow named '${copy}' already exists`);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('flow-name-tag')).toHaveText(`Flow: ${original}`);

  const again = await saveAs(page, 'Save As', copy);
  await again.getByRole('button', { name: 'Replace' }).click();
  await expect(page.getByTestId('flow-name-tag')).toHaveText(`Flow: ${copy}`);
  await expect(page.getByTestId('custom-node__route.from')).toBeVisible();
  await expect(page.getByTestId('custom-node__route.from.steps.1.setBody')).toHaveCount(0); // replaced
});

// Save As Template writes templates/<name>/ in Git; Open Flow Template starts a new draft from it.
test('Save As Template and Open Flow Template', async ({ page }) => {
  await login(page);
  await createFlow(page, uniqueName('src'));
  await addStep(page, 1, 'setBody');

  const template = uniqueName('tpl');
  await saveAs(page, 'Save As Template', template);
  await expect(page.getByText(`Saved as template ${template}.`)).toBeVisible();

  // Saving a template with the same name asks before replacing it.
  const dialog = await saveAs(page, 'Save As Template', template);
  await expect(dialog.getByTestId('overwrite-warning')).toContainText(`A template named '${template}' already exists`);
  await dialog.getByRole('button', { name: 'Replace' }).click();
  await expect(page.getByText(`Saved as template ${template}.`)).toBeVisible();

  // Saving a template leaves the draft's own unsaved edits as they are.
  await expect(page.getByTestId('unsaved')).toBeVisible();
  await fileMenu(page, /^Save$/);
  await expect(page.getByTestId('unsaved')).toHaveCount(0);

  // Open Flow Template from the editor's File menu.
  await fileMenu(page, /^Open Flow Template/);
  const open = page.getByRole('dialog');
  await open.getByRole('combobox', { name: 'Template' }).selectOption(template);
  const flow = uniqueName('fromtpl');
  await open.getByLabel('New flow name').fill(flow);
  await open.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByTestId('flow-name-tag')).toHaveText(`Flow: ${flow}`);
  await expect(page.getByTestId('custom-node__route.from.steps.1.setBody')).toBeVisible();

  // Templates are not flows: the Flows page does not list them.
  await fileMenu(page, /^Open Flow(?! Template)/);
  await expect(page.getByRole('link', { name: flow })).toBeVisible();
  await expect(page.getByRole('cell', { name: template, exact: true })).toHaveCount(0);
});
