import { expect, test, type Page } from "@playwright/test";
import { createFlow, login, uniqueName } from "./helpers";

// An Enrich step's form gets the REST OpenApi step's approved API drop-downs (ECHO's, placed in
// Kaoto's form): the API is preselected, Tag narrows Operation Id, and picking an operation writes
// rest-openapi:<spec>#<operationId> as the Enrich expression. "URI typed by hand" shows Kaoto's
// Expression again for a plain http call.

const shots = process.env.ECHO_E2E_SCREENSHOTS;

async function routeWithEnrich(page: Page, name: string, expression?: string) {
  const id = page.url().replace(/.*\/flows\/(\d+).*/, "$1");
  const xsrf = (await page.context().cookies()).find(
    (c) => c.name === "XSRF-TOKEN",
  )!.value;
  const put = await page.request.put(
    `/api/flows/${id}/files/${name}.camel.yaml`,
    {
      headers: { "Content-Type": "text/plain", "X-XSRF-TOKEN": xsrf },
      data: [
        "- route:",
        `    id: ${name}`,
        "    from:",
        `      id: from-${name}`,
        `      uri: platform-http:/${name}`,
        "      steps:",
        "        - removeHeaders:",
        '            pattern: "*"',
        "        - enrich:",
        "            id: enrich-call",
        ...(expression
          ? ["            simple:", `              expression: ${expression}`]
          : []),
        "",
      ].join("\n"),
    },
  );
  expect(put.ok()).toBe(true);
  await page.reload();
  await page.getByTestId("custom-node__route.from.steps.1.enrich").click();
}

async function savedRoute(page: Page, name: string) {
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: /^Save(?! As)/ }).click();
  await expect(page.getByTestId("unsaved")).toBeHidden();
  const id = page.url().replace(/.*\/flows\/(\d+).*/, "$1");
  return (
    await page.request.get(`/api/flows/${id}/files/${name}.camel.yaml`)
  ).text();
}

test("a new Enrich opens on the approved API drop-downs and writes the rest-openapi call", async ({
  page,
}) => {
  await login(page);
  const name = uniqueName("enrich");
  await createFlow(page, name, "", { route: false });
  await routeWithEnrich(page, name);

  await expect(page.getByLabel("Approved API")).toBeChecked();
  const api = page.getByLabel("API", { exact: true });
  await expect(api).toHaveValue("blueplanet.openapi.json");
  await expect(api.locator("option")).toHaveText(["Blue Planet", "inventory"]);
  const tag = page.getByLabel("Tag", { exact: true });
  await expect(tag.locator("option")).toHaveText([
    "All tags",
    "TMF638 Service Controller (9)",
    "TMF639 Resource Typed Controller (7)",
  ]);
  // Kaoto's own Expression is hidden while the drop-downs say what is called.
  await expect(page.getByTestId("#__expression-list")).toBeHidden();

  const operation = page.getByLabel("Operation Id", { exact: true });
  await expect(operation.locator("option")).toHaveCount(17); // "Choose an operation" + 16
  await tag.selectOption("TMF639 Resource Typed Controller");
  await expect(operation.locator("option")).toHaveCount(8);
  await operation.selectOption("getResource");
  await expect(page.getByTestId("enrich-api-uri")).toHaveText(
    "Calls rest-openapi:blueplanet.openapi.json#getResource?host={{blueplanet.base-url}}",
  );
  if (shots) {
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${shots}/1-enrich-approved-api.png` });
  }
  expect(await savedRoute(page, name)).toContain(
    "expression: rest-openapi:blueplanet.openapi.json#getResource?host={{blueplanet.base-url}}",
  );

  // A spec without a server gets its Host placeholder in the URI.
  await api.selectOption("inventory.openapi.json");
  await operation.selectOption("init");
  await expect(page.getByTestId("enrich-api-uri")).toHaveText(
    "Calls rest-openapi:inventory.openapi.json#init?host={{inventory.base-url}}",
  );

  // Typing the URI by hand shows Kaoto's Expression with the call in it.
  await page.getByLabel("URI typed by hand").check();
  await expect(page.getByLabel("Tag", { exact: true })).toBeHidden();
  const text = page
    .getByTestId("simple.expression__field-wrapper")
    .locator("textarea");
  await expect(text).toHaveValue(
    "rest-openapi:inventory.openapi.json#init?host={{inventory.base-url}}",
  );
  await text.fill("http://host.docker.internal:9090/orders");
  expect(await savedRoute(page, name)).toContain(
    "expression: http://host.docker.internal:9090/orders",
  );
});

test("an Enrich with a typed URI opens on it, and one calling an approved API on its operation", async ({
  page,
}) => {
  await login(page);
  const name = uniqueName("enrich-typed");
  await createFlow(page, name, "", { route: false });
  await routeWithEnrich(page, name, "http://host.docker.internal:9090/orders");
  await expect(page.getByLabel("URI typed by hand")).toBeChecked();
  await expect(
    page.getByTestId("simple.expression__field-wrapper").locator("textarea"),
  ).toHaveValue("http://host.docker.internal:9090/orders");

  await routeWithEnrich(
    page,
    name,
    "rest-openapi:blueplanet.openapi.json#createService",
  );
  await expect(page.getByLabel("Approved API")).toBeChecked();
  await expect(page.getByLabel("Tag", { exact: true })).toHaveValue(
    "TMF638 Service Controller",
  );
  await expect(page.getByLabel("Operation Id", { exact: true })).toHaveValue(
    "createService",
  );
  if (shots) {
    await page.waitForTimeout(500);
    await page.screenshot({
      path: `${shots}/2-enrich-opened-on-its-operation.png`,
    });
  }
});
