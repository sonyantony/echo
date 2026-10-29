import { describe, expect, it } from "vitest";
import {
  apiCallUri,
  calledApi,
  operationsFor,
  parseApiCall,
  startsOnApi,
} from "./enrichApi";

const blueplanet = {
  specificationUri: "blueplanet.openapi.json",
  tags: [
    { name: "B", operations: ["getB", "shared"] },
    { name: "a", operations: ["shared", "addA"] },
  ],
};
const inventory = {
  specificationUri: "inventory.openapi.json",
  host: "{{inventory.host}}",
  tags: [],
};
const apis = [blueplanet, inventory];

describe("enrich api calls", () => {
  it("reads the spec, operation and options of a rest-openapi URI", () => {
    expect(
      parseApiCall(
        " rest-openapi:inventory.openapi.json#getService?host={{inventory.host}}",
      ),
    ).toEqual({
      specificationUri: "inventory.openapi.json",
      operationId: "getService",
      options: "host={{inventory.host}}",
    });
    expect(parseApiCall("rest-openapi:blueplanet.openapi.json")).toEqual({
      specificationUri: "blueplanet.openapi.json",
      operationId: "",
      options: "",
    });
    expect(parseApiCall("http://example.com/x")).toBeUndefined();
  });

  it("writes the call with the spec's Host placeholder, keeping options already set", () => {
    expect(apiCallUri(blueplanet, "getB")).toBe(
      "rest-openapi:blueplanet.openapi.json#getB",
    );
    expect(apiCallUri(inventory, "getService")).toBe(
      "rest-openapi:inventory.openapi.json#getService?host={{inventory.host}}",
    );
    expect(apiCallUri(inventory, "getService", "host=http://x")).toBe(
      "rest-openapi:inventory.openapi.json#getService?host=http://x",
    );
    expect(apiCallUri(inventory, "")).toBe(
      "rest-openapi:inventory.openapi.json?host={{inventory.host}}",
    );
  });

  it("opens on the drop-downs when nothing is set or an approved API is called", () => {
    expect(startsOnApi(apis, "")).toBe(true);
    expect(
      startsOnApi(apis, "rest-openapi:classpath:inventory.openapi.json#x"),
    ).toBe(true);
    expect(calledApi(apis, "rest-openapi:inventory.openapi.json#x")).toBe(
      inventory,
    );
    expect(startsOnApi(apis, "rest-openapi:other.json#x")).toBe(false);
    expect(startsOnApi(apis, "https://example.com/orders")).toBe(false);
  });

  it("offers the tag's operations, or every tag's A to Z", () => {
    expect(operationsFor(blueplanet, "B")).toEqual(["getB", "shared"]);
    expect(operationsFor(blueplanet, "")).toEqual(["addA", "getB", "shared"]);
  });
});
