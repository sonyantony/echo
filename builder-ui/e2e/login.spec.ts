import { expect, test } from '@playwright/test';

// M3: log in with the demo user from application.yaml and land on a blank canvas.
test('logs in and lands on a blank canvas', async ({ page }) => {
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
  await expect(page.getByRole('heading', { name: 'Untitled flow' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /^New Flow/ })).toBeVisible(); // File menu open
  // Our own message replaces Kaoto's "There are no routes defined" on the blank canvas.
  await expect(page.getByRole('heading', { name: 'No flow is open' })).toBeVisible();
  await expect(page.getByText('There are no routes defined')).toBeHidden();
  await expect(page.getByTestId('current-user')).toHaveText('designer');
  await expect(page.getByRole('banner')).toContainText('User: designer');
  await expect(page.getByRole('banner').getByAltText('Company logo')).toBeVisible();
  await expect(page.getByRole('banner')).toContainText('EY ECHO Builder');

  // The session survives a reload; logging out returns to the login page.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Untitled flow' })).toBeVisible();
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login$/);
});
