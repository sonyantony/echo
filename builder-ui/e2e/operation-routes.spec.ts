import { expect, test, type Page } from '@playwright/test';
import { createFlow, designMenu, fileMenu, login, uniqueName } from './helpers';

// operationIds are ECHO's business (decision 0013): every operation is named after its method and
// path, Openapi hides the field, Flow > Add Route For Operation makes the routes, renaming a path
// renames its route too, and Publish asks before publishing operations that have no route.

const shots = process.env.ECHO_E2E_SCREENSHOTS;
const editorOf = (page: Page) => page.frameLocator('iframe[title="OpenAPI editor"]');
const flowIdOf = (page: Page) => page.url().replace(/.*\/flows\/(\d+).*/, '$1');

const spec = (cardsPath: string, cardsId?: string) =>
  [
    'openapi: 3.0.3',
    'info:',
    '  title: Cards',
    '  version: 1.0.0',
    'servers:',
    `  - url: /${uniqueName('cards')}`,
    'paths:',
    `  ${cardsPath}:`,
    '    get:',
    ...(cardsId ? [`      operationId: ${cardsId}`] : []),
    '      summary: All cards',
    "      responses: { '200': { description: ok } }",
    '  /cards/{id}:',
    '    delete:',
    '      parameters: [{ name: id, in: path, required: true, schema: { type: string } }]',
    "      responses: { '204': { description: gone } }",
    '',
  ].join('\n');

async function upload(page: Page, text: string) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Openapi', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Upload/ }).click();
  await (await chooser).setFiles({ name: 'cards-api.yaml', mimeType: 'application/yaml', buffer: Buffer.from(text) });
}

test('operations get routes without anyone typing an operationId, renames follow, Publish warns about the rest', async ({ page }) => {
  await login(page);
  const name = uniqueName('opids');
  await createFlow(page, name);
  const flowId = flowIdOf(page);
  const routeFile = `/api/flows/${flowId}/files/${name}.camel.yaml`;

  // An uploaded spec without operationIds is stored with its natural ones.
  await upload(page, spec('/cards'));
  const editor = editorOf(page);
  await expect(editor.getByText('/cards/{id}')).toBeVisible();
  await expect.poll(async () => (await page.request.get(`/api/flows/${flowId}/files/cards-api.yaml`)).text())
    .toMatch(/operationId: getCards[^]*operationId: deleteCardsId/);

  // Openapi does not show the field.
  await editor.getByText('/cards', { exact: true }).first().click();
  await expect(editor.getByText('All cards').first()).toBeVisible();
  await expect(editor.getByText('Summary', { exact: true }).first()).toBeVisible();
  await expect(editor.getByText('Operation ID', { exact: true })).toBeHidden();
  if (shots) await page.screenshot({ path: `${shots}/1-no-operation-id.png` });

  // Flow > Add Route For Operation lists the operations by method and path.
  await designMenu(page, 'Add Route For Operation');
  const dialog = page.getByRole('dialog', { name: 'Add Route For Operation' });
  await expect(dialog.getByText('DELETE /cards/{id}')).toBeVisible();
  await dialog.getByRole('checkbox', { name: 'GET /cards', exact: true }).check();
  if (shots) await page.screenshot({ path: `${shots}/2-add-route-for-operation.png` });
  await dialog.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText('Added a route for GET /cards. Design it on the canvas.')).toBeVisible();
  await expect(page.locator('iframe[title="OpenAPI editor"]')).toBeHidden();
  if (shots) await page.screenshot({ path: `${shots}/3-route-added.png` });
  await fileMenu(page, /^Save(?! As)/);
  await expect(page.getByText('Saved.')).toBeVisible();
  let route = await (await page.request.get(routeFile)).text();
  expect(route).toContain('description: GET /cards');
  expect(route).toMatch(/uri: direct\n\s+parameters:\n\s+name: getCards/);

  // It has a route now.
  await designMenu(page, 'Add Route For Operation');
  await expect(dialog.getByRole('checkbox', { name: 'GET /cards Has a route', exact: true })).toBeDisabled();
  await expect(dialog.getByText('Has a route')).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  // A new version of the spec moves GET /cards to /payment-cards (the operation keeps its old id
  // there, as when a path is renamed in the editor): the operation and its route are renamed together.
  await page.getByRole('button', { name: 'Openapi', exact: true }).click();
  await page.keyboard.press('Escape');
  await upload(page, spec('/payment-cards', 'getCards'));
  await page.getByRole('dialog').getByRole('button', { name: 'Replace' }).click();
  await expect(editor.getByText('/payment-cards')).toBeVisible();
  await expect.poll(async () => (await page.request.get(routeFile)).text()).toMatch(/name: getPaymentCards/);
  route = await (await page.request.get(routeFile)).text();
  expect(route).toContain('description: GET /payment-cards');
  expect(route).toContain('id: route-getPaymentCards');
  expect(await (await page.request.get(`/api/flows/${flowId}/files/cards-api.yaml`)).text()).toContain('operationId: getPaymentCards');

  // DELETE /cards/{id} still has no route: Publish lists it and asks.
  await designMenu(page, /^Design/);
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  const publish = page.getByRole('dialog');
  await publish.getByRole('button', { name: 'Publish' }).click();
  await expect(publish.getByText('These operations have no route')).toBeVisible();
  await expect(publish.getByRole('listitem')).toHaveText(['DELETE /cards/{id}']);
  if (shots) await page.screenshot({ path: `${shots}/4-publish-warning.png` });
  await publish.getByRole('button', { name: 'Publish Anyway' }).click();
  await expect(page.getByText('Published Successfully')).toBeVisible();
});
