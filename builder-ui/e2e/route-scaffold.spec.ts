import { expect, test, type Page } from '@playwright/test';
import YAML from 'yaml';
import { createFlow, designMenu, fileMenu, interfaceItem, interfaceMenu, login, uniqueName } from './helpers';

// The route a method added in Interface Specs gets is a scaffold (decision 0013): a Set Variable
// for each of its parameters, Remove Headers *, a multicast with one pipeline calling a REST
// OpenApi step, and a JSON reply. Parameters added later get their Set Variable too.

const shots = process.env.ECHO_E2E_SCREENSHOTS;
const flowIdOf = (page: Page) => page.url().replace(/.*\/flows\/(\d+).*/, '$1');

type Step = Record<string, { name?: string; simple?: string; steps?: Step[]; uri?: string }>;

test('a new method gets a scaffold route, and a query parameter added later gets its variable', async ({ page }) => {
  await login(page);
  const name = uniqueName('scaffold');
  await createFlow(page, name, '', { route: false });
  const routeFile = `/api/flows/${flowIdOf(page)}/files/${name}.camel.yaml`;
  const steps = async () => {
    await fileMenu(page, /^Save(?! As)/);
    await expect(page.getByTestId('unsaved')).toBeHidden();
    const entries = YAML.parse(await (await page.request.get(routeFile)).text()) as { route?: { from: { steps: Step[] } } }[];
    return entries.find((e) => e.route)!.route!.from.steps;
  };

  await interfaceMenu(page, /^Design/);
  const editor = page.frameLocator('iframe[title="OpenAPI editor"]');
  await interfaceItem(page, 'Paths');
  await editor.getByText('Add a path').click();
  const addPath = editor.getByRole('dialog', { name: 'Add Path' });
  const path = `/${name.replace(/-/g, '')}/{orderId}`;
  await addPath.getByRole('textbox').fill(path);
  await addPath.getByRole('button', { name: 'Add' }).click();
  await editor.locator('.operation-tab').getByText('Get', { exact: true }).click();
  await editor.getByRole('button', { name: 'Add Operation' }).click();
  await expect(page.getByText(`Added a route for GET ${path}.`)).toBeVisible();
  // The spec is named once.
  await fileMenu(page, /^Save(?! As)/);
  await page.getByRole('dialog', { name: 'Save' }).getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(`Saved ${name}-api.yaml.`)).toBeVisible();

  let made = await steps();
  expect(made.map((s) => Object.keys(s)[0])).toEqual(['setVariable', 'removeHeaders', 'multicast', 'setBody', 'setHeader']);
  expect(made[0].setVariable).toMatchObject({ name: 'orderId', simple: '${header.orderId}' });
  const branch = made[2].multicast.steps![0].pipeline.steps!;
  expect(branch.map((s) => Object.keys(s)[0])).toEqual(['to', 'convertBodyTo', 'setBody']);
  expect(branch[0].to.uri).toBe('rest-openapi');

  // A query parameter added to the method: the route, still as ECHO made it, gets its variable.
  await editor.getByTitle('Add a new query parameter.').last().click();
  const nameField = editor.getByRole('textbox', { name: 'Name*' });
  await nameField.fill('status');
  await editor.getByRole('button', { name: 'Save', exact: true }).last().click();
  await expect(nameField).toBeHidden();
  await expect.poll(async () => (await steps()).filter((s) => s.setVariable).map((s) => s.setVariable.name)).toEqual(['orderId', 'status']);

  await designMenu(page, /^Design/);
  await expect(page.getByTestId('custom-node__route.from').first()).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/1-scaffold-route.png` });
});
