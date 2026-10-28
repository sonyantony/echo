import { expect, test } from '@playwright/test';
import { addStep, createFlow, login, uniqueName } from './helpers';

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

// Steps' language choices come from each step's schema, which the Builder cuts down too. With
// the five allowed languages Kaoto shows them as a row of buttons instead of a drop-down.
test('steps only offer the allowed expression languages', async ({ page }) => {
  await login(page);
  await createFlow(page, uniqueName('languages'));
  await addStep(page, 1, 'setBody');
  const languages = page.getByRole('group', { name: '# expression list' });
  await expect(languages.getByRole('button')).toHaveText(['Constant', 'ExchangeProperty', 'Header', 'Simple', 'Variable']);
  await languages.getByRole('button', { name: 'Simple' }).click();
  await expect(page.getByRole('textbox', { name: 'Expression' })).toBeVisible();
  await page.screenshot({ path: 'test-results/expression-languages.png' });
});
