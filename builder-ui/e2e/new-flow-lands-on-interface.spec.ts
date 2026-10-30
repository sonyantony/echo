import { expect, test } from '@playwright/test';
import { login, uniqueName } from './helpers';

const shots = process.env.ECHO_E2E_SHOTS;

// A flow starts from its interface: New Flow opens Interface Specs > Design, with nothing picked yet.
test('New Flow opens the new flow on Interface Specs > Design', async ({ page }) => {
  await login(page);
  const name = uniqueName('Interface First');
  await page.getByRole('button', { name: 'New flow' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/Name/).fill(name);
  await dialog.getByRole('button', { name: 'Create' }).click();

  await expect(page).toHaveURL(/\/flows\/\d+\/api$/);
  await expect(page.getByTestId('flow-name-tag')).toHaveText(`Flow: ${name}`);
  await expect(page.getByRole('button', { name: 'Interface Specs', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('iframe[title="OpenAPI editor"]')).toBeVisible();
  if (shots) await page.screenshot({ path: `${shots}/1-new-flow-lands-on-design.png` });
});
