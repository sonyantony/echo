import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createFlow, login, uniqueName } from './helpers';

const git = (...args: string[]) =>
  execFileSync('git', ['--git-dir', process.env.ECHO_E2E_GIT_REPO!, ...args], { encoding: 'utf8' });

// M7: publish a flow to the (local) flow repository and see it in the history.
test('publishes a flow to Git', async ({ page }) => {
  await login(page);
  const name = uniqueName('pub');
  await createFlow(page, name);

  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('What changed?').fill(`First version of ${name}`);
  await dialog.getByRole('button', { name: 'Publish' }).click();

  await expect(page.getByText(/Published to main as [0-9a-f]{8}\./)).toBeVisible();
  await expect(page.getByText('Published', { exact: true })).toBeVisible();

  expect(git('log', '-1', '--format=%s|%an', 'main', '--', `flows/${name}`).trim()).toBe(
    `First version of ${name}|designer`,
  );
  expect(git('show', `main:flows/${name}/${name}.camel.yaml`)).toContain(`platform-http:/${name}`);
  expect(git('show', `main:flows/${name}/echo-flow.json`)).toContain(`"name" : "${name}"`);

  await page.getByRole('button', { name: 'History' }).click();
  await expect(page.getByRole('dialog').getByText(`First version of ${name}`)).toBeVisible();
});
