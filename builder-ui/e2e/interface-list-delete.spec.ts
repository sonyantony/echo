import { expect, test } from '@playwright/test';
import { createFlow, interfaceItem, interfaceMenu, login, uniqueName } from './helpers';

// Data Types and Responses in the Interface's right pane have a Delete button on each entry, so an
// entry can be deleted without opening it. It deletes as the entry's right-click Delete does.
// An opened entry's icon (before its name) goes back to its list.

const shots = process.env.ECHO_SCREENSHOTS;

test('data types and responses are deleted from their list without opening them', async ({ page }) => {
  await login(page);
  await createFlow(page, uniqueName('delete-entries'));
  await interfaceMenu(page, /^Design/);
  const editor = page.frameLocator('iframe[title="OpenAPI editor"]');

  const addType = async (name: string) => {
    await interfaceItem(page, 'Data Types');
    await editor.locator('button[title="Create Data Type"]').click();
    await editor.getByPlaceholder('Enter a unique data type name.').fill(name);
    await editor.getByRole('button', { name: 'Save' }).first().click();
    await expect(editor.locator('definition-form')).toBeVisible();
  };
  const addResponse = async (name: string) => {
    await interfaceItem(page, 'Responses');
    await editor.locator('button[title="Create Response"]').click();
    await editor.getByRole('textbox', { name: 'Name*' }).fill(name);
    await editor.getByRole('button', { name: 'Save' }).first().click();
    await expect(editor.locator('response-form')).toBeVisible();
  };
  await addType('Customer');
  await addType('Order');
  await addResponse('GetNodeResponse');
  await addResponse('ErrorResponse');

  const types = editor.locator('.definition-section .api-definition');
  await interfaceItem(page, 'Data Types');
  await expect(types).toHaveText(['Customer', 'Order']);
  await expect(editor.getByRole('button', { name: 'Delete Customer' })).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/1-data-types.png` });

  // Delete takes the entry away and leaves the list showing: nothing was opened.
  await editor.getByRole('button', { name: 'Delete Customer' }).click();
  await expect(types).toHaveText(['Order']);
  await expect(editor.locator('.definition-section')).toBeVisible();
  await expect(editor.locator('definition-form')).toBeHidden();
  await expect(editor.locator('#definition-context-menu')).toHaveCount(0);
  await expect(editor.locator('.echo-nav-item', { hasText: 'Data Types' })).toHaveText('Data Types(1)');

  // It is Apicurio's own delete, so undo brings it back.
  await editor.getByTitle('Click to undo the last change.').click();
  await interfaceItem(page, 'Data Types');
  await expect(types).toHaveText(['Customer', 'Order']);

  const responses = editor.locator('.response-section .api-response');
  await interfaceItem(page, 'Responses');
  await expect(responses).toHaveText(['ErrorResponse', 'GetNodeResponse']);
  if (shots) await page.screenshot({ path: `${shots}/2-responses.png` });
  await editor.getByRole('button', { name: 'Delete ErrorResponse' }).click();
  await expect(responses).toHaveText(['GetNodeResponse']);
  await expect(editor.locator('.response-section')).toBeVisible();
  await expect(editor.locator('response-form')).toBeHidden();
  if (shots) await page.screenshot({ path: `${shots}/3-response-deleted.png` });
  await expect(page.getByTestId('unsaved')).toBeVisible();
});

test("an opened data type's or response's icon goes back to its list", async ({ page }) => {
  await login(page);
  await createFlow(page, uniqueName('back-icon'));
  await interfaceMenu(page, /^Design/);
  const editor = page.frameLocator('iframe[title="OpenAPI editor"]');

  await interfaceItem(page, 'Responses');
  await editor.locator('button[title="Create Response"]').click();
  await editor.getByRole('textbox', { name: 'Name*' }).fill('GetNodeResponse');
  await editor.getByRole('button', { name: 'Save' }).first().click();
  await expect(editor.locator('response-form')).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/4-response-opened.png` });
  await editor.getByRole('button', { name: 'Back to Responses' }).click();
  await expect(editor.locator('.response-section .api-response')).toHaveText(['GetNodeResponse']);
  await expect(editor.locator('.response-section')).toBeVisible();
  await expect(editor.locator('response-form')).toBeHidden();
  if (shots) await page.screenshot({ path: `${shots}/5-back-to-responses.png` });

  await interfaceItem(page, 'Data Types');
  await editor.locator('button[title="Create Data Type"]').click();
  await editor.getByPlaceholder('Enter a unique data type name.').fill('Customer');
  await editor.getByRole('button', { name: 'Save' }).first().click();
  await expect(editor.locator('definition-form')).toBeVisible();
  await editor.getByRole('button', { name: 'Back to Data Types' }).click();
  await expect(editor.locator('.definition-section .api-definition')).toHaveText(['Customer']);
  await expect(editor.locator('.definition-section')).toBeVisible();
});
