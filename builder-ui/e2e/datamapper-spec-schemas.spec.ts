import { expect, test, type Page } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { interfaceMenu, login, uniqueName } from './helpers';

// The DataMapper's Attach Schema offers the request and response bodies of the flow's Openapi spec:
// ECHO writes the picked one into the flow as openapi-<endpoint>-<method>-<part>.schema.json. When
// the spec changes, those files follow it, and steps mapping fields it no longer has are listed.

const samples = fileURLToPath(new URL('../../samples/flows/orders/', import.meta.url));
const shots = process.env.ECHO_E2E_SCREENSHOTS;

const spec = (customer: boolean) =>
  [
    'openapi: 3.0.3',
    'info: { title: Orders, version: 1.0.0 }',
    'paths:',
    '  /orders:',
    '    post:',
    '      operationId: createOrder',
    '      requestBody:',
    "        content: { application/json: { schema: { $ref: '#/components/schemas/Order' } } }",
    '      responses:',
    "        '200': { description: Accepted, content: { application/json: { schema: { $ref: '#/components/schemas/Accepted' } } } }",
    '  /orders/{id}:',
    '    put:',
    '      operationId: updateOrder',
    "      parameters: [{ name: id, in: path, required: true, schema: { type: string } }]",
    "      requestBody: { content: { application/json: { schema: { $ref: '#/components/schemas/Order' } } } }",
    "      responses: { '204': { description: Updated } }",
    'components:',
    '  schemas:',
    '    Order:',
    '      type: object',
    '      properties:',
    '        orderId: { type: string }',
    ...(customer ? ["        customer: { $ref: '#/components/schemas/Customer' }"] : []),
    "        items: { type: array, items: { $ref: '#/components/schemas/Line' } }",
    '    Customer: { type: object, properties: { name: { type: string }, email: { type: string } } }',
    '    Line: { type: object, properties: { sku: { type: string }, qty: { type: number } } }',
    '    Accepted: { type: object, properties: { orderId: { type: string }, status: { type: string } } }',
    '',
  ].join('\n');

async function xsrf(page: Page) {
  return (await page.context().cookies()).find((c) => c.name === 'XSRF-TOKEN')?.value ?? '';
}

test('Attach Schema offers the bodies of the Openapi spec, and a spec change lists the mappings to review', async ({ page }) => {
  await login(page);
  const name = uniqueName('dmspec');
  const created = await page.request.post('/api/flows', { data: { name }, headers: { 'X-XSRF-TOKEN': await xsrf(page) } });
  const { id } = await created.json();
  // The golden orders flow, with its mappings, and a spec whose request body has the same fields.
  for (const file of readdirSync(samples)) {
    if (file === 'sample-request.json') continue;
    const target = file === 'orders.camel.yaml' ? `${name}.camel.yaml` : file;
    await page.request.put(`/api/flows/${id}/files/${target}`, {
      data: readFileSync(samples + file, 'utf8'),
      headers: { 'Content-Type': 'text/plain', 'X-XSRF-TOKEN': await xsrf(page) },
    });
  }
  await page.request.put(`/api/flows/${id}/api-spec/orders-api.yaml`, {
    data: spec(true),
    headers: { 'Content-Type': 'text/plain', 'X-XSRF-TOKEN': await xsrf(page) },
  });

  await page.goto(`/flows/${id}`);
  await expect(page.getByTestId('custom-node__route.from')).toBeVisible();
  await page.evaluate(() => (window.location.hash = '#/datamapper/kaoto-datamapper-order-request'));
  await expect(page.locator('[data-testid^="node-source-fj-string-orderId"]')).toBeVisible();

  // Attach Schema on the source: ECHO's dialog lists the spec's bodies by operation.
  await page.getByTestId('attach-schema-sourceBody-Body-button').click();
  // The step has the sample's uploaded schema; it is replaced by the one from the spec.
  await page.getByRole('dialog').getByRole('button', { name: 'Continue' }).click();
  await page.getByTestId('attach-schema-modal-option-json').click();
  await page.getByTestId('attach-schema-modal-btn-file').click();
  const picker = page.getByRole('dialog', { name: 'Attach a schema' });
  await expect(picker).toContainText('POST /orders');
  await expect(picker).toContainText('PUT /orders/{id}');
  await picker.getByRole('radio', { name: 'Request body' }).first().check();
  if (shots) await page.screenshot({ path: `${shots}/1-attach-from-spec.png` });
  await picker.getByRole('button', { name: 'Attach', exact: true }).click();
  await expect(picker).toHaveCount(0);
  await expect(page.getByTestId('attach-schema-no-files')).toHaveCount(0);
  await page.getByTestId('attach-schema-modal-btn-attach').click();
  await expect(page.locator('[data-testid^="node-source-fj-string-orderId"]')).toBeVisible();
  await expect(page.locator('[data-testid^="node-source-fj-map-customer"]')).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/2-attached.png` });

  const file = await (await page.request.get(`/api/flows/${id}/files/openapi-orders-post-request.schema.json`)).json();
  expect(file['x-echo-openapi']).toEqual({ method: 'post', path: '/orders', part: 'request' });
  expect(file.$defs.Customer.properties.email).toEqual({ type: 'string' });
  await expect
    .poll(async () => JSON.parse(await (await page.request.get(`/api/flows/${id}/files/.kaoto`)).text())['kaoto-datamapper-order-request'].sourceBody.filePath)
    .toEqual(['openapi-orders-post-request.schema.json']);
  await expect(page.getByTestId('spec-mapping-warnings')).toHaveCount(0);

  // The spec loses customer (uploaded over it in Openapi): the schema file follows, and the
  // request mapping, which maps customer.name, is listed.
  await page.evaluate(() => (window.location.hash = '#/'));
  const chooser = page.waitForEvent('filechooser');
  await interfaceMenu(page, /^Upload/);
  await (await chooser).setFiles({ name: 'orders-api.yaml', mimeType: 'application/yaml', buffer: Buffer.from(spec(false)) });
  await page.getByRole('dialog').getByRole('button', { name: 'Replace' }).click();
  const warnings = page.getByTestId('spec-mapping-warnings');
  await expect(warnings).toContainText('Review this DataMapper step');
  await expect(warnings).toContainText('Route orders, step kaoto-datamapper-order-request');
  await expect(warnings).toContainText('source body (openapi-orders-post-request.schema.json): customer is not in the schema');
  if (shots) await page.screenshot({ path: `${shots}/3-spec-changed.png` });
  const refreshed = await (await page.request.get(`/api/flows/${id}/files/openapi-orders-post-request.schema.json`)).json();
  expect(refreshed.properties.customer).toBeUndefined();
});
