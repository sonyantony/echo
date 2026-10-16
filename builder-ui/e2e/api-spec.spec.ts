import { expect, test } from '@playwright/test';
import { createFlow, login, uniqueName } from './helpers';

// V2: a flow's OpenAPI spec is designed in Apicurio's editor, and a data type's schema can be
// generated from a sample JSON. The spec is saved as openapi.json next to the flow's Camel YAML.
test('a schema made from a sample JSON is saved in the flow as openapi.json', async ({ page }) => {
  await login(page);
  const name = uniqueName('spec');
  await createFlow(page, name);
  const flowId = page.url().split('/').pop();

  await page.getByRole('button', { name: 'API spec' }).click();
  await expect(page).toHaveURL(new RegExp(`/flows/${flowId}/api$`));
  const editor = page.frameLocator('iframe[title="OpenAPI editor"]');
  await expect(editor.getByText(name).first()).toBeVisible();

  await editor.getByText('Add a data type').click();
  await editor.getByPlaceholder('Enter a unique data type name.').fill('Order');
  await editor.locator('.ace_editor').nth(1).click();
  await page.keyboard.insertText('{"orderId":"A1","quantity":2,"customer":{"name":"Ann"},"lines":[{"sku":"X"}]}');
  await expect(editor.locator('.ace_editor').nth(1)).toContainText('"lines"');
  // The dialog reads the example after a short pause in typing.
  await page.waitForTimeout(1000);
  await editor.getByRole('button', { name: 'Save' }).first().click();
  await expect(page.getByTestId('unsaved')).toBeVisible();

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved.')).toBeVisible();

  const response = await page.request.get(`/api/flows/${flowId}/files/openapi.json`);
  expect(response.status()).toBe(200);
  const spec = await response.json();
  expect(spec.info.title).toBe(name);
  const order = spec.components.schemas.Order;
  expect(order.properties.orderId.type).toBe('string');
  expect(order.properties.quantity.type).toBe('integer');
  expect(order.properties.customer.properties.name.type).toBe('string');
  expect(order.properties.lines.type).toBe('array');

  // The saved spec opens again from the flow folder.
  await page.getByRole('link', { name: 'Back to the flow' }).click();
  await expect(page.getByTestId('custom-node__route.from')).toBeVisible();
  await page.getByRole('button', { name: 'API spec' }).click();
  await expect(editor.getByText('Order', { exact: true })).toBeVisible();
});
