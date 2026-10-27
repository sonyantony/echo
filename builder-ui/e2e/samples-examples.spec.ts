import { expect, test, type Page } from '@playwright/test';
import { createFlow, fileMenu, interfaceItem, interfaceMenu, login, uniqueName } from './helpers';

// New From Samples (and Import From Jira, which builds bodies the same way) keeps each sample
// payload as the named example of its body, so Apicurio lists it instead of "No examples
// defined", and Swagger UI shows it. Request validation is not affected by it.

const shots = process.env.ECHO_E2E_SCREENSHOTS;
const flowIdOf = (page: Page) => page.url().replace(/.*\/flows\/(\d+).*/, '$1');
const csrf = async (page: Page) => (await page.context().cookies()).find((c) => c.name === 'XSRF-TOKEN')!.value;

test('the sample request and response are kept as the examples of their bodies', async ({ page }) => {
  await login(page);
  const name = uniqueName('samples');
  await createFlow(page, name);
  const flowId = flowIdOf(page);
  await interfaceMenu(page, /^New From Samples/);
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Method').selectOption('POST');
  await dialog.getByLabel('Path').fill('/cards');
  await dialog.getByLabel('Sample request (JSON)').fill('{"holder":"Ann","limit":2500}');
  await dialog.getByLabel('Sample response (JSON)').fill('{"cardId":"c-42","active":true}');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText(/Made POST \/cards from the samples/)).toBeVisible();

  // Apicurio lists the example of the request body and of the 200 response.
  const editor = page.frameLocator('iframe[title="OpenAPI editor"]');
  await interfaceItem(page, 'Paths');
  await editor.getByText('/cards', { exact: true }).first().click();
  const defined = editor.getByText('1 example(s) defined.');
  await expect(defined).toHaveCount(2);
  await expect(editor.getByText('No examples defined.')).toHaveCount(0);
  await defined.last().scrollIntoViewIfNeeded();
  if (shots) await page.screenshot({ path: `${shots}/1-response-example.png` });
  await defined.last().click();
  await expect(editor.getByRole('row', { name: /^sample .*"cardId":"c-42"/ })).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/2-response-example-open.png` });

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const save = page.getByRole('dialog');
  if (await save.isVisible().catch(() => false)) await save.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('unsaved')).toBeHidden();
  const flow = await (await page.request.get(`/api/flows/${flowId}`)).json();
  const stored = await (await page.request.get(`/api/flows/${flowId}/files/${flow.apiSpec}`)).text();
  expect(stored).toMatch(/examples:\n\s+sample:\n\s+summary: The sample\n\s+value:\n\s+holder: Ann/);

  // The spec still validates requests and serves Swagger UI with the sample as its example.
  await page.getByRole('button', { name: 'Flow', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Design/ }).click();
  const validation = page.getByRole('checkbox', { name: 'Client Request Validation' });
  await validation.click();
  await expect(validation).toBeChecked();
  await fileMenu(page, /^Save$/);
  await expect(page.getByTestId('unsaved')).toBeHidden();
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await page.getByRole('menuitem', { name: new RegExp(`^Run ${name}`) }).click();
  await expect(page.getByText(/\/cards$/).first()).toBeVisible();
  const call = async (method: string, path: string, body?: string) =>
    (await page.request.post(`/api/flows/${flowId}/run/request`, {
      data: { method, path, contentType: 'application/json', body },
      headers: { 'X-XSRF-TOKEN': await csrf(page) },
    })).json();
  // A body like the sample passes validation (and meets the operation's missing route); one that is not, does not.
  const ok = await call('POST', '/cards', '{"holder":"Ann","limit":2500}');
  expect(ok.status).toBe(404);
  expect(ok.body).toContain('does not implement the operation postCards');
  const bad = await call('POST', '/cards', '{"holder":"Ann","limit":"lots"}');
  expect(bad.status).toBe(400);
  expect(bad.body).toContain("[Path '/limit']");
  const docs = await call('GET', '/docs/openapi');
  expect(docs.status).toBe(200);
  expect(docs.body).toContain('The sample');

  const run = await (await page.request.get(`/api/flows/${flowId}/run`)).json();
  const swagger = await page.context().newPage();
  await swagger.goto(`http://localhost:${run.port}/docs`);
  await swagger.getByText('/cards').first().click();
  await expect(swagger.getByText('"holder": "Ann"').first()).toBeVisible();
  await expect(swagger.getByText('"cardId": "c-42"').first()).toBeVisible();
  if (shots) await swagger.screenshot({ path: `${shots}/3-swagger.png`, fullPage: true });
  await page.request.delete(`/api/flows/${flowId}/run`, { headers: { 'X-XSRF-TOKEN': await csrf(page) } });
});
