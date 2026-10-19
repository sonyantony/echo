import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { login, uniqueName } from './helpers';

// M10 (Builder part of the demo): the golden "orders" flow, with its two DataMapper mappings,
// opens in the editor, validates and publishes. docs/demo.md continues with the pipeline.
const samples = fileURLToPath(new URL('../../samples/flows/orders/', import.meta.url));
const git = (...args: string[]) =>
  execFileSync('git', ['--git-dir', process.env.ECHO_E2E_GIT_REPO!, ...args], { encoding: 'utf8' });

test('the orders flow with DataMapper validates and publishes', async ({ page }) => {
  await login(page);
  const name = uniqueName('orders');

  // Create the flow, then load the golden files into the draft through the API
  // (what a designer builds on the canvas and in the DataMapper).
  const xsrf = async () => (await page.context().cookies()).find((c) => c.name === 'XSRF-TOKEN')?.value ?? '';
  const created = await page.request.post('/api/flows', {
    data: { name, description: 'Order intake demo' },
    headers: { 'X-XSRF-TOKEN': await xsrf() },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  for (const file of readdirSync(samples)) {
    if (file === 'sample-request.json') continue;
    const target = file === 'orders.camel.yaml' ? `${name}.camel.yaml` : file;
    const response = await page.request.put(`/api/flows/${id}/files/${target}`, {
      data: readFileSync(samples + file, 'utf8'),
      headers: { 'Content-Type': 'text/plain', 'X-XSRF-TOKEN': await xsrf() },
    });
    expect(response.status(), file).toBe(204);
  }

  await page.goto(`/flows/${id}`);
  await expect(page.getByTestId('custom-node__route.from')).toBeVisible();
  await expect(page.getByText('kaoto-datamapper').first()).toBeVisible();

  // The request mapping shows the attached JSON schemas on both sides.
  await page.evaluate(() => (window.location.hash = '#/datamapper/kaoto-datamapper-order-request'));
  await expect(page.locator('[data-testid^="node-source-fj-string-orderId"]')).toBeVisible();
  await expect(page.locator('[data-testid^="node-target-fj-array-lines"]')).toBeVisible();
  await page.evaluate(() => (window.location.hash = '#/'));

  await page.getByRole('button', { name: 'Validate' }).click();
  await expect(page.getByTestId('validation-result')).toContainText('The flow is valid.');

  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Description').fill('Orders flow for the demo');
  await page.getByRole('dialog').getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText(/Published to Git \(main, [0-9a-f]{8}\)\./)).toBeVisible();

  const published = git('ls-tree', '--name-only', `main:flows/${name}`).trim().split('\n');
  expect(published).toEqual(
    expect.arrayContaining([
      `${name}.camel.yaml`,
      'kaoto-datamapper-order-request.xsl',
      'kaoto-datamapper-order-response.xsl',
      'order-request.schema.json',
      'application.properties',
      'echo-flow.json',
      '.kaoto',
    ]),
  );
  expect(git('show', `main:flows/${name}/kaoto-datamapper-order-request.xsl`)).toContain('xml-to-json($mapped-xml)');
});
