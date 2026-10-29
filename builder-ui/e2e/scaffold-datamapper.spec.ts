import { expect, test } from '@playwright/test';
import { createFlow, designMenu, interfaceItem, interfaceMenu, login, uniqueName } from './helpers';

// The DataMapper in a scaffold route opens with Configure. Opening it saves its .xsl and the
// .kaoto metadata at once; the second save used to fail on the flow's version, leaving a spinner.

test('Configure opens the DataMapper of a scaffold route', async ({ page }) => {
  await login(page);
  const name = uniqueName('dmscaffold');
  await createFlow(page, name, '', { route: false });
  const id = page.url().replace(/.*\/flows\/(\d+).*/, '$1');
  await interfaceMenu(page, /^Design/);
  const editor = page.frameLocator('iframe[title="OpenAPI editor"]');
  await interfaceItem(page, 'Paths');
  await editor.getByText('Add a path').click();
  const addPath = editor.getByRole('dialog', { name: 'Add Path' });
  const path = `/${name.replace(/-/g, '')}`;
  await addPath.getByRole('textbox').fill(path);
  await addPath.getByRole('button', { name: 'Add' }).click();
  await editor.locator('.operation-tab').getByText('Get', { exact: true }).click();
  await editor.getByRole('button', { name: 'Add Operation' }).click();
  await expect(page.getByText(`Added a route for GET ${path}.`)).toBeVisible();

  await designMenu(page, /^Design/);
  await expect(page.getByTestId('custom-node__route.from').first()).toBeVisible();
  // The DataMapper is the last step reading Attention.
  await page.getByText('Attention', { exact: true }).last().click();
  await page.getByText('Configure', { exact: true }).click();
  await expect(page.getByTestId('attach-schema-sourceBody-Body-button')).toBeVisible();
  const files = async () => (await (await page.request.get(`/api/flows/${id}`)).json()).files as string[];
  await expect.poll(files).toEqual(expect.arrayContaining(['.kaoto', expect.stringMatching(/^kaoto-datamapper-.*\.xsl$/)]));
});
