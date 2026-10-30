import { expect, test } from '@playwright/test';
import { createFlow, login, uniqueName } from './helpers';

// Kaoto's canvas only pans by dragging; ECHO adds scroll bars along its right edge (next to the
// step form) and its bottom while part of the flow is out of view (canvasScrollbars.ts).
test('the canvas has scroll bars when the flow does not fit', async ({ page }) => {
  await login(page);
  await createFlow(page, uniqueName('scroll'));
  const vertical = page.getByTestId('canvas-scrollbar-y');
  await expect(vertical).toBeHidden();

  // Routes stacked one under another run off the bottom of the canvas.
  for (let i = 0; i < 5; i++) {
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await page.getByRole('menuitem', { name: /^Route/ }).first().click();
  }
  await expect(page.getByRole('button', { name: /^Routes/ })).toContainText('6/6');
  await page.getByRole('button', { name: 'Horizontal Layout' }).click();
  // With the step form open, the bar is at the split between canvas and form.
  await page.getByTestId('custom-node__route.from').first().click();
  await expect(vertical).toBeVisible();
  const canvas = (await page.locator('.pf-topology-visualization-surface').boundingBox())!;
  const bar = (await vertical.boundingBox())!;
  expect(Math.abs(bar.x + bar.width - (canvas.x + canvas.width))).toBeLessThanOrEqual(1);

  // Dragging the thumb down moves the flow up; the wheel over the bar moves it back.
  const diagram = page.locator('g[data-surface]').first();
  const top = () => diagram.evaluate((g) => g.getBoundingClientRect().top);
  // The new layout settles (Kaoto moves the diagram after it) before the drag starts.
  let last = NaN;
  await expect
    .poll(async () => {
      const now = await top();
      const still = now === last;
      last = now;
      return still;
    }, { intervals: [500] })
    .toBe(true);
  const before = await top();
  const thumb = (await vertical.locator('.echo-canvas-scrollbar__thumb').boundingBox())!;
  await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + 10);
  await page.mouse.down();
  await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + 110, { steps: 5 });
  await page.mouse.up();
  await expect.poll(top).toBeLessThan(before - 100);
  const dragged = await top();
  await vertical.hover({ position: { x: 5, y: 5 } });
  await page.mouse.wheel(0, -150);
  await expect.poll(top).toBeGreaterThan(dragged + 100);
  // The step form stays open: scrolling is not a click on the canvas.
  await expect(page.getByRole('heading', { name: 'Platform HTTP' })).toBeVisible();
});
