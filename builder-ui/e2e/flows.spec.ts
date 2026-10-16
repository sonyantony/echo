import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
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

// Autosave: saves unsaved edits on its interval, and only when something changed.
test('autosaves changes and does not save again until something changes', async ({ page }) => {
  await page.route('**/api/editor/settings', (route) => route.fulfill({ json: { autosaveSeconds: 2 } }));
  const saves: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'PUT' && request.url().endsWith('.camel.yaml')) saves.push(request.url());
  });
  await login(page);
  await createFlow(page, uniqueName('autosave'));
  await page.waitForTimeout(3_000);
  expect(saves).toHaveLength(0); // nothing changed yet

  await addStep(page, 1, 'setBody');
  await expect(page.getByTestId('autosaved')).toBeVisible();
  await expect(page.getByTestId('unsaved')).toHaveCount(0);
  expect(saves).toHaveLength(1);
  await page.waitForTimeout(5_000);
  expect(saves).toHaveLength(1); // nothing changed since the autosave

  await page.reload();
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

// Download a flow as a zip, then upload it again as a new flow.
test('downloads a flow and uploads it again', async ({ page }, testInfo) => {
  await login(page);
  const name = uniqueName('zip');
  await createFlow(page, name);
  await addStep(page, 1, 'setBody');
  // Kaoto's own "documentation" download icon is hidden so it is not mistaken for ours.
  await expect(page.getByTestId('documentationPreviewButton')).toBeHidden();

  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download .zip' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe(`${name}.zip`);
  await expect(page.getByTestId('unsaved')).toHaveCount(0); // saved first
  const zip = testInfo.outputPath(`${name}.zip`);
  await download.saveAs(zip);

  await page.getByRole('link', { name: 'Flows' }).click();
  await page.getByRole('button', { name: 'Upload flow' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/Flow file/).setInputFiles(zip);
  await dialog.getByLabel('Name').fill(`${name}-copy`);
  await dialog.getByRole('button', { name: 'Upload' }).click();

  await expect(page.getByRole('heading', { name: `${name}-copy` })).toBeVisible();
  await expect(page.getByTestId('custom-node__route.from.steps.1.setBody')).toBeVisible();
});

// Download the diagram on the canvas as a PNG named after the flow.
test('downloads the flow diagram as a PNG', async ({ page }, testInfo) => {
  await login(page);
  const name = uniqueName('diagram');
  await createFlow(page, name);
  await addStep(page, 1, 'setBody');
  // Kaoto's own image button is hidden; the Builder's button presses it.
  await expect(page.getByTestId('exportImageButton')).toBeHidden();

  // Works from another Kaoto tab too: it switches back to the canvas.
  await page.getByRole('tab', { name: /DataMapper/ }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download diagram (.png)' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe(`${name}.png`);
  const file = testInfo.outputPath(`${name}.png`);
  await download.saveAs(file);

  const png = readFileSync(file);
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  // Trimmed to the diagram: far smaller than Kaoto's fixed 2x surface.
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  expect(width).toBeGreaterThan(100);
  expect(height).toBeLessThan(1000);
  await expect(page.getByTestId('unsaved')).toBeVisible(); // nothing was saved
});
