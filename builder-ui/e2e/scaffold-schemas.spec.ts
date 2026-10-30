import { expect, test, type Page } from '@playwright/test';
import { createFlow, designMenu, interfaceMenu, login, uniqueName } from './helpers';

// A POST's scaffold route maps its request before the call: that DataMapper starts from the request
// body's schema, and the reply's DataMapper from the response's. Both keep their red circle until
// something is mapped.

const shots = process.env.ECHO_E2E_SCREENSHOTS;

const spec = (base: string) =>
  [
    'openapi: 3.0.3',
    'info: { title: Orders, version: 1.0.0 }',
    `servers: [{ url: /${base} }]`,
    'paths:',
    '  /orders:',
    '    post:',
    '      requestBody:',
    "        content: { 'application/json': { schema: { $ref: '#/components/schemas/NewOrder' } } }",
    '      responses:',
    "        '201': { description: Created, content: { 'application/json': { schema: { $ref: '#/components/schemas/Order' } } } }",
    'components:',
    '  schemas:',
    '    NewOrder: { type: object, properties: { customerName: { type: string }, quantity: { type: integer } } }',
    '    Order: { type: object, properties: { orderNumber: { type: string }, status: { type: string } } }',
    '',
  ].join('\n');

async function openMapper(page: Page, node: string) {
  const mapper = page.locator(`g[data-id*="|${node}:kaoto-datamapper"]`).locator('.custom-node__container__image').first();
  await expect(mapper.locator('.echo-step-problem')).toBeVisible();
  await mapper.click();
  await page.getByText('Configure', { exact: true }).click();
}

test("a POST's DataMappers start from its request body and its response", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await login(page);
  const name = uniqueName('schemas');
  await createFlow(page, name, '', { route: false });
  const id = page.url().replace(/.*\/flows\/(\d+).*/, '$1');
  const chooser = page.waitForEvent('filechooser');
  await interfaceMenu(page, /^Upload/);
  await (await chooser).setFiles({ name: 'orders-api.yaml', mimeType: 'application/yaml', buffer: Buffer.from(spec(name)) });
  await expect(page.getByText('Added a route for POST /orders.')).toBeVisible();

  const files = async () => (await (await page.request.get(`/api/flows/${id}`)).json()).files as string[];
  await expect.poll(files).toEqual(
    expect.arrayContaining(['openapi-orders-post-request.schema.json', 'openapi-orders-post-response-201.schema.json', '.kaoto']),
  );

  await designMenu(page, /^Design/);
  await expect(page.getByTestId('custom-node__route.from').first()).toBeVisible();
  await page.getByRole('button', { name: 'Horizontal Layout' }).click();
  await page.getByRole('button', { name: 'Fit Route' }).click();
  if (shots) await page.screenshot({ path: `${shots}/1-post-scaffold.png` });

  // The request's DataMapper: its source is the request body.
  await openMapper(page, 'route.from.steps.2.multicast.steps.0.pipeline.steps.1.step');
  await expect(page.getByText('customerName').first()).toBeVisible();
  await expect(page.getByText('quantity').first()).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/2-request-source.png` });
  await designMenu(page, /^Design/);

  // The reply's DataMapper: its target is the 201 response.
  await openMapper(page, 'route.from.steps.4.step');
  await expect(page.getByText('orderNumber').first()).toBeVisible();
  await expect(page.getByText('[@key = status]').first()).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/3-reply-target.png` });
});
