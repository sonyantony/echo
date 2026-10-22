/**
 * Openapi Design > New From Samples: a whole spec (schemas, path and operation) made from one
 * sample request and one sample response. What the samples cannot say (formats, enums, which
 * fields are optional) is left for the user to tweak in the editor afterwards.
 */
export const SAMPLE_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type SampleMethod = (typeof SAMPLE_METHODS)[number];

/** A request body is optional for GET and DELETE, and needed for the others. */
export const bodyOptional = (method: SampleMethod) => method === 'GET' || method === 'DELETE';

/** An operationId ECHO can use as a route name: a letter, then letters, digits and '_'. */
export const OPERATION_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;

/** A path like /cards/{cardId}/activate: segments of letters, digits, '-', '_', '.', or a {name}. */
export const PATH_PATTERN = /^(\/([A-Za-z0-9._~-]+|\{[A-Za-z_][A-Za-z0-9_]*\}))+\/?$|^\/$/;

/** The path as typed, with a leading '/' added when it has none. */
export function normalizePath(path: string): string {
  const trimmed = path.trim();
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

/** The names in {braces}, in order. */
export function pathParameters(path: string): string[] {
  return [...path.matchAll(/\{([^}/]+)\}/g)].map((m) => m[1]);
}

/** Method and path in camelCase: POST /cards/{cardId}/activate is postCardsCardIdActivate. */
export function operationIdFor(method: string, path: string): string {
  const words = path.split(/[^A-Za-z0-9]+/).filter(Boolean);
  return method.toLowerCase() + words.map(capitalize).join('');
}

const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/** Parses a sample; blank is no sample. Throws with a readable message when it is not JSON. */
export function parseSample(text: string): unknown {
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`Not valid JSON: ${(e as Error).message}`);
  }
}

type Schema = Record<string, unknown>;

/**
 * Turns samples into schemas under components.schemas. Every object gets its own named schema
 * (Apicurio shows nested inline objects as "No Type"), named after its parent and field, with a
 * number added when the name is taken.
 */
class SchemaBuilder {
  readonly schemas: Record<string, Schema> = {};

  /** Adds the schema for an object sample under name (or a free variant of it) and returns a $ref to it. */
  object(name: string, sample: Record<string, unknown>): Schema {
    const free = this.freeName(name);
    this.schemas[free] = {}; // claimed before the fields, so nested objects cannot take the name
    const properties: Record<string, Schema> = {};
    const required: string[] = [];
    for (const [field, value] of Object.entries(sample)) {
      properties[field] = this.of(free + capitalize(field.replace(/[^A-Za-z0-9]+(.)?/g, (_m, c: string) => (c ?? '').toUpperCase())), value);
      if (value !== null) required.push(field);
    }
    this.schemas[free] = { type: 'object', ...(required.length ? { required } : {}), properties };
    return { $ref: `#/components/schemas/${free}` };
  }

  /** The schema of any sample value; objects become named schemas. */
  of(name: string, value: unknown): Schema {
    if (value === null) return { type: 'string', nullable: true };
    if (Array.isArray(value)) {
      const first = value.find((v) => v !== null);
      return { type: 'array', items: first === undefined ? {} : this.of(`${name}Item`, mergeObjects(value) ?? first) };
    }
    switch (typeof value) {
      case 'string':
        return { type: 'string', ...stringFormat(value) };
      case 'number':
        return { type: Number.isInteger(value) ? 'integer' : 'number' };
      case 'boolean':
        return { type: 'boolean' };
      case 'object':
        return this.object(name, value as Record<string, unknown>);
      default:
        return {};
    }
  }

  private freeName(name: string): string {
    let free = name;
    for (let n = 2; free in this.schemas; n++) free = `${name}${n}`;
    return free;
  }
}

/** For an array of objects, one object with every field any of them has (a field missing from one is then optional). */
function mergeObjects(values: unknown[]): Record<string, unknown> | undefined {
  const objects = values.filter((v): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v));
  if (objects.length < 2 || objects.length !== values.filter((v) => v !== null).length) return undefined;
  const merged: Record<string, unknown> = {};
  for (const o of objects) {
    for (const [k, v] of Object.entries(o)) if (!(k in merged) || merged[k] === null) merged[k] = v;
  }
  // A field not in every element must not be marked required: null makes it optional.
  for (const k of Object.keys(merged)) if (!objects.every((o) => k in o)) merged[k] = null;
  return merged;
}

function stringFormat(value: string): Schema {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.test(value)) return { format: 'date-time' };
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return { format: 'date' };
  return {};
}

export interface SamplesInput {
  method: SampleMethod;
  path: string;
  operationId: string;
  /** The parsed sample request body; undefined when there is none. */
  request?: unknown;
  /** The parsed sample response body. */
  response: unknown;
  /** The spec on screen (editor JSON), whose info and servers (the Base Path) the new spec keeps. */
  current?: string;
  flowName: string;
  flowDescription?: string | null;
}

/** The complete spec, as the editor's JSON. */
export function specFromSamples(input: SamplesInput): string {
  const { method, operationId, request, response } = input;
  const path = normalizePath(input.path);
  const base = operationId.charAt(0).toUpperCase() + operationId.slice(1);
  const builder = new SchemaBuilder();

  const body = (sample: unknown, name: string) => ({
    content: { 'application/json': { schema: builder.of(name, sample), example: sample } },
  });

  const params = pathParameters(path).map((name) => ({ name, in: 'path', required: true, schema: { type: 'string' } }));
  const operation: Record<string, unknown> = {
    operationId,
    ...(params.length ? { parameters: params } : {}),
    ...(request !== undefined ? { requestBody: { required: true, ...body(request, `${base}Request`) } } : {}),
    responses: { '200': { description: 'OK', ...(response !== undefined ? body(response, `${base}Response`) : {}) } },
  };

  const kept = keptFrom(input.current);
  const spec = {
    openapi: '3.0.3',
    info: kept.info ?? { title: input.flowName, version: '1.0.0', ...(input.flowDescription ? { description: input.flowDescription } : {}) },
    ...(kept.servers ? { servers: kept.servers } : {}),
    paths: { [path]: { [method.toLowerCase()]: operation } },
    components: { schemas: builder.schemas },
  };
  return JSON.stringify(spec, null, 2);
}

function keptFrom(current: string | undefined): { info?: unknown; servers?: unknown } {
  if (!current) return {};
  try {
    const doc = JSON.parse(current) as Record<string, unknown>;
    return { info: doc.info, servers: doc.servers };
  } catch {
    return {};
  }
}
