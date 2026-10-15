import { expect, test } from '@playwright/test';

// M3: log in with the demo user from application.yaml and see the flow list.
test('logs in and sees the flow list', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  // Default branding from application.yaml.
  await expect(page).toHaveTitle('ECHO Builder');
  await expect(page.getByRole('heading', { name: 'Log in to ECHO Builder' })).toBeVisible();

  await page.getByLabel('Username').fill('designer');
  await page.getByLabel('Password').fill('wrong');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByText('Wrong username or password.')).toBeVisible();

  await page.getByLabel('Password').fill('designer');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: 'Flows', exact: true })).toBeVisible();
  await expect(page.getByTestId('current-user')).toHaveText('designer');
  await expect(page.getByRole('banner').getByAltText('EY')).toBeVisible();

  // The session survives a reload; logging out returns to the login page.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Flows', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login$/);
});
