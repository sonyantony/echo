import { expect, test } from '@playwright/test';
import { createFlow, interfaceItem, interfaceMenu, login, uniqueName } from './helpers';

// A type drop-down with nothing picked ("Choose Type") is bold and in the text colour in every
// theme. Apicurio greys it (#bbb), so it read as a disabled field.

const shots = process.env.ECHO_E2E_SCREENSHOTS;
const THEMES = ['navy', 'studio', 'graphite', 'contrast'] as const;

for (const theme of THEMES) {
  test(`Choose Type stands out in the ${theme} theme`, async ({ page }) => {
    await page.route('**/api/branding', async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...(await response.json()), theme } });
    });
    await login(page);
    await createFlow(page, uniqueName(`type-${theme}`));
    await interfaceMenu(page, /^Design/);
    const editor = page.frameLocator('iframe[title="OpenAPI editor"]');
    const form = editor.locator('response-form');
    await interfaceItem(page, 'Responses');
    await editor.locator('button[title="Create Response"]').click();
    await editor.getByRole('textbox', { name: 'Name*' }).fill('Thing');
    await editor.getByRole('button', { name: 'Save' }).first().click();
    await form.getByText('Add a media type').click();
    await editor.getByRole('dialog').getByRole('button', { name: 'Add' }).click();
    await form.locator('.media-type .type').click();

    const label = form.getByRole('button', { name: /Choose Type/ }).locator('span').first();
    await expect(label).toHaveCSS('font-weight', '600');
    const colour = await label.evaluate((el) => getComputedStyle(el).color);
    expect(colour).not.toBe('rgb(187, 187, 187)');
    if (shots) await form.screenshot({ path: `${shots}/choose-type-${theme}.png` });
  });
}
