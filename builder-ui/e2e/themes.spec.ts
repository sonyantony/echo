import { expect, test, type Frame, type Page, type TestInfo } from '@playwright/test';
import { createFlow, login, uniqueName } from './helpers';

// Every theme (theme/themes.css) across the main screens, the embedded Kaoto and Openapi Design
// (Apicurio) editors included. Kaoto and Apicurio are restyled through their class names
// (theme/kaoto-mapping.css, theme/apicurio-mapping.css), which an upgrade can rename: these checks
// catch text that becomes unreadable on its background, and attach a screenshot of each screen
// per theme to the report.

const THEMES = ['studio', 'graphite', 'blueprint'] as const;

const SPEC = `openapi: 3.0.3
info:
  title: Orders
  version: 1.0.0
tags:
  - name: orders
servers:
  - url: /orders/v1
paths:
  /orders:
    post:
      operationId: createOrder
      tags: [orders]
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/Order'
      responses:
        '200':
          description: OK
components:
  schemas:
    Order:
      type: object
      properties:
        orderId:
          type: string
`;

/**
 * Text in `frame` whose colour has too little contrast with the background behind it, e.g. light
 * text left on a surface a dark theme forgot to darken. The bar is low (1.5:1) so hints and
 * placeholders pass; what it catches is text that cannot be read at all.
 */
function unreadableText(frame: Page | Frame) {
  return frame.evaluate(() => {
    const rgba = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number);
    const luminance = ([r, g, b]: number[]) => {
      const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const backgroundOf = (e: Element | null): number[] | null => {
      for (; e; e = e.parentElement) {
        const style = getComputedStyle(e);
        if (style.backgroundImage !== 'none') return null; // a pattern or picture: not judged
        const c = rgba(style.backgroundColor);
        if (c.length && (c[3] ?? 1) >= 0.9) return c;
      }
      return [255, 255, 255];
    };
    const problems: string[] = [];
    for (const e of document.querySelectorAll('body *')) {
      if (![...e.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim())) continue;
      const box = e.getBoundingClientRect();
      if (!box.width || !box.height || box.right < 0 || box.bottom < 0 || box.left > innerWidth || box.top > innerHeight) continue;
      const style = getComputedStyle(e);
      if (style.visibility === 'hidden' || Number(style.opacity) === 0 || style.fontSize === '0px') continue;
      const background = backgroundOf(e);
      if (!background) continue;
      const [l1, l2] = [luminance(rgba(style.color)), luminance(background)].sort((a, b) => b - a);
      if ((l1 + 0.05) / (l2 + 0.05) < 1.5) problems.push(`${e.tagName.toLowerCase()}.${e.className} "${e.textContent!.trim().slice(0, 30)}"`);
    }
    return problems;
  });
}

async function check(page: Page, testInfo: TestInfo, theme: string, screen: string, frame: Page | Frame = page) {
  await page.waitForTimeout(500);
  await testInfo.attach(`${theme}-${screen}`, { body: await page.screenshot(), contentType: 'image/png' });
  expect(await unreadableText(frame), `${theme}: ${screen}`).toEqual([]);
}

for (const theme of THEMES) {
  test(`the ${theme} theme keeps every screen readable, the embedded editors included`, async ({ page }, testInfo) => {
    await page.route('**/api/branding', async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...(await response.json()), theme } });
    });
    await login(page);
    await expect(page.locator('html')).toHaveAttribute('data-echo-theme', theme);
    await check(page, testInfo, theme, 'blank-canvas');

    await createFlow(page, uniqueName(theme));
    const flowId = page.url().replace(/.*\/flows\/(\d+).*/, '$1');
    // The canvas is drawn in the theme's canvas colour.
    const canvas = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--echo-canvas').trim());
    await expect(page.locator('.pf-topology-visualization-surface').first()).toHaveCSS('background-color', canvasColour(canvas));
    await check(page, testInfo, theme, 'canvas');

    await page.getByTestId('custom-node__route.from').click();
    await check(page, testInfo, theme, 'step-form');

    // Openapi Design: Apicurio's overview, a path with its operation, and a full-page dialog.
    const status = await page.evaluate(
      async ([id, spec]) => {
        const token = decodeURIComponent(document.cookie.match(/XSRF-TOKEN=([^;]+)/)?.[1] ?? '');
        const headers = { 'content-type': 'text/plain', 'X-XSRF-TOKEN': token };
        return (await fetch(`/api/flows/${id}/api-spec/orders-api.yaml`, { method: 'PUT', body: spec, headers })).status;
      },
      [flowId, SPEC],
    );
    expect(status).toBe(200);
    await page.goto(`/flows/${flowId}/api`);
    const editor = page.frameLocator('iframe[title="OpenAPI editor"]');
    const outline = editor.locator('.editor-outline');
    await expect(outline.getByText('/orders')).toBeVisible();
    await expect(editor.locator('html')).toHaveAttribute('data-echo-theme', theme);
    const frame = page.frames().find((f) => f.url().includes('apicurio-editor'))!;
    await check(page, testInfo, theme, 'openapi-overview', frame);

    await outline.getByText('/orders').click();
    await expect(editor.locator('.operations-section')).toBeVisible();
    await editor.locator('.editor-detail').evaluate((e) => (e.scrollTop = 500));
    await check(page, testInfo, theme, 'openapi-operation', frame);

    await outline.locator('button[title="Create Data Type"]').click();
    await expect(editor.getByText('Define a New Data Type')).toBeVisible();
    await check(page, testInfo, theme, 'openapi-add-data-type', frame);
    await editor.locator('.entity-editor button').filter({ hasText: 'Cancel' }).first().click();

    await outline.locator('icon-button[type=add] button').first().click();
    await expect(editor.locator('.modal-content')).toBeVisible();
    await check(page, testInfo, theme, 'openapi-add-path', frame);
  });
}

/** A CSS colour as getComputedStyle reports it (rgb(...)), for comparing with a token's value. */
function canvasColour(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}
