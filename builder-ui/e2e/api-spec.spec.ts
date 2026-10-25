import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createFlow, designMenu, interfaceMenu, login, uniqueName } from './helpers';

// V2: a flow's OpenAPI spec is designed in Apicurio's editor (Openapi), and a data type's
// schema can be generated from a sample JSON. The spec is one file in the flow folder, under the
// name it was uploaded or saved with, in YAML or JSON.

const editorOf = (page: Page) => page.frameLocator('iframe[title="OpenAPI editor"]');
const flowIdOf = (page: Page) => page.url().replace(/.*\/flows\/(\d+).*/, '$1');

async function openSpec(page: Page) {
  await interfaceMenu(page, /^Design/);
  await expect(editorOf(page).getByText('Paths', { exact: true })).toBeVisible();
}

test('a schema made from a sample JSON is saved as YAML under the name given on Save', async ({ page }) => {
  await login(page);
  const name = uniqueName('spec');
  await createFlow(page, name);
  const flowId = flowIdOf(page);

  await openSpec(page);
  await expect(page).toHaveURL(new RegExp(`/flows/${flowId}/api(#.*)?$`));
  // A spec without a name yet, in YAML; no line above the editor names the flow or the spec, the tab line does.
  await expect(page.getByTestId('flow-name-tag')).toHaveText(`Flow: ${name}`);
  await expect(page.getByTestId('spec-flow-name')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save As' })).toHaveCount(0);
  // Rename waits for the first Save, which names the spec.
  await expect(page.getByRole('button', { name: 'Rename', exact: true })).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByRole('radio', { name: 'Yaml' })).toBeChecked();
  const editor = editorOf(page);

  await editor.getByText('Add a data type').click();
  await editor.getByPlaceholder('Enter a unique data type name.').fill('Order');
  await editor.locator('.ace_editor').nth(1).click();
  await page.keyboard.insertText('{"orderId":"A1","quantity":2,"customer":{"name":"Ann"},"lines":[{"sku":"X"}]}');
  await expect(editor.locator('.ace_editor').nth(1)).toContainText('"lines"');
  // The dialog reads the example after a short pause in typing.
  await page.waitForTimeout(1000);
  await editor.getByRole('button', { name: 'Save' }).first().click();
  await expect(page.getByTestId('unsaved')).toBeVisible();

  // The spec is a view of the flow editor: its tab line stays, and moving to another view and back
  // keeps unsaved edits.
  await designMenu(page, /^Design/);
  await expect(page).toHaveURL(new RegExp(`/flows/${flowId}(#.*)?$`));
  await expect(page.getByTestId('flow-name-tag')).toHaveText(`Flow: ${name}`);
  await expect(page.locator('iframe[title="OpenAPI editor"]')).toBeHidden();
  await openSpec(page);
  await expect(editor.getByText('Order', { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId('unsaved')).toBeVisible();

  // Save asks for a name the first time; the YAML extension is added.
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('File name').fill('order-api');
  await expect(dialog.getByText('Saved as order-api.yaml.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved order-api.yaml.')).toBeVisible();
  await expect(page.getByTestId('unsaved')).toBeHidden();

  const flow = await (await page.request.get(`/api/flows/${flowId}`)).json();
  expect(flow.apiSpec).toBe('order-api.yaml');
  const text = await (await page.request.get(`/api/flows/${flowId}/files/order-api.yaml`)).text();
  expect(text).toContain('openapi: 3.0.3');
  expect(text).toMatch(/Order:\n[^]*?type: object/);
  expect(text).toMatch(/orderId:\n\s+type: string/);

  // Switching to JSON and saving stores it as order-api.json instead (a flow has one spec).
  await page.getByRole('radio', { name: 'Json' }).check();
  await expect(page.getByTestId('unsaved')).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved order-api.json.')).toBeVisible();
  const json = await (await page.request.get(`/api/flows/${flowId}/files/order-api.json`)).json();
  expect(json.components.schemas.Order.properties.quantity.type).toBe('integer');
  expect((await page.request.get(`/api/flows/${flowId}/files/order-api.yaml`)).status()).toBe(404);

  // Rename, after Save, saves it under a new name (the extension stays the format's), replacing the old file.
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  const rename = page.getByRole('dialog');
  await expect(rename.getByLabel('File name')).toHaveValue('order-api.json');
  await rename.getByRole('button', { name: 'Cancel' }).click();
  await expect(rename).toBeHidden();
  expect((await (await page.request.get(`/api/flows/${flowId}`)).json()).apiSpec).toBe('order-api.json');
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await rename.getByLabel('File name').fill('orders-v2');
  await expect(rename.getByText('Saved as orders-v2.json.')).toBeVisible();
  await rename.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved orders-v2.json.')).toBeVisible();
  expect((await (await page.request.get(`/api/flows/${flowId}`)).json()).apiSpec).toBe('orders-v2.json');
  expect((await page.request.get(`/api/flows/${flowId}/files/order-api.json`)).status()).toBe(404);

  // The saved spec opens again from the flow folder.
  await page.reload();
  await expect(editor.getByText('Order', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Json' })).toBeChecked();
});

test('an uploaded spec keeps its name and text; it downloads as YAML or JSON; Discard starts again', async ({ page }, testInfo) => {
  await login(page);
  await createFlow(page, uniqueName('upload'));
  const flowId = flowIdOf(page);
  await openSpec(page);

  const yaml = [
    '# Customers, as the partner sent it',
    'openapi: 3.0.3',
    'info:',
    '  title: Customer API',
    '  version: 2.1.0',
    'paths:',
    '  /customers/{id}:',
    '    get:',
    '      operationId: getCustomersId',
    '      parameters:',
    '        - { name: id, in: path, required: true, schema: { type: string } }',
    '      responses:',
    "        '200': { description: The customer }",
    '',
  ].join('\n');
  const chooser = page.waitForEvent('filechooser');
  await interfaceMenu(page, /^Upload/);
  await (await chooser).setFiles({ name: 'Customer_API.v2.yml', mimeType: 'application/yaml', buffer: Buffer.from(yaml) });
  await expect(editorOf(page).getByText('/customers/{id}')).toBeVisible();
  // Stored exactly as uploaded, comment included.
  expect(await (await page.request.get(`/api/flows/${flowId}/files/Customer_API.v2.yml`)).text()).toBe(yaml);

  // Downloads: the spec on screen in either format, named after the spec.
  let downloading = page.waitForEvent('download');
  await interfaceMenu(page, 'Download Openapi File As Json');
  let download = await downloading;
  expect(download.suggestedFilename()).toBe('Customer_API.v2.json');
  const json = JSON.parse(await readFile(await download.path(), 'utf8'));
  expect(json.paths['/customers/{id}'].get.operationId).toBe('getCustomersId');
  downloading = page.waitForEvent('download');
  await interfaceMenu(page, 'Download Openapi File As Yaml');
  download = await downloading;
  expect(download.suggestedFilename()).toBe('Customer_API.v2.yml');
  expect(await readFile(await download.path(), 'utf8')).toContain('operationId: getCustomersId');

  // Uploading another spec replaces this one, after asking.
  const second = '{"openapi":"3.0.3","info":{"title":"Orders","version":"1.0.0"},"paths":{}}';
  const chooser2 = page.waitForEvent('filechooser');
  await interfaceMenu(page, /^Upload/);
  await (await chooser2).setFiles({ name: 'orders.json', mimeType: 'application/json', buffer: Buffer.from(second) });
  await expect(page.getByRole('dialog')).toContainText('orders.json replaces Customer_API.v2.yml');
  await page.getByRole('dialog').getByRole('button', { name: 'Replace' }).click();
  await expect(editorOf(page).getByText('/customers/{id}')).toBeHidden();
  expect((await (await page.request.get(`/api/flows/${flowId}`)).json()).apiSpec).toBe('orders.json');
  expect((await page.request.get(`/api/flows/${flowId}/files/Customer_API.v2.yml`)).status()).toBe(404);

  // A file that is not an OpenAPI spec is refused.
  const chooser3 = page.waitForEvent('filechooser');
  await interfaceMenu(page, /^Upload/);
  await (await chooser3).setFiles({ name: 'notes.yaml', mimeType: 'application/yaml', buffer: Buffer.from('title: notes\n') });
  await expect(page.getByRole('alert')).toContainText('not an OpenAPI spec');

  // Discard starts again from a blank spec, without a name; the saved one stays in the flow.
  await editorOf(page).getByText('Add a data type').click();
  await editorOf(page).getByPlaceholder('Enter a unique data type name.').fill('Draft');
  await editorOf(page).getByRole('button', { name: 'Save' }).first().click();
  await expect(page.getByTestId('unsaved')).toBeVisible();
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('orders.json stays in the flow');
  await page.screenshot({ path: testInfo.outputPath('discard-dialog.png') });
  await page.getByRole('dialog').getByRole('button', { name: 'Discard' }).click();
  await expect(page.getByTestId('unsaved')).toBeHidden();
  await expect(page.getByRole('radio', { name: 'Yaml' })).toBeChecked();
  await expect(editorOf(page).getByText('Add a data type')).toBeVisible();
  expect((await (await page.request.get(`/api/flows/${flowId}`)).json()).apiSpec).toBe('orders.json');
});

test('a flow saved before specs kept their name opens its openapi.json', async ({ page }) => {
  await login(page);
  await createFlow(page, uniqueName('legacy'));
  const flowId = flowIdOf(page);
  const spec = { openapi: '3.0.3', info: { title: 'Legacy', version: '1.0.0' }, paths: {}, components: { schemas: { LegacyOrder: { type: 'object' } } } };
  await page.request.put(`/api/flows/${flowId}/files/openapi.json`, {
    data: JSON.stringify(spec),
    headers: { 'Content-Type': 'text/plain', 'X-XSRF-TOKEN': (await page.context().cookies()).find((c) => c.name === 'XSRF-TOKEN')!.value },
  });
  await page.reload();
  await openSpec(page);
  await expect(page.getByRole('radio', { name: 'Json' })).toBeChecked();
  await expect(editorOf(page).getByText('LegacyOrder', { exact: true }).first()).toBeVisible();
});

test("Openapi keeps the editor's tab line, styled in ECHO's theme", async ({ page }) => {
  await login(page);
  await createFlow(page, uniqueName('spec-tabs'));
  // Clicking Interface only opens its menu, Design first; Design opens the spec.
  await page.getByRole('button', { name: 'Interface', exact: true }).click();
  await expect(page.getByRole('menuitem').first()).toHaveText(/^Design/);
  await expect(page.locator('iframe[title="OpenAPI editor"]')).toBeHidden();
  await page.keyboard.press('Escape');
  await openSpec(page);
  // The bar: Save, Rename, Discard (Info and the rest are in the list on the left); no "Schema from a sample" note.
  const bar = page.locator('.echo-api-spec__bar');
  await expect(bar.getByRole('button')).toHaveText(['Save', 'Rename', 'Discard']);
  await expect(bar).not.toContainText('Schema from a sample');
  const editor = editorOf(page);
  for (const name of ['File', 'Flow', 'Run', 'Advanced']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  }
  await expect(page.getByRole('button', { name: 'Interface', exact: true })).toHaveClass(/echo-tab-menu--underlined/);

  // The editor has ECHO's theme and font, not Apicurio's own; its title bar's API name is hidden
  // under ECHO's bar.
  const html = editor.locator('html');
  await expect(html).toHaveAttribute('data-echo-theme', 'navy');
  expect(await editor.locator('body').evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Inter');
  await expect(editor.locator('.editor-title-bar > h1')).toBeHidden();
  await expect(editor.getByRole('button', { name: /Issues/ })).toBeVisible();

  // Apicurio's full-page dialogs start below ECHO's bar.
  await editor.getByText('Add a data type').click();
  const heading = editor.getByText('Define a New Data Type');
  await expect(heading).toBeVisible();
  const barBox = (await bar.boundingBox())!;
  const frame = (await page.locator('iframe[title="OpenAPI editor"]').boundingBox())!;
  const headingBox = (await heading.boundingBox())!;
  expect(frame.y + headingBox.y).toBeGreaterThanOrEqual(barBox.y + barBox.height);
  await editor.getByRole('button', { name: 'Cancel' }).first().click();

  // An unsaved spec edit is saved by File > Save, from any view; without a name it asks for one.
  await editor.getByText('Add a data type').click();
  await editor.getByPlaceholder('Enter a unique data type name.').fill('Customer');
  await editor.getByRole('button', { name: 'Save' }).first().click();
  await expect(page.getByTestId('unsaved')).toBeVisible();
  await page.getByRole('tab', { name: /DataMapper/ }).click();
  await expect(page.locator('iframe[title="OpenAPI editor"]')).toBeHidden();
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Save$/ }).click();
  await page.getByRole('dialog').getByLabel('File name').fill('customers.json');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('unsaved')).toBeHidden();
  const spec = await (await page.request.get(`/api/flows/${flowIdOf(page)}/files/customers.json`)).json();
  expect(spec.components.schemas.Customer).toBeDefined();

  // The spec's own details are items in the list on the left: Info and Tag Definitions above Paths,
  // Source below Responses. Interface > Design opens the spec with nothing shown on the right.
  await openSpec(page);
  const outline = editor.locator('.editor-outline');
  await expect(outline.locator('.echo-nav-item')).toHaveText(['Info', 'Tag Definitions', 'Source']);
  await expect(editor.locator('main-form')).toBeHidden();
  await expect(editor.locator('definition-form')).toBeHidden();
  await outline.getByText('Customer', { exact: true }).first().click();
  await expect(editor.locator('definition-form')).toBeVisible();
  await expect(editor.getByText('Vendor Extensions', { exact: true })).toBeHidden();
  await interfaceMenu(page, /^Design/);
  await expect(editor.locator('definition-form')).toBeHidden();
  await expect(editor.locator('main-form')).toBeHidden();

  // Tag Definitions shows only the tags, with a short explanation; headings are in title case.
  await outline.locator('.echo-nav-item', { hasText: 'Tag Definitions' }).click();
  await expect(editor.locator('main-form .tags-section')).toBeVisible();
  await expect(editor.locator('main-form .info-section')).toBeHidden();
  await expect(editor.locator('main-form .detail-tabs')).toBeHidden();
  for (const hidden of ['Contact', 'License', 'Security Schemes', 'Security Requirements', 'Vendor Extensions']) {
    await expect(editor.getByText(hidden, { exact: true })).toBeHidden();
  }
  const tagNote = await editor
    .locator('main-form .tags-section .section-label')
    .evaluate((el) => getComputedStyle(el, '::after').content);
  expect(tagNote).toBe('"\u00a0Tags group APIs into sections"');
  // The question-mark icon before the note is drawn in the theme's subtle text colour.
  const tagIcon = await editor
    .locator('main-form .tags-section .section-label counter')
    .evaluate((el) => getComputedStyle(el, '::after').maskImage);
  expect(tagIcon).toMatch(/^url\("data:image\/svg\+xml,/);

  // Info shows Version, Description and Base Path (Servers): "/" with a pencil until one is set; one path,
  // typed and saved (no Apply, description or variables).
  await outline.locator('.echo-nav-item', { hasText: 'Info' }).click();
  await expect(editor.locator('main-form .info-section')).toBeVisible();
  await expect(editor.locator('main-form .tags-section')).toBeHidden();
  const basePath = editor.locator('main-form .servers-section');
  const label = basePath.locator('.section-label');
  expect(await label.evaluate((el) => getComputedStyle(el, '::before').content)).toBe('"Base Path"');
  expect(await label.evaluate((el) => getComputedStyle(el, '::after').content)).toBe(
    '"\u00a0Base Path will be prepended to all Urls of the flow"',
  );
  expect(await basePath.locator('signpost span').evaluate((el) => getComputedStyle(el, '::before').content)).toBe('"/"');
  expect(await basePath.locator('signpost a').evaluate((el) => getComputedStyle(el, '::after').content)).toBe('"✏"');
  await basePath.locator('signpost a').click({ force: true }); // the pencil is CSS, so not "visible" to Playwright
  const dialog = editor.locator('.server-entity-editor');
  expect(await dialog.locator('h1.title').evaluate((el) => getComputedStyle(el, '::before').content)).toBe('"Base Path"');
  await expect(dialog.locator('#description')).toBeHidden();
  await expect(dialog.getByRole('button', { name: 'Apply' })).toBeHidden();
  await dialog.locator('#serverUrl').pressSequentially('/customers/v1');
  await dialog.getByRole('button', { name: 'Save' }).first().click();
  await expect(basePath.locator('server-row')).toHaveText(/\/customers\/v1/);
  // A set path is one line with the pencil, which opens the dialog on that path; Save replaces it.
  await expect(basePath.locator('server-row .actions')).toBeHidden();
  await basePath.locator('server-row .url').click();
  await expect(dialog.locator('#serverUrl')).toHaveValue('/customers/v1');
  await dialog.getByRole('button', { name: 'Cancel' }).first().click();
  await expect(dialog).toBeHidden();
  await basePath.locator('server-row .url').click();
  await expect(dialog.locator('#serverUrl')).toHaveValue('/customers/v1');
  await dialog.locator('#serverUrl').fill('');
  await dialog.locator('#serverUrl').pressSequentially('/customers/v2');
  await dialog.getByRole('button', { name: 'Save' }).first().click();
  await expect(basePath.locator('server-row')).toHaveCount(1);
  await expect(basePath.locator('server-row')).toHaveText(/\/customers\/v2/);
  await expect(basePath.locator("icon-button[type='add']")).toBeHidden(); // one is enough
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('unsaved')).toBeHidden();
  const saved = await (await page.request.get(`/api/flows/${flowIdOf(page)}/files/customers.json`)).json();
  expect(saved.servers.map((s: { url: string }) => s.url)).toEqual(['/customers/v2']);

  // Source shows the whole spec's source with its toolbar (Upload first), no Design/Source tabs.
  await outline.locator('.echo-nav-item', { hasText: 'Source' }).click();
  await expect(editor.locator('main-form .echo-source-upload')).toBeVisible();
  await expect(editor.locator('main-form .info-section')).toBeHidden();
  await expect(editor.locator('main-form .detail-tabs')).toBeHidden();
  await outline.locator('.echo-nav-item', { hasText: 'Info' }).click();
  await expect(editor.locator('main-form .info-section')).toBeVisible();
  await expect(editor.locator('main-form .echo-source-upload')).toBeHidden();
});

test("Copy From Another Flow starts this flow's spec from a copy of another flow's", async ({ page }) => {
  await login(page);
  // A spec owned by another flow.
  const other = uniqueName('spec-owner');
  await createFlow(page, other);
  const otherId = flowIdOf(page);
  const xsrf = (await page.context().cookies()).find((c) => c.name === 'XSRF-TOKEN')!.value;
  const ownerSpec = 'openapi: 3.0.3\ninfo: {title: Customers, version: 1.0.0}\npaths: {}\n';
  const specName = `${other}.yaml`;
  await page.request.put(`/api/flows/${otherId}/api-spec/${specName}`, {
    data: ownerSpec,
    headers: { 'Content-Type': 'text/plain', 'X-XSRF-TOKEN': xsrf },
  });

  await createFlow(page, uniqueName('spec-user'));
  const flowId = flowIdOf(page);
  await interfaceMenu(page, /^Copy From Another Flow/);
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'OpenAPI spec to copy' }).click();
  await page.getByText(`From flow ${other}`, { exact: true }).click();
  await dialog.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(dialog).toBeHidden();

  // The file is copied into this flow, which shows it in Openapi.
  expect(await (await page.request.get(`/api/flows/${flowId}/files/${specName}`)).text()).toBe(ownerSpec);
  await expect.poll(async () => (await (await page.request.get(`/api/flows/${flowId}`)).json()).apiSpec).toBe(specName);

  // When this flow has a spec, the copy replaces it after saying so.
  await page.request.put(`/api/flows/${flowId}/api-spec/fresh-api.yaml`, {
    data: ownerSpec.replace('Customers', 'Fresh'),
    headers: { 'Content-Type': 'text/plain', 'X-XSRF-TOKEN': xsrf },
  });
  await page.reload();
  await interfaceMenu(page, /^Copy From Another Flow/);
  await dialog.getByRole('button', { name: 'OpenAPI spec to copy' }).click();
  await page.getByText(`From flow ${other}`, { exact: true }).click();
  await expect(dialog).toContainText('A flow has one OpenAPI spec: fresh-api.yaml is replaced.');
  await dialog.getByRole('button', { name: 'Replace' }).click();
  await expect(dialog).toBeHidden();
  const detail = await (await page.request.get(`/api/flows/${flowId}`)).json();
  expect(detail.apiSpec).toBe(specName);
  expect(detail.files).not.toContain('fresh-api.yaml');
});

test('a first-time user starts from the API on the untitled flow; the first Save names the flow and the spec', async ({ page }) => {
  await login(page);
  await page.keyboard.press('Escape');
  await openSpec(page);
  await expect(page.locator('.echo-untitled__empty')).toBeHidden();
  await expect(page.getByTestId('flow-name-tag')).toHaveText('Flow: Untitled flow');

  const yaml = 'openapi: 3.0.3\ninfo:\n  title: Card API\n  version: 1.0.0\npaths: {}\n';
  const chooser = page.waitForEvent('filechooser');
  await interfaceMenu(page, /^Upload/);
  await (await chooser).setFiles({ name: 'cards.yml', mimeType: 'application/yaml', buffer: Buffer.from(yaml) });
  // There is no flow to store it in yet: it stays on screen until the flow is saved.
  await expect(page.getByText('Opened cards.yml: save the flow to keep it.')).toBeVisible();
  await page.getByRole('radio', { name: 'Json' }).check();

  // Save (Openapi's, or File > Save) asks for both names in one dialog, prefilled from the spec.
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel(/^Name/)).toHaveValue('Card API');
  await expect(dialog.getByLabel(/OpenAPI file name/)).toHaveValue('cards.json');
  const name = uniqueName('card-api');
  await dialog.getByLabel(/^Name/).fill(name);
  await dialog.getByRole('button', { name: 'Save' }).click();

  // The new draft opens on its spec, stored in the flow under the name given.
  await expect(page).toHaveURL(/\/flows\/\d+\/api(#.*)?$/);
  await expect(page.getByTestId('flow-name-tag')).toHaveText(`Flow: ${name}`);
  const flowId = flowIdOf(page);
  expect((await (await page.request.get(`/api/flows/${flowId}`)).json()).apiSpec).toBe('cards.json');
  const stored = await (await page.request.get(`/api/flows/${flowId}/files/cards.json`)).json();
  expect(stored.info.title).toBe('Card API');

  // Later saves do not ask.
  await page.getByRole('radio', { name: 'Yaml' }).check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved cards.yaml.')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test("an uploaded spec keeps its own operationIds and comments; only missing ids are added, and saves keep the comments", async ({ page }) => {
  await login(page);
  await createFlow(page, uniqueName('own-ids'));
  const flowId = flowIdOf(page);
  await openSpec(page);
  const yaml = [
    '# Orders, as the partner sent it',
    'openapi: 3.0.3',
    'info: { title: Partner Orders, version: 3.0.0 }',
    'paths:',
    '  /orders:',
    '    # every order',
    '    get:',
    '      operationId: listOrders',
    "      responses: { '200': { description: ok } }",
    '    post:',
    "      responses: { '201': { description: created } }",
    '',
  ].join('\n');
  const chooser = page.waitForEvent('filechooser');
  await interfaceMenu(page, /^Upload/);
  await (await chooser).setFiles({ name: 'partner-orders.yaml', mimeType: 'application/yaml', buffer: Buffer.from(yaml) });
  await expect(editorOf(page).getByText('/orders')).toBeVisible();
  const file = () => page.request.get(`/api/flows/${flowId}/files/partner-orders.yaml`).then((r) => r.text());
  // Only the operation without an id got one; everything else is as uploaded.
  await expect.poll(file).toContain('operationId: postOrders');
  let stored = await file();
  expect(stored).toContain('# Orders, as the partner sent it\nopenapi: 3.0.3\ninfo: { title: Partner Orders, version: 3.0.0 }\n');
  expect(stored).toContain('    # every order\n    get:\n      operationId: listOrders\n');

  // An edit in the editor, saved: the comments and ids stay.
  await editorOf(page).getByText('Add a data type').click();
  await editorOf(page).getByPlaceholder('Enter a unique data type name.').fill('Order');
  await editorOf(page).getByRole('button', { name: 'Save' }).first().click();
  await expect(page.getByTestId('unsaved')).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('unsaved')).toBeHidden();
  stored = await file();
  expect(stored).toContain('Order:');
  expect(stored).toContain('# Orders, as the partner sent it\n');
  expect(stored).toContain('    # every order\n    get:\n      operationId: listOrders\n');
  expect(stored).toContain('operationId: postOrders');
});
