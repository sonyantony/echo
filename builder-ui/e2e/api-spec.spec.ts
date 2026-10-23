import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createFlow, login, uniqueName } from './helpers';

// V2: a flow's OpenAPI spec is designed in Apicurio's editor (Openapi Design), and a data type's
// schema can be generated from a sample JSON. The spec is one file in the flow folder, under the
// name it was uploaded or saved with, in YAML or JSON.

const editorOf = (page: Page) => page.frameLocator('iframe[title="OpenAPI editor"]');
const flowIdOf = (page: Page) => page.url().replace(/.*\/flows\/(\d+).*/, '$1');

async function openSpec(page: Page) {
  await page.getByRole('button', { name: 'Openapi Design', exact: true }).click();
  // Clicking opens the view and its menu; the menu is closed again for the tests that don't use it.
  await expect(page.getByRole('menuitem', { name: /^Upload/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(editorOf(page).getByText('Paths', { exact: true })).toBeVisible();
}

async function specMenu(page: Page, item: string | RegExp) {
  await page.getByRole('button', { name: 'Openapi Design', exact: true }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

test('a schema made from a sample JSON is saved as YAML under the name given on Save', async ({ page }) => {
  await login(page);
  const name = uniqueName('spec');
  await createFlow(page, name);
  const flowId = flowIdOf(page);

  await openSpec(page);
  await expect(page).toHaveURL(new RegExp(`/flows/${flowId}/api(#.*)?$`));
  // A spec without a name yet: the breadcrumb (<flow> / Openapi / <file>) says so, and YAML is the format.
  await expect(page.getByTestId('spec-flow-name')).toHaveText(name);
  await expect(page.getByTestId('spec-name')).toHaveText('<new>');
  await expect(page.getByRole('button', { name: 'Save As' })).toHaveCount(0);
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
  await page.getByRole('button', { name: 'Flow Design', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/flows/${flowId}(#.*)?$`));
  await expect(page.getByRole('heading', { name })).toBeVisible();
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
  await expect(page.getByTestId('spec-name')).toHaveText('order-api.yaml');
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
  await expect(page.getByTestId('spec-name')).toHaveText('order-api.json');
  const json = await (await page.request.get(`/api/flows/${flowId}/files/order-api.json`)).json();
  expect(json.components.schemas.Order.properties.quantity.type).toBe('integer');
  expect((await page.request.get(`/api/flows/${flowId}/files/order-api.yaml`)).status()).toBe(404);

  // The file name in the breadcrumb is renamed in place: Escape cancels, Enter saves under the new
  // name (the extension stays the format's), replacing the old file.
  await page.getByTestId('spec-name').click();
  const rename = page.getByRole('textbox', { name: 'OpenAPI file name' });
  await expect(rename).toHaveValue('order-api');
  await rename.fill('ignored');
  await rename.press('Escape');
  await expect(page.getByTestId('spec-name')).toHaveText('order-api.json');
  await page.getByTestId('spec-name').click();
  await rename.fill('orders-v2');
  await rename.press('Enter');
  await expect(page.getByTestId('spec-name')).toHaveText('orders-v2.json');
  expect((await (await page.request.get(`/api/flows/${flowId}`)).json()).apiSpec).toBe('orders-v2.json');
  expect((await page.request.get(`/api/flows/${flowId}/files/order-api.json`)).status()).toBe(404);

  // The saved spec opens again from the flow folder.
  await page.reload();
  await expect(editor.getByText('Order', { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId('spec-name')).toHaveText('orders-v2.json');
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
    '      operationId: getCustomer',
    '      parameters:',
    '        - { name: id, in: path, required: true, schema: { type: string } }',
    '      responses:',
    "        '200': { description: The customer }",
    '',
  ].join('\n');
  const chooser = page.waitForEvent('filechooser');
  await specMenu(page, /^Upload/);
  await (await chooser).setFiles({ name: 'Customer_API.v2.yml', mimeType: 'application/yaml', buffer: Buffer.from(yaml) });
  await expect(page.getByTestId('spec-name')).toHaveText('Customer_API.v2.yml');
  await expect(editorOf(page).getByText('/customers/{id}')).toBeVisible();
  // Stored exactly as uploaded, comment included.
  expect(await (await page.request.get(`/api/flows/${flowId}/files/Customer_API.v2.yml`)).text()).toBe(yaml);

  // Downloads: the spec on screen in either format, named after the spec.
  let downloading = page.waitForEvent('download');
  await specMenu(page, 'Download Openapi File As Json');
  let download = await downloading;
  expect(download.suggestedFilename()).toBe('Customer_API.v2.json');
  const json = JSON.parse(await readFile(await download.path(), 'utf8'));
  expect(json.paths['/customers/{id}'].get.operationId).toBe('getCustomer');
  downloading = page.waitForEvent('download');
  await specMenu(page, 'Download Openapi File As Yaml');
  download = await downloading;
  expect(download.suggestedFilename()).toBe('Customer_API.v2.yml');
  expect(await readFile(await download.path(), 'utf8')).toContain('operationId: getCustomer');

  // Uploading another spec replaces this one, after asking.
  const second = '{"openapi":"3.0.3","info":{"title":"Orders","version":"1.0.0"},"paths":{}}';
  const chooser2 = page.waitForEvent('filechooser');
  await specMenu(page, /^Upload/);
  await (await chooser2).setFiles({ name: 'orders.json', mimeType: 'application/json', buffer: Buffer.from(second) });
  await expect(page.getByRole('dialog')).toContainText('orders.json replaces Customer_API.v2.yml');
  await page.getByRole('dialog').getByRole('button', { name: 'Replace' }).click();
  await expect(page.getByTestId('spec-name')).toHaveText('orders.json');
  expect((await (await page.request.get(`/api/flows/${flowId}`)).json()).apiSpec).toBe('orders.json');
  expect((await page.request.get(`/api/flows/${flowId}/files/Customer_API.v2.yml`)).status()).toBe(404);

  // A file that is not an OpenAPI spec is refused.
  const chooser3 = page.waitForEvent('filechooser');
  await specMenu(page, /^Upload/);
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
  await expect(page.getByTestId('spec-name')).toHaveText('<new>');
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
  await expect(page.getByTestId('spec-name')).toHaveText('openapi.json');
  await expect(page.getByRole('radio', { name: 'Json' })).toBeChecked();
  await expect(editorOf(page).getByText('LegacyOrder', { exact: true }).first()).toBeVisible();
});

test("Openapi Design keeps the editor's tab line, styled in ECHO's theme", async ({ page }) => {
  await login(page);
  await createFlow(page, uniqueName('spec-tabs'));
  await openSpec(page);
  const editor = editorOf(page);
  for (const name of ['File', 'Flow Design', 'Run', 'Advanced', 'History']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  }
  await expect(page.getByRole('button', { name: 'Openapi Design', exact: true })).toHaveClass(/echo-tab-menu--underlined/);

  // The editor has ECHO's theme and font, not Apicurio's own; its title bar's API name is hidden
  // under ECHO's bar, which "API Overview" stands in for.
  const html = editor.locator('html');
  await expect(html).toHaveAttribute('data-echo-theme', 'studio');
  expect(await editor.locator('body').evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Inter');
  await expect(editor.locator('.editor-title-bar > h1')).toBeHidden();
  await expect(editor.getByRole('button', { name: /Issues/ })).toBeVisible();

  // Apicurio's full-page dialogs start below ECHO's bar, and API Overview waits until they close.
  await editor.getByText('Add a data type').click();
  const heading = editor.getByText('Define a New Data Type');
  await expect(heading).toBeVisible();
  const bar = (await page.locator('.echo-api-spec__bar').boundingBox())!;
  const frame = (await page.locator('iframe[title="OpenAPI editor"]').boundingBox())!;
  const headingBox = (await heading.boundingBox())!;
  expect(frame.y + headingBox.y).toBeGreaterThanOrEqual(bar.y + bar.height);
  await expect(page.getByRole('button', { name: 'API Overview' })).toHaveAttribute('aria-disabled', 'true');
  await editor.getByRole('button', { name: 'Cancel' }).first().click();
  await expect(page.getByRole('button', { name: 'API Overview' })).not.toHaveAttribute('aria-disabled', 'true');

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

  // API Overview opens the spec's own details (Apicurio's title bar click).
  await openSpec(page);
  await editor.getByText('Customer', { exact: true }).first().click();
  await expect(editor.locator('definition-form')).toBeVisible();
  await expect(editor.getByText('Vendor Extensions', { exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'API Overview' }).click();
  await expect(editor.getByText('Tag Definitions', { exact: true })).toBeVisible();
  // Only Info, Tag Definitions and Servers (as Base Path) are shown there (Vendor Extensions is hidden on every
  // page); headings are in title case, and tags and Base Path get a short explanation.
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

  // Servers shows as Base Path: "/" with a pencil until one is set; one path, typed and saved (no Apply,
  // description or variables).
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
  await specMenu(page, /^Copy From Another Flow/);
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'OpenAPI spec to copy' }).click();
  await page.getByText(`From flow ${other}`, { exact: true }).click();
  await dialog.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(dialog).toBeHidden();

  // The file is copied into this flow, which shows it in Openapi Design.
  expect(await (await page.request.get(`/api/flows/${flowId}/files/${specName}`)).text()).toBe(ownerSpec);
  await expect(page.getByTestId('spec-name')).toHaveText(specName);

  // When this flow has a spec, the copy replaces it after saying so.
  await page.request.put(`/api/flows/${flowId}/api-spec/fresh-api.yaml`, {
    data: ownerSpec.replace('Customers', 'Fresh'),
    headers: { 'Content-Type': 'text/plain', 'X-XSRF-TOKEN': xsrf },
  });
  await page.reload();
  await specMenu(page, /^Copy From Another Flow/);
  await dialog.getByRole('button', { name: 'OpenAPI spec to copy' }).click();
  await page.getByText(`From flow ${other}`, { exact: true }).click();
  await expect(dialog).toContainText('A flow has one OpenAPI spec: fresh-api.yaml is replaced.');
  await dialog.getByRole('button', { name: 'Replace' }).click();
  await expect(dialog).toBeHidden();
  const detail = await (await page.request.get(`/api/flows/${flowId}`)).json();
  expect(detail.apiSpec).toBe(specName);
  expect(detail.files).not.toContain('fresh-api.yaml');
});
