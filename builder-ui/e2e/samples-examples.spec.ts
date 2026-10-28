import { expect, test, type Page } from '@playwright/test';
import { createFlow, fileMenu, interfaceItem, interfaceMenu, login, uniqueName } from './helpers';

// Interface Specs from Samples (and Import From Jira, which builds bodies the same way) keeps each sample
// payload as the named example of its body, so Apicurio lists it instead of "No examples
// defined", and Swagger UI shows it. Request validation is not affected by it. The operation it
// makes gets its route at once, as one added in the editor does.

const shots = process.env.ECHO_E2E_SCREENSHOTS;
const flowIdOf = (page: Page) => page.url().replace(/.*\/flows\/(\d+).*/, '$1');
const csrf = async (page: Page) => (await page.context().cookies()).find((c) => c.name === 'XSRF-TOKEN')!.value;

test('the sample request and response are kept as the examples of their bodies', async ({ page }) => {
  await login(page);
  const name = uniqueName('samples');
  // A new flow has no routes (as a user's flow starts).
  await createFlow(page, name, '', { route: false });
  const flowId = flowIdOf(page);
  // A path of its own (a path is in one flow only, and other tests use /cards).
  const path = `/${name.replace(/-/g, '')}`;
  await interfaceMenu(page, /^Interface Specs from Samples/);
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Method').selectOption('POST');
  await dialog.getByLabel('Path').fill(path);
  await dialog.getByLabel('Sample request (JSON)').fill('{"holder":"Ann","limit":2500}');
  await dialog.getByLabel('Sample response (JSON)').fill('{"cardId":"c-42","active":true}');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText(`Made POST ${path} from the samples: save to keep it.`)).toBeVisible();
  await expect(page.getByText(`Added a route for POST ${path}.`)).toBeVisible();

  // Apicurio lists the example of the request body and of the 200 response.
  const editor = page.frameLocator('iframe[title="OpenAPI editor"]');
  await interfaceItem(page, 'Paths');
  await editor.getByText(path, { exact: true }).first().click();
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
  await expect(page.getByText(/^Saved .*-api\.yaml\.$/)).toBeVisible();
  // The flow keeps the route it got.
  await fileMenu(page, /^Save$/);
  await expect(page.getByTestId('unsaved')).toBeHidden();
  const flow = await (await page.request.get(`/api/flows/${flowId}`)).json();
  const stored = await (await page.request.get(`/api/flows/${flowId}/files/${flow.apiSpec}`)).text();
  expect(stored).toMatch(/examples:\n\s+sample:\n\s+summary: The sample\n\s+value:\n\s+holder: Ann/);
  const operationId = stored.match(/operationId: (\S+)/)![1];

  // The spec still validates requests and serves Swagger UI with the sample as its example.
  await page.getByRole('button', { name: 'Flow', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Design/ }).click();
  const validation = page.getByRole('checkbox', { name: 'Client Request Validation' });
  await validation.click();
  await expect(validation).toBeChecked();
  await fileMenu(page, /^Save$/);
  await expect(page.getByTestId('unsaved')).toBeHidden();
  const route = await (await page.request.get(`/api/flows/${flowId}/files/${name}.camel.yaml`)).text();
  expect(route).toMatch(new RegExp(`uri: direct\\n\\s+parameters:\\n\\s+name: ${operationId}\\n`));
  // The route's REST OpenApi step waits for the operation it calls; for this run it just answers.
  const answering = route.replace(/(\n( +)steps:\n)[^]*$/, `$1$2  - setBody:\n$2      constant: ok\n`);
  expect((await page.request.put(`/api/flows/${flowId}/files/${name}.camel.yaml`, {
    data: answering,
    headers: { 'Content-Type': 'text/plain', 'X-XSRF-TOKEN': await csrf(page) },
  })).ok()).toBe(true);
  await page.reload();
  await expect(page.getByTestId('custom-node__route.from').first()).toBeVisible();
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await page.getByRole('menuitem', { name: new RegExp(`^Run ${name}(?! With\\.\\.\\.)`) }).click();
  // The Run panel's URL (the canvas shows "POST <path>" on the route already).
  await expect(page.getByText(new RegExp(`^http.*${path}$`)).first()).toBeVisible();
  const call = async (method: string, at: string, body?: string) =>
    (await page.request.post(`/api/flows/${flowId}/run/request`, {
      data: { method, path: at, contentType: 'application/json', body },
      headers: { 'X-XSRF-TOKEN': await csrf(page) },
    })).json();
  // A body like the sample passes validation and reaches the operation's route; one that is not, does not.
  const ok = await call('POST', path, '{"holder":"Ann","limit":2500}');
  expect(ok.status).toBe(200);
  const bad = await call('POST', path, '{"holder":"Ann","limit":"lots"}');
  expect(bad.status).toBe(400);
  expect(bad.body).toContain("[Path '/limit']");
  const docs = await call('GET', '/docs/openapi');
  expect(docs.status).toBe(200);
  expect(docs.body).toContain('The sample');

  const run = await (await page.request.get(`/api/flows/${flowId}/run`)).json();
  const swagger = await page.context().newPage();
  await swagger.goto(`http://localhost:${run.port}/docs`);
  await swagger.getByText(path).first().click();
  await expect(swagger.getByText('"holder": "Ann"').first()).toBeVisible();
  await expect(swagger.getByText('"cardId": "c-42"').first()).toBeVisible();
  if (shots) await swagger.screenshot({ path: `${shots}/3-swagger.png`, fullPage: true });
  await page.request.delete(`/api/flows/${flowId}/run`, { headers: { 'X-XSRF-TOKEN': await csrf(page) } });
});

test('a response under Responses set to a data type made from a sample gets the sample as its example at once', async ({ page }) => {
  await login(page);
  const name = uniqueName('nodes');
  await createFlow(page, name);
  await interfaceMenu(page, /^Design/);
  // The Interface Specs bar has the same item as a button, right before Save.
  const fromSamples = page.getByRole('button', { name: 'Interface Specs from Samples', exact: true });
  const fromSamplesBox = (await fromSamples.boundingBox())!;
  const saveBox = (await page.locator('.echo-api-spec__bar').getByRole('button', { name: 'Save', exact: true }).boundingBox())!;
  expect(fromSamplesBox.x + fromSamplesBox.width).toBeLessThanOrEqual(saveBox.x);
  expect(saveBox.x - (fromSamplesBox.x + fromSamplesBox.width)).toBeLessThan(24);
  if (shots) await page.locator('.echo-api-spec__bar').screenshot({ path: `${shots}/interface-bar.png` });
  await fromSamples.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Method').selectOption('GET');
  await dialog.getByLabel('Path').fill(`/${name.replace(/-/g, '')}`);
  await dialog.getByLabel('Sample response (JSON)').fill('{"name":"n1","rack":null}');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toBeHidden();

  // A reusable response, set by hand to the data type New From Samples made.
  const editor = page.frameLocator('iframe[title="OpenAPI editor"]');
  const form = editor.locator('response-form');
  await interfaceItem(page, 'Responses');
  await editor.locator('button[title="Create Response"]').click();
  await editor.getByRole('textbox', { name: 'Name*' }).fill('GetNodeSuccess');
  await editor.getByRole('button', { name: 'Save' }).first().click();
  await form.getByText('Add a media type').click();
  await editor.getByRole('dialog').getByRole('button', { name: 'Add' }).click();
  await form.locator('.media-type .type').click();
  await form.getByRole('button', { name: /Choose Type/ }).click();
  await form.getByText(/Response$/).last().click();

  // Picking the type adds its sample as the example, before any Save.
  await expect(form.getByText('1 example(s) defined.')).toBeVisible();
  await expect(form.getByRole('row', { name: /^sample .*"name":"n1"/ })).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/4-response-component-example.png` });
  await fileMenu(page, /^Save(?! As)/);
  const save = page.getByRole('dialog', { name: 'Save' });
  await save.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('unsaved')).toBeHidden();
  const flow = await (await page.request.get(`/api/flows/${flowIdOf(page)}`)).json();
  const stored = await (await page.request.get(`/api/flows/${flowIdOf(page)}/files/${flow.apiSpec}`)).text();
  expect(stored).toMatch(/GetNodeSuccess:[^]*examples:\n\s+sample:\n(\s+summary: The sample\n)?\s+value:\n\s+name: n1/);

  // It is an ordinary edit: undo takes it back, and the type stays.
  await editor.getByTitle('Click to undo the last change.').click();
  await expect(form.getByText('No examples defined.')).toBeVisible();
  await expect(form.getByText(/Response$/).first()).toBeVisible();
});

test('Add to this spec adds a method from samples to the spec the flow has, or replaces one it has, keeping its route', async ({ page }) => {
  await login(page);
  const name = uniqueName('addsamples');
  await createFlow(page, name, '', { route: false });
  const flowId = flowIdOf(page);
  const path = `/${name.replace(/-/g, '')}`;
  await interfaceMenu(page, /^Interface Specs from Samples/);
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Method').selectOption('GET');
  await dialog.getByLabel('Path').fill(`${path}/{id}`);
  await dialog.getByLabel('Sample response (JSON)').fill('{"id":"c-1","status":"ACTIVE"}');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText(`Made GET ${path}/{id} from the samples: save to keep it.`)).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const save = page.getByRole('dialog');
  if (await save.isVisible().catch(() => false)) await save.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/^Saved .*-api\.yaml\.$/)).toBeVisible();

  // The flow has a spec now: Add to this spec, beside Replace; a method it has already is offered for replacing.
  await page.getByRole('button', { name: 'Interface Specs from Samples', exact: true }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Replace Whole Spec' })).toBeVisible();
  await dialog.getByLabel('Method').selectOption('GET');
  await dialog.getByLabel('Path').fill(`${path}/{cardId}`);
  await dialog.getByLabel('Sample response (JSON)').fill('{"id":"c-1"}');
  await expect(dialog.getByRole('button', { name: `Replace GET ${path}/{cardId}` })).toBeEnabled();
  await expect(dialog.getByText(`This spec has GET ${path}/{cardId} already.`)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Replace Whole Spec' })).toBeVisible();
  await dialog.getByText(`This spec has GET ${path}/{cardId} already.`).scrollIntoViewIfNeeded();
  if (shots) {
    await page.waitForTimeout(500); // the buttons fade in after the samples are filled in
    await page.screenshot({ path: `${shots}/6-replace-one-method.png` });
  }
  await dialog.getByLabel('Method').selectOption('PUT');
  const add = dialog.getByRole('button', { name: 'Add to this spec' });
  await dialog.getByLabel('Sample request (JSON)').fill('{"status":"BLOCKED"}');
  await expect(add).toBeEnabled();
  if (shots) await page.screenshot({ path: `${shots}/5-add-to-this-spec.png` });
  await add.click();
  await expect(page.getByText(`Added PUT ${path}/{id} from the samples: save to keep it.`)).toBeVisible();
  await expect(page.getByText(`Added a route for PUT ${path}/{id}.`)).toBeVisible();

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/^Saved .*-api\.yaml\.$/)).toBeVisible();
  await fileMenu(page, /^Save$/);
  await expect(page.getByTestId('unsaved')).toBeHidden();
  const flow = await (await page.request.get(`/api/flows/${flowId}`)).json();
  const stored = await (await page.request.get(`/api/flows/${flowId}/files/${flow.apiSpec}`)).text();
  // Both methods under the one path, each with its own data types.
  expect(stored.match(new RegExp(`^  ${path.replace(/\//g, '\\/')}\\/\\{id\\}:`, 'gm'))).toHaveLength(1);
  expect(stored).toMatch(/\n {4}get:\n/);
  expect(stored).toMatch(/\n {4}put:\n/);
  expect(stored).toMatch(/\n {4}Get\w+IdResponse:\n/);
  expect(stored).toMatch(/\n {4}Put\w+IdRequest:\n/);
  let route = await (await page.request.get(`/api/flows/${flowId}/files/${name}.camel.yaml`)).text();
  expect(route.match(/uri: direct\n/g)).toHaveLength(2);

  // Replace GET: the one made from the new samples takes its place; its route stays, no route is added.
  await page.getByRole('button', { name: 'Interface Specs from Samples', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Method').selectOption('GET');
  await dialog.getByLabel('Path').fill(`${path}/{id}`);
  await dialog.getByLabel('Sample response (JSON)').fill('{"id":"c-1","limit":2500}');
  await dialog.getByRole('button', { name: `Replace GET ${path}/{id}` }).click();
  await expect(page.getByText(`Replaced GET ${path}/{id} from the samples: save to keep it.`)).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/^Saved .*-api\.yaml\.$/)).toBeVisible();
  await fileMenu(page, /^Save$/);
  await expect(page.getByTestId('unsaved')).toBeHidden();
  const replaced = await (await page.request.get(`/api/flows/${flowId}/files/${flow.apiSpec}`)).text();
  expect(replaced).toContain('limit:');
  expect(replaced).not.toContain('status: ACTIVE');
  expect(replaced).not.toMatch(/IdResponse2:/);
  route = await (await page.request.get(`/api/flows/${flowId}/files/${name}.camel.yaml`)).text();
  expect(route.match(/uri: direct\n/g)).toHaveLength(2);
});
