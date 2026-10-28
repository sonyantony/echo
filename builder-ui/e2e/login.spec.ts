import { expect, test } from '@playwright/test';

// M3: log in with the demo user from application.yaml and land on the start page.
test('logs in and lands on the start page', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  // Default branding from application.yaml.
  await expect(page).toHaveTitle('EY ECHO Builder');
  await expect(page.getByRole('heading', { name: 'Log in to EY ECHO Builder' })).toBeVisible();

  await page.getByLabel('Username').fill('designer');
  await page.getByLabel('Password').fill('wrong');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByText('Wrong username or password.')).toBeVisible();

  await page.getByLabel('Password').fill('designer');
  await page.getByRole('button', { name: 'Log in' }).click();
  // No canvas to work on: every flow is named before any work on it.
  await expect(page.getByRole('heading', { name: 'Start with a flow' })).toBeVisible();
  for (const name of ['New Flow', 'Open Flow', 'Open Flow Template', 'Upload Flow']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  }
  await expect(page.getByTestId('flow-name-tag')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'File', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('current-user')).toHaveText('designer');
  await expect(page.getByRole('banner')).toContainText('User: designer');
  await expect(page.getByRole('banner').getByAltText('Company logo')).toBeVisible();
  await expect(page.getByRole('banner')).toContainText('EY ECHO Builder');

  // Open Flow and back.
  await page.getByRole('button', { name: 'Open Flow', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Open Flow', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('heading', { name: 'Start with a flow' })).toBeVisible();

  // The session survives a reload; logging out returns to the login page.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Start with a flow' })).toBeVisible();
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login$/);
});
