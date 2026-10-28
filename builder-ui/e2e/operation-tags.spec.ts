import { expect, test, type Page } from '@playwright/test';
import { createFlow, login, uniqueName } from './helpers';

// The REST OpenApi step's form gets a Tag drop-down above Operation Id (ECHO's, placed in Kaoto's
// form): it lists the approved spec's tags, narrows the Operation Id drop-down to the tag's
// operations, and is not saved in the flow. A step whose operation is set starts on its tag.

const shots = process.env.ECHO_E2E_SCREENSHOTS;

async function routeCalling(page: Page, name: string, operationId?: string) {
  const id = page.url().replace(/.*\/flows\/(\d+).*/, '$1');
  const xsrf = (await page.context().cookies()).find((c) => c.name === 'XSRF-TOKEN')!.value;
  const put = await page.request.put(`/api/flows/${id}/files/${name}.camel.yaml`, {
    headers: { 'Content-Type': 'text/plain', 'X-XSRF-TOKEN': xsrf },
    data: [
      '- route:',
      `    id: ${name}`,
      '    from:',
      `      id: from-${name}`,
      `      uri: platform-http:/${name}`,
      '      steps:',
      '        - to:',
      '            id: call',
      '            uri: rest-openapi',
      '            parameters:',
      '              specificationUri: blueplanet.openapi.json',
      ...(operationId ? [`              operationId: ${operationId}`] : []),
      '',
    ].join('\n'),
  });
  expect(put.ok()).toBe(true);
  await page.reload();
  await page.getByTestId('custom-node__route.from.steps.0.to').click();
  await page.getByRole('button', { name: 'All', exact: true }).click();
}

test('Tag narrows the Operation Id drop-down to its operations', async ({ page }) => {
  await login(page);
  const name = uniqueName('tags');
  await createFlow(page, name, '', { route: false });
  await routeCalling(page, name);

  // Only the approved spec's allowed tags, A to Z.
  const tag = page.getByLabel('Tag', { exact: true });
  await expect(tag).toHaveValue('');
  await expect(tag.locator('option')).toHaveText([
    'All tags',
    'TMF638 Service Controller (9)',
    'TMF639 Resource Typed Controller (7)',
  ]);

  const operation = page.getByTestId('#.parameters.operationId__field-wrapper');
  const toggle = operation.locator('.pf-v6-c-menu-toggle__button');
  const options = page.getByTestId('#.parameters.operationId-typeahead-select').getByRole('option');
  await toggle.click();
  await expect(options.filter({ visible: true })).toHaveCount(17); // every approved spec's allowed operations (Blue Planet's 16, inventory's init)
  await toggle.click();

  await tag.selectOption('TMF639 Resource Typed Controller');
  if (shots) {
    await tag.evaluate((e) => e.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: `${shots}/1-tag-picked.png` });
  }
  await toggle.click();
  await expect(options.filter({ visible: true })).toHaveCount(7);
  await expect(options.filter({ hasText: 'createService' })).toBeHidden();
  if (shots) {
    await page.waitForTimeout(500); // the menu fades in
    await page.screenshot({ path: `${shots}/2-operations-of-the-tag.png` });
  }
  await options.filter({ hasText: /^getResource$/ }).click();
  await expect(operation.getByRole('textbox')).toHaveValue('getResource');

  // Only operationId is saved; the tag is not.
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Save(?! As)/ }).click();
  await expect(page.getByTestId('unsaved')).toBeHidden();
  const id = page.url().replace(/.*\/flows\/(\d+).*/, '$1');
  const yaml = await (await page.request.get(`/api/flows/${id}/files/${name}.camel.yaml`)).text();
  expect(yaml).toContain('operationId: getResource');
  expect(yaml).not.toMatch(/^\s*tags?:/m);
});

test('a step whose operation is set starts on its tag', async ({ page }) => {
  await login(page);
  const name = uniqueName('tagset');
  await createFlow(page, name, '', { route: false });
  await routeCalling(page, name, 'createService');
  await expect(page.getByLabel('Tag', { exact: true })).toHaveValue('TMF638 Service Controller');
  if (shots) {
    await page.getByLabel('Tag', { exact: true }).evaluate((e) => e.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: `${shots}/3-tag-of-set-operation.png` });
  }
});
