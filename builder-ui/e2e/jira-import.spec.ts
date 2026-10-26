import { expect, test } from '@playwright/test';
import { createFlow, fileMenu, interfaceItem, interfaceMenu, login, uniqueName } from './helpers';

// Interface > Import From Jira against the fake Jira of e2e/fake-jira.mjs: the story's examples
// are shown for checking (a newer response in a comment is picked over the description's), added
// to the spec with routes, and listed; Save keeps them.

const shots = process.env.ECHO_E2E_SCREENSHOTS;

test('Import From Jira makes paths, data types and routes from a story', async ({ page }) => {
  await login(page);
  const name = uniqueName('jira');
  await createFlow(page, name);
  const flowId = page.url().replace(/.*\/flows\/(\d+).*/, '$1');
  await interfaceMenu(page, /^Design/);

  await page.getByRole('button', { name: 'Import From Jira' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/Story link/).fill('http://127.0.0.1:8199/browse/PAY-142');
  if (shots) await page.screenshot({ path: `${shots}/1-story-link.png` });
  await dialog.getByRole('button', { name: 'Read Story' }).click();

  await expect(dialog.getByText('PAY-142: Pay a bill from an account')).toBeVisible();
  await expect(dialog.getByText(/Found 4 example payloads in the description and 1 comment/)).toBeVisible();
  const post = dialog.getByRole('region', { name: 'Operation 1' });
  await expect(post.getByLabel(/^Path/)).toHaveValue('/accounts/{accountId}/payments');
  await expect(post.getByLabel('Response body JSON')).toHaveValue(/expectedBy/);
  await expect(post.getByText(/several response examples here/)).toBeVisible();
  const get = dialog.getByRole('region', { name: 'Operation 2' });
  await expect(get.getByLabel('Method')).toHaveValue('GET');
  await expect(get.getByLabel(/^Path/)).toHaveValue('/accounts/{accountId}/payments?status=PENDING&limit=20');
  if (shots) await page.screenshot({ path: `${shots}/2-confirm.png` });

  await dialog.getByRole('button', { name: 'Add 2 Operations' }).click();
  await expect(dialog.getByText('Check what was added')).toBeVisible();
  await expect(dialog.getByRole('list', { name: 'Data types' })).toContainText('PostAccountsAccountIdPaymentsRequestAmount');
  await expect(dialog.getByRole('list', { name: 'Worth checking' })).toContainText('reference was null');
  if (shots) await page.screenshot({ path: `${shots}/3-review.png` });
  await dialog.getByRole('button', { name: 'Keep' }).click();

  await interfaceItem(page, 'Paths');
  const editor = page.frameLocator('iframe[title="OpenAPI editor"]');
  await expect(editor.getByText('/accounts/{accountId}/payments').first()).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/4-paths.png` });

  // The first save names the spec.
  await fileMenu(page, /^Save(?! As)/);
  await page.getByRole('dialog', { name: 'Save' }).getByRole('button', { name: 'Save' }).click();
  await expect.poll(async () => (await page.request.get(`/api/flows/${flowId}`)).json()).toMatchObject({ apiSpec: `${name}-api.yaml` });
  const spec = await (await page.request.get(`/api/flows/${flowId}/files/${name}-api.yaml`)).text();
  expect(spec).toContain('operationId: postAccountsAccountIdPayments');
  expect(spec).toContain('name: status');
  expect(spec).toContain('PostAccountsAccountIdPaymentsResponse:');
  const route = await (await page.request.get(`/api/flows/${flowId}/files/${name}.camel.yaml`)).text();
  expect(route).toContain('name: postAccountsAccountIdPayments');
  expect(route).toContain('name: getAccountsAccountIdPayments');
});
