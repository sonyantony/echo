import { expect, test } from '@playwright/test';
import { addStep, createFlow, login, uniqueName } from './helpers';

// M4: create, list, rename and delete flow drafts.
test('creates, renames and deletes a flow', async ({ page }) => {
  await login(page);
  const name = uniqueName('crud');
  await createFlow(page, name, 'CRUD test');

  await page.getByRole('link', { name: 'Flows' }).click();
  const row = page.getByRole('row').filter({ hasText: name });
  await expect(row).toContainText('CRUD test');
  await expect(row).toContainText('Draft');

  const renamed = `${name}-renamed`;
  await row.getByRole('button', { name: 'Kebab toggle' }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  await page.getByRole('dialog').getByLabel(/Name/).fill(renamed);
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  const renamedRow = page.getByRole('row').filter({ hasText: renamed });
  await expect(renamedRow).toBeVisible();

  await renamedRow.getByRole('button', { name: 'Kebab toggle' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('link', { name: renamed })).toHaveCount(0);
});

// M5: edit on the Kaoto canvas, save, reload and see the change.
test('adds a step on the canvas and keeps it after saving', async ({ page }) => {
  await login(page);
  await createFlow(page, uniqueName('canvas'));

  await addStep(page, 1, 'setBody');
  await expect(page.getByTestId('custom-node__route.from.steps.1.setBody')).toBeVisible();
  await expect(page.getByTestId('unsaved')).toBeVisible();

  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await expect(page.getByTestId('unsaved')).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId('custom-node__route.from.steps.1.setBody')).toBeVisible();
});

test('warns before leaving with unsaved changes', async ({ page }) => {
  await login(page);
  await createFlow(page, uniqueName('unsaved'));
  await addStep(page, 1, 'setBody');
  await expect(page.getByTestId('unsaved')).toBeVisible();

  await page.getByRole('link', { name: 'Flows' }).click();
  await expect(page.getByText('Leave without saving?')).toBeVisible();
  await page.getByRole('button', { name: 'Stay' }).click();
  await expect(page.getByTestId('custom-node__route.from.steps.1.setBody')).toBeVisible();
});

// M6: validation runs from the editor and saves unsaved edits first.
test('validates a flow from the editor', async ({ page }) => {
  await login(page);
  await createFlow(page, uniqueName('valid'));
  await addStep(page, 1, 'setBody');

  await page.getByRole('button', { name: 'Validate' }).click();
  await expect(page.getByTestId('validation-result')).toContainText('The flow is valid.');
  await expect(page.getByTestId('unsaved')).toHaveCount(0);
});
