import type { ApiTags } from "../api/flows";
import { apiFor } from "./operationTags";

/** Kaoto's Enrich form: its header icon (class ends with the step's path) and its Expression field. */
export const ENRICH_HEADER =
  "img[class^='form-header__icon-'][class$='.enrich']";
export const EXPRESSION_LIST = "[data-testid='#__expression-list']";
export const EXPRESSION_FIELD = "[data-testid='#__field-wrapper']";

const PREFIX = "rest-openapi:";

/** An Enrich expression that calls an API: rest-openapi:<spec>#<operationId>?<options>. */
export interface ApiCall {
  specificationUri: string;
  operationId: string;
  /** The options after '?', without it ('' when none). */
  options: string;
}

export function parseApiCall(expression: string): ApiCall | undefined {
  const uri = expression.trim();
  if (!uri.startsWith(PREFIX)) return undefined;
  const [path, ...rest] = uri.slice(PREFIX.length).split("?");
  const hash = path.indexOf("#");
  return {
    specificationUri: hash < 0 ? path : path.slice(0, hash),
    operationId: hash < 0 ? "" : path.slice(hash + 1),
    options: rest.join("?"),
  };
}

/**
 * The Enrich expression calling an approved API's operation. Options already in the URI are kept;
 * otherwise a spec without a server gets its Host placeholder.
 */
export function apiCallUri(
  api: ApiTags,
  operationId: string,
  options = "",
): string {
  const opts = options || (api.host ? `host=${api.host}` : "");
  return `${PREFIX}${api.specificationUri}${operationId ? `#${operationId}` : ""}${opts ? `?${opts}` : ""}`;
}

/** The approved API an Enrich expression calls; undefined for anything else (an http URI, say). */
export function calledApi(
  apis: ApiTags[],
  expression: string,
): ApiTags | undefined {
  const call = parseApiCall(expression);
  return call && apiFor(apis, call.specificationUri);
}

/** Whether an Enrich expression opens on the drop-downs: nothing set yet, or an approved API's call. */
export function startsOnApi(apis: ApiTags[], expression: string): boolean {
  return !expression.trim() || !!calledApi(apis, expression);
}

/** The operations to offer: the tag's, or the API's (every tag's, A to Z) when no tag is chosen. */
export function operationsFor(api: ApiTags, tag: string): string[] {
  const under = api.tags.find((t) => t.name === tag)?.operations;
  if (under) return under;
  return [...new Set(api.tags.flatMap((t) => t.operations))].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
}
