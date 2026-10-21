import { expect, test } from '@playwright/test';
import { createFlow, login, uniqueName } from './helpers';

// The Builder serves Kaoto a catalog cut down to what Validate accepts (echo.validation).
test('the step catalog only offers allowed components and no kamelets', async ({ page }) => {
  await login(page);
  await createFlow(page, uniqueName('catalog'));
  await page.getByTestId('placeholder-node__route.from.steps.1.placeholder').click();
  const catalog = page.getByRole('dialog');
  const filter = catalog.getByPlaceholder('Filter by name, description or tag');

  await filter.fill('rest-openapi');
  await expect(catalog.getByTestId('tile-rest-openapi')).toBeVisible();
  await filter.fill('kafka');
  await expect(catalog.getByTestId('tile-kafka')).toHaveCount(0);
  await filter.fill('marshal');
  await expect(catalog.getByTestId('tile-marshal')).toHaveCount(0);
  await filter.fill('setBody');
  await expect(catalog.getByTestId('tile-setBody')).toBeVisible();
  await expect(catalog.getByRole('button', { name: /^Kamelet/ })).toHaveCount(0);
});

// REST always runs on platform-http with Camel's defaults, so the REST configuration form leaves
// out Component, Scheme, Host, Port, Api Context Path, Binding Mode, Inline Routes and most of
// Consumer (Advanced).
test('the REST configuration form hides settings flows leave at their defaults', async ({ page }) => {
  await login(page);
  await createFlow(page, uniqueName('restconf'));
  await page.getByRole('tab', { name: 'Rest' }).click();
  await page.getByTestId('rest-tree-toolbar-menu').click();
  await page.getByTestId('add-rest-configuration-btn').click();
  const form = page.locator('.rest-right-panel');
  await expect(form.getByText('Context Path', { exact: true })).toBeVisible();
  await form.getByRole('button', { name: 'Toggle Consumer (advanced) group' }).click();
  await expect(form.getByText('Enable CORS', { exact: true })).toBeVisible();
  await expect(form.getByText('Client Request Validation', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/rest-configuration.png' });
  for (const hidden of ['Component', 'Scheme', 'Host', 'Port', 'Api Context Path', 'Binding Mode', 'Inline Routes',
    'Api Component', 'Api Host', 'Host Name Resolver', 'Binding Package Scan', 'Client Response Validation']) {
    await expect(form.getByText(hidden, { exact: true })).toHaveCount(0);
  }
});
