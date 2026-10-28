import { expect, test } from '@playwright/test';
import { createFlow, interfaceItem, interfaceMenu, login, uniqueName } from './helpers';

// Paths in the Interface's right pane have a Delete button on each entry too. It deletes as the
// path's right-click Delete Path does, so the routes of its operations go as for any deleted
// operation: ones ECHO made and nobody changed quietly, worked-on ones after asking.

const shots = process.env.ECHO_E2E_SCREENSHOTS;

const spec = [
  'openapi: 3.0.3',
  'info: { title: Cards, version: 1.0.0 }',
  `servers: [{ url: /${uniqueName('cards')} }]`,
  'paths:',
  '  /cards:',
  '    get:',
  "      responses: { '200': { description: ok } }",
  '  /cards/{id}:',
  '    delete:',
  '      parameters: [{ name: id, in: path, required: true, schema: { type: string } }]',
  "      responses: { '204': { description: gone } }",
  '',
].join('\n');

test('a path is deleted from the Paths list, and its operations take their untouched routes with them', async ({ page }) => {
  await login(page);
  await createFlow(page, uniqueName('delete-path'), '', { route: false });
  const chooser = page.waitForEvent('filechooser');
  await interfaceMenu(page, /^Upload/);
  await (await chooser).setFiles({ name: 'cards-api.yaml', mimeType: 'application/yaml', buffer: Buffer.from(spec) });
  await expect(page.getByText('Added a route for GET /cards, DELETE /cards/{id}.')).toBeVisible();
  const routes = page.getByTestId('custom-node__route.from');
  await expect(routes).toHaveCount(2);

  const editor = page.frameLocator('iframe[title="OpenAPI editor"]');
  const paths = editor.locator('.path-section .api-path');
  await interfaceItem(page, 'Paths');
  await expect(paths).toHaveText(['/cards', '/cards/{id}']);
  await expect(editor.getByRole('button', { name: 'Delete /cards/{id}' })).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/1-paths.png` });

  // Delete takes the path away and leaves the list showing: nothing was opened.
  await editor.getByRole('button', { name: 'Delete /cards/{id}' }).click();
  await expect(paths).toHaveText(['/cards']);
  await expect(editor.locator('.path-section')).toBeVisible();
  await expect(editor.locator('path-form')).toBeHidden();
  await expect(editor.locator('#path-context-menu')).toHaveCount(0);
  await expect(editor.locator('.echo-nav-item', { hasText: 'Paths' })).toHaveText('Paths(1)');
  // Its route was as ECHO made it, so it went without asking.
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(routes).toHaveCount(1);
  if (shots) await page.screenshot({ path: `${shots}/2-path-deleted.png` });

  // It is Apicurio's own delete, so undo brings the path back, and its route with it.
  await editor.getByTitle('Click to undo the last change.').click();
  await interfaceItem(page, 'Paths');
  await expect(paths).toHaveText(['/cards', '/cards/{id}']);
  await expect(routes).toHaveCount(2);
});
