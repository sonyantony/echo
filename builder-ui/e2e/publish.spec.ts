import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createFlow, fileMenu, login, uniqueName } from './helpers';

const git = (...args: string[]) =>
  execFileSync('git', ['--git-dir', process.env.ECHO_E2E_GIT_REPO!, ...args], { encoding: 'utf8' });

// M7: publish a flow to the (local) flow repository and see it in the history.
test('publishes a flow to Git', async ({ page }) => {
  await login(page);
  const name = uniqueName('pub');
  await createFlow(page, name);

  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Description').fill(`First version of ${name}`);
  await dialog.getByRole('button', { name: 'Publish' }).click();

  await expect(page.getByText('Published Successfully')).toBeVisible();
  await expect(page.getByText('Published', { exact: true })).toBeVisible();

  expect(git('log', '-1', '--format=%s|%an', 'main', '--', `flows/${name}`).trim()).toBe(
    `First version of ${name}|designer`,
  );
  expect(git('show', `main:flows/${name}/${name}.camel.yaml`)).toContain(`platform-http:/${name}`);
  expect(git('show', `main:flows/${name}/echo-flow.json`)).toContain(`"name" : "${name}"`);

  await page.getByRole('button', { name: 'History' }).click();
  await expect(page.getByRole('dialog').getByText(`First version of ${name}`)).toBeVisible();
});

// The Flows page lists what is in Git as Published, and Delete removes it from Git too.
test('lists a published flow and deletes it from Git', async ({ page }) => {
  await login(page);
  const name = uniqueName('del');
  await createFlow(page, name);
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published Successfully')).toBeVisible();

  await page.goto('/');
  const row = page.getByRole('row').filter({ hasText: name });
  await expect(row).toHaveCount(1);
  await expect(row.getByText('Published v1')).toBeVisible();

  await row.getByRole('button', { name: `Delete ${name}` }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0); // closes once the delete is done
  await expect(page.getByRole('row').filter({ hasText: name })).toHaveCount(0);
  expect(git('ls-tree', '--name-only', 'main', 'flows/')).not.toContain(`flows/${name}`);
  expect(git('log', '-1', '--format=%s|%an', 'main').trim()).toBe(`Delete flow ${name}|designer`);
});

// File > Open Flow (Unpublished) lists Builder drafts not yet published; Open Flow (Published) lists Git.
test('opens unpublished and published flows from the File menu', async ({ page }) => {
  await login(page);
  const published = uniqueName('openpub');
  await createFlow(page, published);
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published Successfully')).toBeVisible();
  await page.goto('/');
  const draft = uniqueName('opendraft');
  await createFlow(page, draft);
  await page.goto('/');
  await createFlow(page, uniqueName('openhere'));

  await fileMenu(page, /^Open Flow \(Unpublished\)/);
  let dialog = page.getByRole('dialog');
  const unpublished = dialog.getByRole('combobox', { name: 'Flow' });
  await expect(unpublished.locator('option', { hasText: published })).toHaveCount(0);
  await unpublished.selectOption(draft);
  await dialog.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByRole('heading', { name: draft })).toBeVisible();

  await fileMenu(page, /^Open Flow \(Published\)/);
  dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: 'Flow' }).selectOption(published);
  await dialog.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByRole('heading', { name: published })).toBeVisible();
});
