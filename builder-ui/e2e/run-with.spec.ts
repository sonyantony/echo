import { expect, test, type Page } from '@playwright/test';
import { createFlow, login, uniqueName } from './helpers';

/** Saves route as the open flow's route file and reloads it. */
async function putRoute(page: Page, route: string) {
  const id = page.url().replace(/.*\/flows\/(\d+).*/, '$1');
  const flow = await (await page.request.get(`/api/flows/${id}`)).json();
  const xsrf = (await page.context().cookies()).find((c) => c.name === 'XSRF-TOKEN')!.value;
  const put = await page.request.put(`/api/flows/${id}/files/${flow.routeFile}`, {
    headers: { 'Content-Type': 'text/plain', 'X-XSRF-TOKEN': xsrf },
    data: route,
  });
  expect(put.ok()).toBeTruthy();
  await page.reload();
  return { id, path: `/${flow.name}` };
}

const file = (name: string, text: string) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });

test('Run asks for a properties file for the flow values, reuses it, and Run <flow> With... picks another', async ({
  page,
}) => {
  await login(page);
  const name = uniqueName('runwith');
  await createFlow(page, name, '', { route: false });
  const { id, path } = await putRoute(
    page,
    [
      '- route:',
      `    id: ${name}`,
      '    from:',
      `      uri: platform-http:/${name}`,
      '      steps:',
      '        - setHeader:',
      '            name: Authorization',
      '            simple: "Bearer {{fulfilment.api.token}}"',
      '        - log:',
      '            message: "Asking {{inventory.host}} (timeout {{inventory.timeout:5000}} ms)"',
      '        - setBody:',
      '            constant: "{{reply.text}}"',
      '',
    ].join('\n'),
  );
  const runTab = page.getByRole('button', { name: 'Run', exact: true });
  const runItem = page.getByRole('menuitem', { name: new RegExp(`^(Run|Restart) ${name}(?! With\\.\\.\\.)`) });
  const runWithItem = page.getByRole('menuitem', { name: new RegExp(`^Run ${name} With\\.\\.\\.`) });

  // The first Run opens the dialog: the values the flow uses, none read yet.
  await runTab.click();
  await runItem.click();
  const dialog = page.getByRole('dialog', { name: `Run ${name} with` });
  await expect(dialog).toBeVisible();
  const table = dialog.getByRole('table', { name: 'Values the flow uses' });
  await expect(table.getByRole('row')).toHaveCount(5);
  await expect(table.getByRole('row', { name: /inventory\.timeout default 5000/ })).toBeVisible();
  const run = dialog.getByRole('button', { name: 'Run', exact: true });
  await expect(run).toBeDisabled();

  // A file that misses values says which, and Run stays off.
  const input = dialog.locator('input[type=file]');
  await input.setInputFiles(file('dev.properties', 'inventory.host=localhost\nfulfilment.api.token=abc123\n'));
  await expect(dialog.getByText('1 value is missing from dev.properties')).toBeVisible();
  await expect(table.getByRole('row', { name: /reply\.text not set in this file/ })).toBeVisible();
  await expect(table.getByText('abc123')).toBeHidden();
  await expect(run).toBeDisabled();

  await input.setInputFiles(file('test.properties', 'inventory.host=localhost\nfulfilment.api.token=abc123\nreply.text=Hello from test\n'));
  await expect(run).toBeEnabled();
  await run.click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(`${name} on port`).first()).toBeVisible();
  const call = async () =>
    (
      await (
        await page.request.post(`/api/flows/${id}/run/request`, {
          headers: { 'X-XSRF-TOKEN': (await page.context().cookies()).find((c) => c.name === 'XSRF-TOKEN')!.value },
          data: { method: 'GET', path },
        })
      ).json()
    ).body;
  expect(await call()).toBe('Hello from test');

  // Later runs use the same file without asking.
  await runTab.click();
  await expect(runItem).toContainText('With the values in test.properties');
  await runItem.click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(`${name} on port`).first()).toBeVisible();

  // Run <flow> With... ignores it and asks for a file again.
  await runTab.click();
  await runWithItem.click();
  await expect(dialog).toBeVisible();
  await expect(run).toBeDisabled();
  await dialog.locator('input[type=file]').setInputFiles(
    file('other.properties', 'inventory.host=localhost\nfulfilment.api.token=x\nreply.text=Hello again\n'),
  );
  await run.click();
  await expect(dialog).toBeHidden();
  await expect.poll(call).toBe('Hello again');
  await runTab.click();
  await expect(runItem).toContainText('With the values in other.properties');
});
