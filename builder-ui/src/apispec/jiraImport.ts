/**
 * Interface > Import From Jira: adds the operations the user confirmed (made from a story's
 * example payloads) to the spec on screen, keeping everything it has. Each operation's schemas are
 * made as New From Samples makes them (specFromSamples.ts), under names the spec does not have yet.
 */
import { fillMissingOperationIds } from './operationIds';
import { normalizePath, operationFromSamples, SchemaBuilder } from './specFromSamples';

export interface ImportedOperation {
  /** Upper case. */
  method: string;
  /** Without the query. */
  path: string;
  query?: string;
  request?: unknown;
  response?: unknown;
}

export interface ImportResult {
  /** The spec with the operations added, as the editor's JSON. */
  json: string;
  /** The operations added; replaced when the spec had that method and path already. */
  paths: { method: string; path: string; replaced: boolean }[];
  /** The data types made, with how many fields each has. */
  schemas: { name: string; fields: number }[];
  /** Things worth checking in the editor. */
  notes: string[];
}

type Spec = {
  paths?: Record<string, Record<string, Record<string, unknown>>>;
  components?: { schemas?: Record<string, unknown> } & Record<string, unknown>;
  servers?: { url?: unknown }[];
} & Record<string, unknown>;

/**
 * @param dropReplacedTypes take out the data types only a replaced operation used, so the new ones
 *        can have their names (Interface Specs from Samples > Replace one method)
 */
export function addOperations(currentJson: string, operations: ImportedOperation[], dropReplacedTypes = false): ImportResult {
  const spec = JSON.parse(currentJson) as Spec;
  const paths = (spec.paths ??= {});
  const components = (spec.components ??= {});
  const schemas = (components.schemas ??= {});
  if (dropReplacedTypes) dropTypesOf(spec, operations.map((op) => [normalizePath(op.path), op.method.toLowerCase()]));
  const builder = new SchemaBuilder(Object.keys(schemas));
  const added: ImportResult['paths'] = [];
  const notes: string[] = [];

  for (const op of operations) {
    const path = normalizePath(op.path);
    const method = op.method.toLowerCase();
    const item = (paths[path] ??= {});
    const existing = item[method];
    // A replaced operation keeps its operationId, so the route that handles it stays connected.
    const operationId = typeof existing?.operationId === 'string' ? existing.operationId : undefined;
    item[method] = operationFromSamples(builder, { method: op.method, path, query: op.query, operationId, request: op.request, response: op.response });
    added.push({ method: op.method, path, replaced: !!existing });
    if (op.response === undefined) notes.push(`${op.method} ${path} had no response example: its 200 response has no body.`);
  }

  Object.assign(schemas, builder.schemas);
  for (const field of builder.nullFields) notes.push(`${field} was null in the example, so it is an optional string.`);
  return {
    json: fillMissingOperationIds(JSON.stringify(spec, null, 2)),
    paths: added,
    schemas: Object.entries(builder.schemas).map(([name, schema]) => ({
      name,
      fields: Object.keys((schema as { properties?: object }).properties ?? {}).length,
    })),
    notes,
  };
}

/**
 * Takes out the data types the operations at [path, method] use (and the types those use) which
 * nothing else in the spec uses. The operations stay; they are replaced right after.
 */
function dropTypesOf(spec: Spec, at: [string, string][]) {
  const schemas = spec.components!.schemas!;
  const refsIn = (value: unknown) => [...JSON.stringify(value ?? null).matchAll(/"#\/components\/schemas\/([^"]+)"/g)].map((m) => m[1]);
  const used = new Set<string>();
  const pending = at.flatMap(([path, method]) => refsIn(spec.paths?.[path]?.[method]));
  while (pending.length) {
    const name = pending.pop()!;
    if (used.has(name) || !(name in schemas)) continue;
    used.add(name);
    pending.push(...refsIn(schemas[name]));
  }
  if (!used.size) return;
  const old = at.map(([path, method]) => [path, method, spec.paths![path][method]] as const);
  for (const [path, method] of old) delete spec.paths![path][method];
  const rest = { ...spec, components: { ...spec.components, schemas: Object.fromEntries(Object.entries(schemas).filter(([n]) => !used.has(n))) } };
  const stillUsed = new Set(refsIn(rest));
  for (const name of used) if (!stillUsed.has(name)) delete schemas[name];
  for (const [path, method, op] of old) spec.paths![path][method] = op;
}

/** The operations the spec has, as METHOD path. */
export function operationKeys(currentJson: string): Set<string> {
  const keys = new Set<string>();
  try {
    const spec = JSON.parse(currentJson) as Spec;
    for (const [path, item] of Object.entries(spec.paths ?? {})) {
      for (const method of Object.keys(item ?? {})) keys.add(`${method.toUpperCase()} ${path}`);
    }
  } catch {
    // Nothing to compare with.
  }
  return keys;
}

/**
 * The path as the spec writes it when it has that path already, maybe with other {names}
 * (/cards/{id} for /cards/{cardId}), so an operation added to it goes under the same path; else path.
 */
export function pathInSpec(currentJson: string, path: string): string {
  const template = (p: string) => p.replace(/\{[^}/]*\}/g, '{}').replace(/(.)\/$/, '$1');
  try {
    const paths = Object.keys((JSON.parse(currentJson) as Spec).paths ?? {});
    return paths.find((p) => template(p) === template(path)) ?? path;
  } catch {
    return path;
  }
}

/** The spec's Base Path (its first server's URL path), without a trailing '/'; '' when it has none. */
export function basePathOf(currentJson: string): string {
  try {
    const url = (JSON.parse(currentJson) as Spec).servers?.[0]?.url;
    if (typeof url !== 'string' || !url) return '';
    const path = /^[a-z]+:\/\//i.test(url) ? new URL(url).pathname : url;
    return path.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

/**
 * A path as a story writes it, without the spec's Base Path when it starts with it
 * (/customers/v1/cards is /cards in a spec whose Base Path is /customers/v1).
 */
export function withoutBasePath(path: string, basePath: string): string {
  if (!basePath || basePath === '/') return path;
  return path.startsWith(`${basePath}/`) ? path.slice(basePath.length) : path;
}

