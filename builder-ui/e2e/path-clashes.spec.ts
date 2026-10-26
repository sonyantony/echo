import { expect, test, type Page } from '@playwright/test';
import { createFlow, fileMenu, interfaceItem, interfaceMenu, login, uniqueName } from './helpers';

// A path is in one flow only (decision 0015): /x and /x/{id} count as one, whatever the methods.
// A path added in Interface that another flow has offers to switch to that flow; uploads with such
// paths are refused.

const shots = process.env.ECHO_E2E_SCREENSHOTS;
const editorOf = (page: Page) => page.frameLocator('iframe[title="OpenAPI editor"]');
const flowIdOf = (page: Page) => page.url().replace(/.*\/flows\/(\d+).*/, '$1');

const spec = (basePath: string, path: string) =>
  [
    'openapi: 3.0.3',
    'info: { title: Shoes, version: 1.0.0 }',
    `servers: [{ url: ${basePath} }]`,
    'paths:',
    `  ${path}:`,
    '    get:',
    "      responses: { '200': { description: ok } }",
    '',
  ].join('\n');

async function upload(page: Page, text: string) {
  const chooser = page.waitForEvent('filechooser');
  await interfaceMenu(page, /^Upload/);
  await (await chooser).setFiles({ name: 'shoes-api.yaml', mimeType: 'application/yaml', buffer: Buffer.from(text) });
}

test('a path another flow has is refused on upload, and adding it in Interface offers to switch to that flow', async ({ page }) => {
  await login(page);
  const basePath = `/${uniqueName('shop')}`;
  const shoeShop = uniqueName('Shoe Shop');
  await createFlow(page, shoeShop);
  const shoeShopId = flowIdOf(page);
  await upload(page, spec(basePath, '/shoes/{id}'));
  await expect.poll(async () => (await page.request.get(`/api/flows/${shoeShopId}/files/shoes-api.yaml`)).status()).toBe(200);
  // The upload added a route on the canvas: save it before moving on.
  await fileMenu(page, /^Save(?! As)/);
  await expect(page.getByTestId('unsaved')).toBeHidden();

  // Another flow cannot take a spec with /shoes (the same path as /shoes/{id}) under that Base Path.
  const boots = uniqueName('Boots');
  await createFlow(page, boots);
  const bootsId = flowIdOf(page);
  await upload(page, spec(basePath, '/shoes'));
  const refused = page.getByRole('dialog', { name: 'shoes-api.yaml cannot be uploaded' });
  await expect(refused).toContainText(`${basePath}/shoes is in flow ${shoeShop} (as ${basePath}/shoes/{id})`);
  if (shots) await page.screenshot({ path: `${shots}/1-upload-refused.png` });
  await refused.getByRole('contentinfo').getByRole('button', { name: 'Close' }).click();

  // A spec of its own with /boots, then the user adds /shoes/{shoeId} by hand.
  await upload(page, spec(basePath, '/boots'));
  await expect.poll(async () => (await page.request.get(`/api/flows/${bootsId}/files/shoes-api.yaml`)).status()).toBe(200);
  const editor = editorOf(page);
  await interfaceItem(page, 'Paths');
  await editor.locator('.editor-outline icon-button[type=add] button').first().click();
  const addPath = editor.getByRole('dialog', { name: 'Add Path' });
  await addPath.getByRole('textbox').fill('/shoes/{shoeId}');
  await addPath.getByRole('button', { name: 'Add' }).click();

  const clash = page.getByRole('dialog', { name: 'This path is in another flow' });
  await expect(clash).toContainText(`${basePath}/shoes/{shoeId} is already in flow ${shoeShop} (as ${basePath}/shoes/{id})`);
  if (shots) await page.screenshot({ path: `${shots}/2-path-in-another-flow.png` });

  // Switch: this flow is saved without the path, and the other flow opens.
  await clash.getByRole('button', { name: `Switch to ${shoeShop}` }).click();
  await expect(page).toHaveURL(new RegExp(`/flows/${shoeShopId}$`));
  await expect(page.getByText(`Flow: ${shoeShop}`)).toBeVisible();
  const saved = await (await page.request.get(`/api/flows/${bootsId}/files/shoes-api.yaml`)).text();
  expect(saved).toContain('/boots');
  expect(saved).not.toContain('/shoes');
  if (shots) await page.screenshot({ path: `${shots}/3-switched.png` });
});

test('Remove the path here keeps working on this flow without the path', async ({ page }) => {
  await login(page);
  const basePath = `/${uniqueName('shop')}`;
  const hats = uniqueName('Hats');
  await createFlow(page, hats);
  await upload(page, spec(basePath, '/hats'));
  await expect.poll(async () => (await page.request.get(`/api/flows/${flowIdOf(page)}/files/shoes-api.yaml`)).status()).toBe(200);
  await fileMenu(page, /^Save(?! As)/);
  await expect(page.getByTestId('unsaved')).toBeHidden();

  const caps = uniqueName('Caps');
  await createFlow(page, caps);
  const capsId = flowIdOf(page);
  await upload(page, spec(basePath, '/caps'));
  await expect.poll(async () => (await page.request.get(`/api/flows/${capsId}/files/shoes-api.yaml`)).status()).toBe(200);
  const editor = editorOf(page);
  await interfaceItem(page, 'Paths');
  await editor.locator('.editor-outline icon-button[type=add] button').first().click();
  const addPath = editor.getByRole('dialog', { name: 'Add Path' });
  await addPath.getByRole('textbox').fill('/hats/{id}');
  await addPath.getByRole('button', { name: 'Add' }).click();

  const clash = page.getByRole('dialog', { name: 'This path is in another flow' });
  await clash.getByRole('button', { name: 'Remove the path here' }).click();
  await expect(clash).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/flows/${capsId}/api$`));
  await interfaceItem(page, 'Paths');
  await expect(editor.getByText('/caps', { exact: true })).toBeVisible();
  await expect(editor.getByText('/hats/{id}')).toBeHidden();
  await fileMenu(page, /^Save(?! As)/);
  expect(await (await page.request.get(`/api/flows/${capsId}/files/shoes-api.yaml`)).text()).not.toContain('/hats');
});
