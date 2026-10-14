import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// M1 spike: Kaoto is embedded, loads YAML, hands back edited YAML, and the DataMapper maps JSON to JSON.
const samples = fileURLToPath(new URL('../../samples/flows/orders/', import.meta.url));

async function attachJsonSchema(page: Page, side: 'source' | 'target', file: string) {
  await page.getByTestId(`attach-schema-${side}Body-Body-button`).click();
  await page.getByTestId('attach-schema-modal-option-json').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('attach-schema-modal-btn-file').click();
  await (await chooser).setFiles(samples + file);
  await expect(page.getByTestId('attach-schema-no-files')).toHaveCount(0);
  await page.getByTestId('attach-schema-modal-btn-attach').click();
}

async function dragField(page: Page, from: string, to: string) {
  const a = (await page.locator(`[data-testid^="${from}"]`).first().boundingBox())!;
  const b = (await page.locator(`[data-testid^="${to}"]`).first().boundingBox())!;
  await page.mouse.move(a.x + 40, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + 60, a.y + a.height / 2 + 5, { steps: 5 });
  await page.mouse.move(b.x + 40, b.y + b.height / 2, { steps: 20 });
  await page.mouse.up();
}

async function flowFiles(page: Page): Promise<Record<string, string>> {
  await page.getByTestId('read-yaml').click();
  return JSON.parse((await page.getByTestId('files-out').textContent()) ?? '{}');
}

test('Kaoto renders the orders flow and returns its YAML', async ({ page }) => {
  await page.goto('/playground');
  await expect(page.locator('[data-testid^="custom-node__"]').first()).toBeVisible();
  await expect(page.getByText('kaoto-datamapper').first()).toBeVisible();

  await page.getByTestId('read-yaml').click();
  await expect(page.getByTestId('yaml-out')).toContainText('uri: platform-http:/orders');
  await expect(page.getByTestId('yaml-out')).toContainText('xslt-saxon:');
});

test('DataMapper maps JSON fields using JSON schemas', async ({ page }) => {
  await page.goto('/playground');
  await expect(page.locator('[data-testid^="custom-node__"]').first()).toBeVisible();
  await page.evaluate(() => (window.location.hash = '#/datamapper/kaoto-datamapper-order-request'));

  await attachJsonSchema(page, 'source', 'order-request.schema.json');
  await attachJsonSchema(page, 'target', 'fulfilment-request.schema.json');
  await expect(page.locator('[data-testid^="node-source-fj-string-orderId"]')).toBeVisible();
  await expect(page.locator('[data-testid^="node-target-fj-string-reference"]')).toBeVisible();

  await dragField(page, 'node-source-fj-string-orderId', 'node-target-fj-string-reference');

  await expect
    .poll(async () => (await flowFiles(page))['kaoto-datamapper-order-request.xsl'] ?? '')
    .toContain("<xsl:value-of select=\"/fn:map/fn:string[@key='orderId']\"/>");
  const files = await flowFiles(page);
  expect(files['kaoto-datamapper-order-request.xsl']).toContain('xml-to-json($mapped-xml)');
  expect(files['order-request.schema.json']).toBeDefined();
  expect(JSON.parse(files['.kaoto'])['kaoto-datamapper-order-request'].sourceBody.type).toBe('JSON Schema');
});
