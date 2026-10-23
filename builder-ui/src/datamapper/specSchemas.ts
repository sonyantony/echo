/**
 * JSON Schemas for the DataMapper, made from the flow's OpenAPI spec. Kaoto's DataMapper reads only
 * standalone JSON Schema (or XSD) files, never the schemas inside an OpenAPI document, so ECHO writes
 * one file per request or response body the user attaches:
 * openapi-<endpoint>-<method>-request.schema.json or openapi-<endpoint>-<method>-response-<code>.schema.json.
 * Each file records where it came from (SOURCE_KEY), so it can be made again when the spec changes.
 */

type Json = Record<string, unknown>;

export type SchemaPartKind = 'request' | 'response';

/** Which body of which operation a schema file was made from. */
export interface SpecSchemaSource {
  /** Lower case, e.g. post. */
  method: string;
  /** As written in the spec, e.g. /orders/{id}. */
  path: string;
  part: SchemaPartKind;
  /** The response's status code (or "default"). */
  status?: string;
}

/** A request or response body in the spec that has a JSON schema. */
export interface SpecSchemaPart extends SpecSchemaSource {
  operationId?: string;
  /** e.g. "POST /orders: Request body" or "POST /orders: Response 200". */
  label: string;
}

/** Marks a schema file ECHO made from the spec, and says what from. */
export const SOURCE_KEY = 'x-echo-openapi';
export const GENERATED_PREFIX = 'openapi-';
export const SCHEMA_SUFFIX = '.schema.json';

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
/** OpenAPI keywords that are not JSON Schema; Kaoto does not need them. */
const OPENAPI_ONLY = new Set(['nullable', 'discriminator', 'xml', 'externalDocs', 'example']);

const isObject = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);

/** Resolves an internal reference such as #/components/schemas/Order. */
function pointer(spec: Json, ref: string): unknown {
  if (!ref.startsWith('#/')) return undefined;
  return ref
    .slice(2)
    .split('/')
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce<unknown>((node, key) => (isObject(node) ? node[key] : undefined), spec);
}

/** Follows $ref until a non-reference object (a requestBody or response may be a reference too). */
function deref(spec: Json, node: unknown, seen = new Set<string>()): Json | undefined {
  if (!isObject(node)) return undefined;
  const ref = node.$ref;
  if (typeof ref !== 'string') return node;
  if (seen.has(ref)) return undefined;
  seen.add(ref);
  return deref(spec, pointer(spec, ref), seen);
}

/** The JSON body schema of an OpenAPI 3 content map: application/json first, then any other JSON type. */
function jsonSchemaOf(content: unknown): unknown {
  if (!isObject(content)) return undefined;
  const types = Object.keys(content);
  const type =
    types.find((t) => t.toLowerCase().split(';')[0].trim() === 'application/json') ??
    types.find((t) => /[/+]json\b/i.test(t) || t === '*/*');
  return type && isObject(content[type]) ? (content[type] as Json).schema : undefined;
}

function bodySchema(spec: Json, operation: Json, pathItem: Json, source: SpecSchemaSource): unknown {
  if (source.part === 'request') {
    if ('swagger' in spec) {
      const params = [...asArray(pathItem.parameters), ...asArray(operation.parameters)].map((p) => deref(spec, p));
      return params.find((p) => p?.in === 'body')?.schema;
    }
    return jsonSchemaOf(deref(spec, operation.requestBody)?.content);
  }
  const responses = isObject(operation.responses) ? operation.responses : {};
  const response = deref(spec, responses[source.status ?? '']);
  if (!response) return undefined;
  return 'swagger' in spec ? response.schema : jsonSchemaOf(response.content);
}

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function label(source: SpecSchemaSource): string {
  const what = source.part === 'request' ? 'Request body' : `Response ${source.status}`;
  return `${source.method.toUpperCase()} ${source.path}: ${what}`;
}

/** Every request and response body in the spec that has a JSON schema, in the spec's order. */
export function specSchemaParts(spec: Json): SpecSchemaPart[] {
  const parts: SpecSchemaPart[] = [];
  const paths = isObject(spec.paths) ? spec.paths : {};
  for (const [path, item] of Object.entries(paths)) {
    const pathItem = deref(spec, item);
    if (!pathItem) continue;
    for (const method of METHODS) {
      const operation = pathItem[method];
      if (!isObject(operation)) continue;
      const operationId = typeof operation.operationId === 'string' ? operation.operationId : undefined;
      const candidates: SpecSchemaSource[] = [
        { method, path, part: 'request' },
        ...Object.keys(isObject(operation.responses) ? operation.responses : {}).map(
          (status): SpecSchemaSource => ({ method, path, part: 'response', status }),
        ),
      ];
      for (const source of candidates) {
        if (deref(spec, bodySchema(spec, operation, pathItem, source))) {
          parts.push({ ...source, operationId, label: label(source) });
        }
      }
    }
  }
  return parts;
}

/** openapi-orders-id-put-request or openapi-orders-post-response-200 (no extension). */
export function schemaFileBase(source: SpecSchemaSource): string {
  const endpoint = source.path.replace(/[^A-Za-z0-9_.]+/g, '-').replace(/^[-.]+|[-.]+$/g, '') || 'root';
  const part = source.part === 'request' ? 'request' : `response-${source.status}`.replace(/[^A-Za-z0-9_-]+/g, '-');
  return `${GENERATED_PREFIX}${endpoint}-${source.method.toLowerCase()}-${part}`;
}

export function sameSource(a: SpecSchemaSource, b: SpecSchemaSource): boolean {
  return (
    a.method.toLowerCase() === b.method.toLowerCase() &&
    a.path === b.path &&
    a.part === b.part &&
    (a.part === 'request' || a.status === b.status)
  );
}

/** Where a generated schema file came from; undefined for any other file. */
export function sourceOf(content: string | undefined): SpecSchemaSource | undefined {
  if (!content) return undefined;
  try {
    const source = (JSON.parse(content) as Json)[SOURCE_KEY];
    if (!isObject(source) || typeof source.method !== 'string' || typeof source.path !== 'string') return undefined;
    if (source.part !== 'request' && source.part !== 'response') return undefined;
    return {
      method: source.method,
      path: source.path,
      part: source.part,
      ...(typeof source.status === 'string' ? { status: source.status } : {}),
    };
  } catch {
    return undefined;
  }
}

export function isGeneratedSchemaName(name: string): boolean {
  return name.startsWith(GENERATED_PREFIX) && name.endsWith(SCHEMA_SUFFIX) && !name.includes('/');
}

/**
 * The body's schema as a standalone JSON Schema: the schemas it refers to go in its $defs, and
 * OpenAPI-only keywords are left out. Undefined when the spec no longer has that body.
 */
export function makeJsonSchema(spec: Json, source: SpecSchemaSource): Json | undefined {
  const pathItem = deref(spec, (isObject(spec.paths) ? spec.paths : {})[source.path]);
  const operation = pathItem?.[source.method.toLowerCase()];
  if (!pathItem || !isObject(operation)) return undefined;
  const root = bodySchema(spec, operation, pathItem, source);
  if (!deref(spec, root)) return undefined;

  const defs: Record<string, unknown> = {};
  const names = new Map<string, string>();
  const nameFor = (ref: string): string => {
    const known = names.get(ref);
    if (known) return known;
    const base = (ref.split('/').pop() || 'schema').replace(/~1/g, '-').replace(/~0/g, '-') || 'schema';
    let name = base;
    for (let i = 2; [...names.values()].includes(name); i++) name = `${base}${i}`;
    names.set(ref, name);
    defs[name] = convert(pointer(spec, ref));
    return name;
  };
  const convert = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(convert);
    if (!isObject(node)) return node;
    const out: Json = {};
    for (const [key, value] of Object.entries(node)) {
      if (OPENAPI_ONLY.has(key) || key.startsWith('x-')) continue;
      if (key === '$ref' && typeof value === 'string') {
        out.$ref = value.startsWith('#/') ? `#/$defs/${nameFor(value)}` : value;
      } else if (key === 'properties' || key === 'patternProperties' || key === 'definitions' || key === '$defs') {
        out[key] = isObject(value) ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, convert(v)])) : value;
      } else {
        out[key] = convert(value);
      }
    }
    return out;
  };

  // The body itself goes at the top (Kaoto reads the fields of the file's root), not as a $ref.
  const body = convert(deref(spec, root)) as Json;
  const schema: Json = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: label(source),
    [SOURCE_KEY]: { method: source.method.toLowerCase(), path: source.path, part: source.part, ...(source.status ? { status: source.status } : {}) },
    ...body,
  };
  if (Object.keys(defs).length) schema.$defs = { ...(isObject(body.$defs) ? body.$defs : {}), ...defs };
  return schema;
}

export function serializeSchema(schema: Json): string {
  return `${JSON.stringify(schema, null, 2)}\n`;
}

/**
 * The file name for source's schema among the flow's files: the generated file already made from it,
 * else openapi-<endpoint>-<method>-<part>.schema.json, with -2, -3... when another file has that name.
 */
export function schemaFileName(source: SpecSchemaSource, existing: Record<string, string | undefined>): string {
  for (const [name, content] of Object.entries(existing)) {
    const from = isGeneratedSchemaName(name) ? sourceOf(content) : undefined;
    if (from && sameSource(from, source)) return name;
  }
  const base = schemaFileBase(source);
  let name = `${base}${SCHEMA_SUFFIX}`;
  for (let i = 2; name in existing; i++) name = `${base}-${i}${SCHEMA_SUFFIX}`;
  return name;
}
