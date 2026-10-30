import { expect, test } from '@playwright/test';
import { createFlow, designMenu, interfaceItem, interfaceMenu, login, uniqueName } from './helpers';

// Validate shows each problem on the step it is about: a red circle at the step's top right,
// opening a box with its problems. Nothing is listed above the editor any more.
// The steps of a scaffold route left to the user have one from the start, saying what to do.

const shots = process.env.ECHO_E2E_SCREENSHOTS;

test('Validate puts a red circle on each step with problems, opening them', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await login(page);
  const name = uniqueName('badges');
  await createFlow(page, name, '', { route: false });
  // A method's scaffold route has steps left for the user: a REST OpenApi step without its
  // operation and a DataMapper without mappings.
  await interfaceMenu(page, /^Design/);
  const editor = page.frameLocator('iframe[title="OpenAPI editor"]');
  await interfaceItem(page, 'Paths');
  await editor.getByText('Add a path').click();
  const addPath = editor.getByRole('dialog', { name: 'Add Path' });
  const path = `/${name.replace(/-/g, '')}`;
  await addPath.getByRole('textbox').fill(path);
  await addPath.getByRole('button', { name: 'Add' }).click();
  // A POST: its route also maps the request before the call.
  await editor.locator('.operation-tab').getByText('Post', { exact: true }).click();
  await editor.getByRole('button', { name: 'Add Operation' }).click();
  await expect(page.getByText(`Added a route for POST ${path}.`)).toBeVisible();
  await designMenu(page, /^Design/);
  await expect(page.getByTestId('custom-node__route.from').first()).toBeVisible();
  await page.getByRole('button', { name: 'Horizontal Layout' }).click();
  await page.getByRole('button', { name: 'Fit Route' }).click();

  // Before any Validate, the steps left to the user have a red circle saying what to do.
  const badges = page.locator('.echo-step-problem');
  await expect(badges).toHaveCount(5);
  const label = page.locator('g[data-id$="|route.from.steps.2.multicast.steps.0.pipeline.steps.4.setBody"] .echo-step-problem');
  await label.click();
  const todo = page.getByRole('dialog', { name: /1 thing to do on setBody/ });
  await expect(todo).toContainText('Name this call\'s part of the reply: change "result" to a name for it.');
  await page.waitForTimeout(500); // the box fades in
  if (shots) await page.screenshot({ path: `${shots}/0-before-validate.png` });
  await page.keyboard.press('Escape');
  await expect(todo).toBeHidden();

  await page.getByRole('button', { name: 'Validate', exact: true }).click();
  await expect(page.getByTestId('validation-problems')).toBeVisible();
  await expect(badges).toHaveCount(5);
  await expect(page.getByText(/problems? to fix before publishing/)).toBeHidden();
  const summary = page.getByTestId('validation-problems');
  await expect(summary).toHaveText('3 problems');
  // The circles are on the REST OpenApi step in the multicast and on the DataMapper.
  const rest = page.locator('g[data-id$="|route.from.steps.2.multicast.steps.0.pipeline.steps.2.to"] .echo-step-problem');
  const mapper = page.locator('g[data-id$="|route.from.steps.4.step:kaoto-datamapper"] .echo-step-problem');
  await expect(rest).toHaveText('1');
  await expect(mapper).toHaveText('1');
  // At the top right of the step's icon.
  const icon = (await page.locator('g[data-id$="|route.from.steps.4.step:kaoto-datamapper"] .custom-node__container__image').boundingBox())!;
  const circle = (await mapper.boundingBox())!;
  expect(circle.x + circle.width / 2).toBeGreaterThan(icon.x + icon.width - 4);
  expect(circle.y + circle.height / 2).toBeLessThan(icon.y + 4);
  if (shots) await page.screenshot({ path: `${shots}/1-red-circles.png` });

  await mapper.click();
  const box = page.getByRole('dialog', { name: /1 problem on/ });
  await expect(box).toContainText('1 problem on kaoto-datamapper');
  await expect(box.getByTestId('step-problems')).toContainText('A DataMapper step has no mapping yet');
  await page.waitForTimeout(500);
  // Opening the box does not select the step (no step toolbar).
  await expect(page.getByTestId('step-toolbar')).toBeHidden();
  if (shots) await page.screenshot({ path: `${shots}/2-datamapper-problem.png` });
  await rest.click();
  await expect(box.getByTestId('step-problems')).toContainText('pick its Operation Id');
  await page.waitForTimeout(500);
  if (shots) await page.screenshot({ path: `${shots}/3-rest-openapi-problem.png` });
  // Clear takes that step's problems away until the next Validate: what is left to do shows again.
  await box.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(box).toBeHidden();
  await expect(summary).toHaveText('3 problems');
  await rest.click();
  const restToDo = page.getByRole('dialog', { name: /1 thing to do on rest-openapi/ });
  await expect(restToDo.getByTestId('step-problems')).toContainText(/Pick the (API and the )?operation this step calls/);
  await page.keyboard.press('Escape');
  await expect(restToDo).toBeHidden();

  // The toolbar's count says where they are; Clear removes the circles.
  await summary.click();
  const all = page.getByRole('dialog', { name: /3 problems to fix before publishing/ });
  await expect(all).toContainText('They are on steps of the flow: click the red circle on a step to see its problems.');
  await page.waitForTimeout(500);
  if (shots) await page.screenshot({ path: `${shots}/4-toolbar-count.png` });
  await all.getByRole('button', { name: 'Clear the problems' }).click();
  // The steps left to the user keep theirs: what to do, not Validate's problems.
  await expect(badges).toHaveCount(5);
  await mapper.click();
  const mapperToDo = page.getByRole('dialog', { name: /1 thing to do on kaoto-datamapper/ });
  await expect(mapperToDo.getByTestId('step-problems')).toContainText('Map the reply: select this step, choose Configure');
  await expect(summary).toBeHidden();
  // Mark As Done takes a thing to do away for good: it stays away when the flow is opened again.
  await page.waitForTimeout(500);
  if (shots) await page.screenshot({ path: `${shots}/5-mark-as-done.png` });
  await mapperToDo.getByRole('button', { name: 'Mark as done' }).click();
  await expect(mapper).toHaveCount(0);
  await expect(badges).toHaveCount(4);
  await page.reload();
  await expect(page.getByTestId('custom-node__route.from').first()).toBeVisible();
  await expect(badges).toHaveCount(4);
  await expect(mapper).toHaveCount(0);
});
