import { expect, test, type Page } from '@playwright/test';
import YAML from 'yaml';
import { createFlow, designMenu, fileMenu, interfaceItem, interfaceMenu, login, uniqueName } from './helpers';

// operationIds are ECHO's business (decision 0013): every operation is named after its method and
// path unless the spec has its own, Openapi hides the field, an uploaded spec gets a route per
// operation, Flow > Add Route For Operation makes the rest, renaming a path renames its route too,
// and Publish asks before publishing operations that have no route.

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
  await interfaceMenu(page, /^Upload/);
  await (await chooser).setFiles({ name: 'cards-api.yaml', mimeType: 'application/yaml', buffer: Buffer.from(text) });
}

test('an uploaded spec gets a route per operation under its own ids; Add Route For Operation and the Publish warning cover the rest', async ({ page }) => {
  await login(page);
  const name = uniqueName('opids');
  await createFlow(page, name);
  const flowId = flowIdOf(page);
  const routeFile = `/api/flows/${flowId}/files/${name}.camel.yaml`;

  // An uploaded spec keeps the operationIds it has; only the operation without one gets ECHO's.
  await upload(page, spec('/cards', 'listCards'));
  await expect(page.getByText('Saved cards-api.yaml.')).toBeVisible();
  const editor = editorOf(page);
  await interfaceItem(page, 'Paths');
  await expect(editor.getByText('/cards/{id}')).toBeVisible();
  await expect.poll(async () => (await page.request.get(`/api/flows/${flowId}/files/cards-api.yaml`)).text())
    .toMatch(/operationId: listCards[^]*operationId: deleteCardsId/);
  // Each operation got a route on the canvas at once.
  await expect(page.getByText('Added a route for GET /cards, DELETE /cards/{id}.')).toBeVisible();

  // Openapi does not show the field.
  await editor.getByText('/cards', { exact: true }).first().click();
  await expect(editor.getByText('All cards').first()).toBeVisible();
  await expect(editor.getByText('Summary', { exact: true }).first()).toBeVisible();
  await expect(editor.getByText('Operation ID', { exact: true })).toBeHidden();
  if (shots) await page.screenshot({ path: `${shots}/1-no-operation-id.png` });

  await fileMenu(page, /^Save(?! As)/);
  await expect(page.getByText('Saved.')).toBeVisible();
  let route = await (await page.request.get(routeFile)).text();
  expect(route).toContain('description: GET /cards');
  expect(route).toMatch(/uri: direct\n\s+parameters:\n\s+name: listCards/);
  expect(route).toMatch(/uri: direct\n\s+parameters:\n\s+name: deleteCardsId/);

  // A new version of the spec moves GET /cards to /payment-cards under the same id: its route stays.
  await interfaceMenu(page, /^Design/);
  await upload(page, spec('/payment-cards', 'listCards'));
  await page.getByRole('dialog').getByRole('button', { name: 'Replace' }).click();
  await interfaceItem(page, 'Paths');
  await expect(editor.getByText('/payment-cards')).toBeVisible();
  await expect.poll(async () => (await page.request.get(`/api/flows/${flowId}/files/cards-api.yaml`)).text()).toContain('/payment-cards');
  await fileMenu(page, /^Save(?! As)/);
  route = await (await page.request.get(routeFile)).text();
  expect(route).toMatch(/name: listCards/);
  expect(route).toContain('description: GET /payment-cards');
  expect(route.match(/uri: direct\n/g)).toHaveLength(2);

  // A route taken out (here outside the editor): Publish lists its operation and asks.
  const xsrf = (await page.context().cookies()).find((c) => c.name === 'XSRF-TOKEN')!.value;
  const withoutDelete = YAML.stringify((YAML.parse(route) as { route?: { id?: string } }[]).filter((e) => e.route?.id !== 'route-deleteCardsId'));
  expect(withoutDelete).not.toContain('deleteCardsId');
  await page.request.put(routeFile, { data: withoutDelete, headers: { 'Content-Type': 'text/plain', 'X-XSRF-TOKEN': xsrf } });
  await page.reload();
  await designMenu(page, /^Design/);
  await expect(page.getByTestId('custom-node__route.from').first()).toBeVisible();
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  const publish = page.getByRole('dialog');
  await publish.getByRole('button', { name: 'Publish' }).click();
  await expect(publish.getByText('These operations have no route')).toBeVisible();
  await expect(publish.getByRole('listitem')).toHaveText(['DELETE /cards/{id}']);
  if (shots) await page.screenshot({ path: `${shots}/4-publish-warning.png` });
  await publish.getByRole('button', { name: 'Cancel' }).click();

  // Flow > Add Route For Operation lists the operations by method and path and adds the route.
  await designMenu(page, 'Add Route For Operation');
  const dialog = page.getByRole('dialog', { name: 'Add Route For Operation' });
  await expect(dialog.getByRole('checkbox', { name: 'GET /payment-cards Has a route', exact: true })).toBeDisabled();
  await dialog.getByRole('checkbox', { name: 'DELETE /cards/{id}', exact: true }).check();
  if (shots) await page.screenshot({ path: `${shots}/2-add-route-for-operation.png` });
  await dialog.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText('Added a route for DELETE /cards/{id}. Design it on the canvas.')).toBeVisible();
  await fileMenu(page, /^Save(?! As)/);
  await expect(page.getByText('Saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await publish.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published Successfully')).toBeVisible();
});

test('an operation added in Openapi gets its operationId at once, before any Save', async ({ page }) => {
  // Apicurio reports its own errors on the console ("ERROR TypeError: ..."); filling a field must cause none.
  const editorErrors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && m.text().startsWith('ERROR')) editorErrors.push(m.text());
  });
  await login(page);
  await createFlow(page, uniqueName('opnow'));
  await interfaceMenu(page, /^Design/);
  const editor = editorOf(page);
  await interfaceItem(page, 'Paths');
  await editor.getByText('Add a path').click();
  const addPath = editor.getByRole('dialog', { name: 'Add Path' });
  await addPath.getByRole('textbox').fill('/something/haha/Hihi');
  await addPath.getByRole('button', { name: 'Add' }).click();
  await editor.getByText('Put', { exact: true }).first().click();
  await editor.getByRole('button', { name: 'Add Operation' }).click();

  // Source shows the id straight away; nothing is saved yet.
  await expect(page.getByTestId('unsaved')).toBeVisible();
  await expect(editor.locator('pf-inline-text-editor[nodepath="operationId"]')).toContainText('putSomethingHahaHihi');
  await expect(editor.getByText('Operation ID', { exact: true })).toBeHidden();
  await editor.locator('.editor-detail').getByText('Source', { exact: true }).first().click();
  await expect(editor.locator('.ace_editor').first()).toContainText('operationId: putSomethingHahaHihi');
  // A second operation on the same path gets its own.
  await editor.locator('.editor-detail').getByText('Design', { exact: true }).first().click();
  await editor.getByText('Get', { exact: true }).first().click();
  await editor.getByRole('button', { name: 'Add Operation' }).click();
  // (Source shows the spec as it was when opened, so wait for the hidden field first.)
  await expect(editor.locator('pf-inline-text-editor[nodepath="operationId"]')).toContainText('getSomethingHahaHihi');
  await editor.locator('.editor-detail').getByText('Source', { exact: true }).first().click();
  await expect(editor.locator('.ace_editor').first()).toContainText('operationId: getSomethingHahaHihi');
  // And an operation on a second path (added with the + next to Paths) gets one too.
  await editor.locator('.editor-detail').getByText('Design', { exact: true }).first().click();
  await interfaceItem(page, 'Paths');
  await editor.locator('button:has(.pficon-add-circle-o)').first().click();
  await addPath.getByRole('textbox').fill('/hhjhjhjhkk/ttttt');
  await addPath.getByRole('button', { name: 'Add' }).click();
  await editor.getByText('Get', { exact: true }).first().click();
  await editor.getByRole('button', { name: 'Add Operation' }).click();
  await expect(editor.locator('pf-inline-text-editor[nodepath="operationId"]')).toContainText('getHhjhjhjhkkTtttt');
  await editor.locator('.editor-detail').getByText('Source', { exact: true }).first().click();
  await expect(editor.locator('.ace_editor').first()).toContainText('operationId: getHhjhjhjhkkTtttt');
  expect(editorErrors).toEqual([]);
});

test('a method added in Interface gets a route at once; deleting it asks about a route somebody worked on', async ({ page }) => {
  const editorErrors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && m.text().startsWith('ERROR')) editorErrors.push(m.text());
  });
  await login(page);
  const name = uniqueName('autoroute');
  await createFlow(page, name);
  const routeFile = `/api/flows/${flowIdOf(page)}/files/${name}.camel.yaml`;
  const saved = async () => {
    await fileMenu(page, /^Save(?! As)/);
    await expect(page.getByText('Saved.')).toBeVisible();
    return (await page.request.get(routeFile)).text();
  };
  // GET /cards already has a designed route.
  const put = await page.request.put(routeFile, {
    headers: { 'Content-Type': 'text/plain', 'X-XSRF-TOKEN': (await page.context().cookies()).find((c) => c.name === 'XSRF-TOKEN')!.value },
    data: [
      '- route:',
      '    id: cards',
      '    from:',
      '      uri: direct',
      '      parameters:',
      '        name: getCards',
      '      steps:',
      '        - setBody:',
      '            constant: all the cards',
      '',
    ].join('\n'),
  });
  expect(put.ok()).toBe(true);
  await page.reload();
  await expect(page.getByTestId('custom-node__route.from')).toBeVisible();

  await interfaceMenu(page, /^Design/);
  const editor = editorOf(page);
  await interfaceItem(page, 'Paths');
  await editor.getByText('Add a path').click();
  const addPath = editor.getByRole('dialog', { name: 'Add Path' });
  await addPath.getByRole('textbox').fill('/cards');
  await addPath.getByRole('button', { name: 'Add' }).click();
  // The path opens on the right: the editor is done with the dialog.
  await expect(addPath).toBeHidden();
  await expect(editor.locator('.operation-tab').getByText('Get', { exact: true })).toBeVisible();
  // The spec is named once (File > Save saves it with the canvas from then on).
  await fileMenu(page, /^Save(?! As)/);
  await page.getByRole('dialog', { name: 'Save' }).getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  const method = (label: string) => editor.locator('.operation-tab').getByText(label, { exact: true });
  const deleteOperation = async (label: string) => {
    await method(label).click();
    await editor.locator('button.dropdown-toggle.btn-link').nth(1).click();
    await editor.getByText('Delete Operation', { exact: true }).click();
  };
  const undo = () => editor.getByTitle('Click to undo the last change.').click();

  // GET has its route already; POST gets one.
  await method('Get').click();
  await editor.getByRole('button', { name: 'Add Operation' }).click();
  await method('Post').click();
  await editor.getByRole('button', { name: 'Add Operation' }).click();
  await expect(page.getByText('Added a route for POST /cards.')).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/5-route-added-at-once.png` });
  let route = await saved();
  expect(route).toMatch(/name: postCards\n\s+steps:\n\s+- log:\n\s+id: log-postCards\n\s+message: POST \/cards called/);
  expect(route.match(/name: getCards/g)).toHaveLength(1);

  // POST's route is still as ECHO made it: deleting POST takes it away without asking.
  await deleteOperation('Post');
  await expect.poll(async () => (await saved()).includes('postCards')).toBe(false);
  await expect(page.getByRole('dialog')).toBeHidden();

  // GET's route was designed: deleting GET asks. Keep leaves it.
  await deleteOperation('Get');
  const dialog = page.getByRole('dialog', { name: 'Remove its route too?' });
  await expect(dialog.getByText('GET /cards', { exact: true })).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/6-remove-route-dialog.png` });
  await dialog.getByRole('button', { name: 'Keep Route' }).click();
  expect(await saved()).toContain('constant: all the cards');

  // Undo brings GET back to its route; Remove takes the route away, and undo puts it back as it was.
  await undo();
  await deleteOperation('Get');
  await dialog.getByRole('button', { name: 'Remove Route' }).click();
  await expect.poll(async () => (await saved()).includes('getCards')).toBe(false);
  await undo();
  await expect.poll(async () => (await saved()).includes('constant: all the cards')).toBe(true);
  expect(editorErrors).toEqual([]);
});
