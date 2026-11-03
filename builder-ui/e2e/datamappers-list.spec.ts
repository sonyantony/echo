import { expect, test, type Page } from '@playwright/test';
import { createFlow, login, uniqueName } from './helpers';

// The Datamappers tab lists the flow's DataMappers by the names the canvas shows (their
// descriptions); clicking one opens it, and its arrow goes back to the list.

const dataMapper = (id: string, description?: string) => [
  '        - step:',
  `            id: ${id}`,
  ...(description ? [`            description: ${description}`] : []),
  '            steps:',
  '              - to:',
  `                  id: ${id}-xslt`,
  `                  uri: xslt-saxon:${id}.xsl`,
];

async function putRoutes(page: Page, name: string) {
  const id = page.url().replace(/.*\/flows\/(\d+).*/, '$1');
  const flow = await (await page.request.get(`/api/flows/${id}`)).json();
  const xsrf = (await page.context().cookies()).find((c) => c.name === 'XSRF-TOKEN')!.value;
  const put = await page.request.put(`/api/flows/${id}/files/${flow.routeFile}`, {
    headers: { 'Content-Type': 'text/plain', 'X-XSRF-TOKEN': xsrf },
    data: [
      '- route:',
      `    id: ${name}-orders`,
      '    description: Get Orders',
      '    from:',
      `      id: from-${name}-orders`,
      `      uri: platform-http:/${name}/orders`,
      '      steps:',
      ...dataMapper('kaoto-datamapper-0rder5a1', 'Request Mapping'),
      ...dataMapper('kaoto-datamapper-0rder5b2'),
      '- route:',
      `    id: ${name}-replies`,
      '    from:',
      `      id: from-${name}-replies`,
      `      uri: platform-http:/${name}/replies`,
      '      steps:',
      ...dataMapper('kaoto-datamapper-rep1yc3', 'Reply Mapping'),
      '',
    ].join('\n'),
  });
  expect(put.ok()).toBe(true);
  await page.reload();
  await expect(page.getByTestId('custom-node__route.from').first()).toBeVisible();
}

test('the Datamappers tab lists the DataMappers by their canvas names and opens them', async ({ page }) => {
  await login(page);
  const name = uniqueName('dmlist');
  await createFlow(page, name, '', { route: false });
  await putRoutes(page, name);

  // The canvas names the steps by their descriptions; the tab line reads Datamappers.
  await expect(page.getByText('Request Mapping', { exact: true })).toBeVisible();
  const tab = page.getByRole('tab', { name: 'Datamappers' });
  await expect(tab).toHaveText('Datamappers');

  // Hide the replies route on the canvas: its DataMapper is still listed and still opens.
  await page.getByTestId('flows-list-dropdown').click();
  await page.getByTestId(`toggle-btn-${name}-replies`).click();
  await expect(page.getByRole('button', { name: /^Routes/ })).toContainText('1/2');
  await expect(page.getByText('Reply Mapping', { exact: true })).toBeHidden();

  await tab.click();
  const list = page.getByTestId('echo-datamappers');
  await expect(list.getByRole('heading', { name: 'Datamappers' })).toBeVisible();
  await expect(page.getByText('Looking to configure the Kaoto DataMapper?')).toBeHidden();
  const rows = list.getByTestId('echo-datamapper-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Request Mapping');
  await expect(rows.nth(0)).toContainText('Get Orders');
  // No description: the canvas's default name, told apart by its route and step id.
  await expect(rows.nth(1)).toContainText('kaoto-datamapper');
  await expect(rows.nth(1)).toContainText('kaoto-datamapper-0rder5b2');
  await expect(rows.nth(2)).toContainText('Reply Mapping');
  await expect(rows.nth(2)).toContainText(`${name}-replies`);

  await rows.nth(2).getByRole('button', { name: 'Reply Mapping' }).click();
  await expect(page).toHaveURL(/#\/datamapper\/kaoto-datamapper-rep1yc3$/);
  await expect(page.getByTestId('echo-datamapper-name')).toHaveText('Reply Mapping');
  await expect(page.getByTestId('attach-schema-sourceBody-Body-button')).toBeVisible();
  const id = page.url().replace(/.*\/flows\/(\d+).*/, '$1');
  const files = async () => (await (await page.request.get(`/api/flows/${id}`)).json()).files as string[];
  await expect.poll(files).toEqual(expect.arrayContaining(['.kaoto', 'kaoto-datamapper-rep1yc3.xsl']));

  // Back to the list, then a whole row opens its DataMapper too.
  await page.getByRole('button', { name: 'All Datamappers' }).click();
  await expect(rows).toHaveCount(3);
  await rows.nth(0).getByText('Get Orders').click();
  await expect(page.getByTestId('echo-datamapper-name')).toHaveText('Request Mapping');
  await expect(page.getByTestId('attach-schema-sourceBody-Body-button')).toBeVisible();
});
