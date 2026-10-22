import { expect, test, type Page } from '@playwright/test';
import { createFlow, fileMenu, login, uniqueName } from './helpers';

// V2: the flow's REST service comes from its OpenAPI spec. There is no Rest tab; ECHO adds the
// contract-first service when the flow runs or is published, the spec's server URL is the Base
// Path, an operation without a route answers 404, and the Flow Design menu holds the two REST
// settings.

const flowIdOf = (page: Page) => page.url().replace(/.*\/flows\/(\d+).*/, '$1');
const csrf = async (page: Page) => (await page.context().cookies()).find((c) => c.name === 'XSRF-TOKEN')!.value;

const SPEC = `openapi: 3.0.3
info: {title: Shop, version: 1.0.0}
servers:
  - url: /shop
paths:
  /orders/{id}:
    get:
      operationId: getOrder
      parameters:
        - {name: id, in: path, required: true, schema: {type: string}}
      responses: {"200": {description: ok}}
  /orders:
    get:
      operationId: listOrders
      responses: {"200": {description: ok}}
`;

const ROUTE = `- route:
    id: get-order
    from:
      uri: direct:getOrder
      steps:
        - setBody:
            simple: '{"id":"\${header.id}"}'
`;

test('the REST service is made from the spec: Base Path, 404 for missing operations, settings next to Publish', async ({ page }) => {
  await login(page);
  const name = uniqueName('restspec');
  await createFlow(page, name);
  const flowId = flowIdOf(page);
  await expect(page.getByRole('tab', { name: 'Rest' })).toBeHidden();

  // With no spec the settings wait for one.
  const validation = page.getByRole('checkbox', { name: 'Client Request Validation' });
  const cors = page.getByRole('checkbox', { name: 'Enable CORS' });
  await expect(validation).toBeDisabled();
  await expect(cors).toBeDisabled();

  const headers = { 'Content-Type': 'text/plain', 'X-XSRF-TOKEN': await csrf(page) };
  await page.request.put(`/api/flows/${flowId}/api-spec/shop-api.yaml`, { data: SPEC, headers });
  await page.request.put(`/api/flows/${flowId}/files/${name}.camel.yaml`, { data: ROUTE, headers });
  await page.reload();
  await expect(page.getByTestId('custom-node__route.from')).toBeVisible();

  await validation.click();
  await expect(page.getByTestId('unsaved')).toBeVisible();
  await expect(validation).toBeChecked();
  await expect(cors).not.toBeChecked();
  await expect(cors).toBeEnabled();
  await page.screenshot({ path: 'test-results/rest-settings-toolbar.png' });
  await fileMenu(page, /^Save$/);
  await expect(page.getByTestId('unsaved')).toBeHidden();
  const draft = await (await page.request.get(`/api/flows/${flowId}/files/${name}.camel.yaml`)).text();
  expect(draft).toContain('clientRequestValidation: true');
  // The draft keeps only what is designed; the REST service is added when the flow leaves the editor.
  expect(draft).not.toContain('openApi');

  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await page.getByRole('menuitem', { name: new RegExp(`^Run ${name}`) }).click();
  await expect(page.getByText(/\/shop\/orders\/\{id\}$/)).toBeVisible();
  const call = async (path: string) =>
    (await page.request.post(`/api/flows/${flowId}/run/request`, {
      data: { method: 'GET', path },
      headers: { 'X-XSRF-TOKEN': await csrf(page) },
    })).json();
  const found = await call('/shop/orders/7');
  expect(found.status).toBe(200);
  expect(found.body).toBe('{"id":"7"}');
  const missing = await call('/shop/orders');
  expect(missing.status).toBe(404);
  expect(missing.body).toContain('listOrders');
  await page.screenshot({ path: 'test-results/rest-from-spec-run.png' });
});
