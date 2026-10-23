/**
 * Finds the fields a DataMapper mapping uses that its schemas no longer have. Kaoto writes each
 * mapping as XSLT 3 over the XPath JSON representation: source fields are read with paths such as
 * /fn:map/fn:map[@key='customer']/fn:string[@key='name'], and target fields are written as
 * <string key="name"> elements inside <map> and <array>.
 */

type Json = Record<string, unknown>;

const XSL_NS = 'http://www.w3.org/1999/XSL/Transform';
const FN_NS = 'http://www.w3.org/2005/xpath-functions';
const FN_TYPES = new Set(['map', 'array', 'string', 'number', 'boolean', 'null']);

/** One step down a JSON document: a property of an object (key) or the items of an array. */
export interface FieldStep {
  key?: string;
  /** XPath JSON type: map, array, string, number, boolean or null. */
  type: string;
}

export interface MappedFields {
  /** Paths read from the source body. */
  source: FieldStep[][];
  /** Paths read from each parameter ($name). */
  parameters: Record<string, FieldStep[][]>;
  /** Paths the target body is written to. */
  target: FieldStep[][];
}

const SEGMENT = String.raw`fn:(\w+)(?:\[@key='([^']*)'\])?`;
const PATH = new RegExp(String.raw`(\$[A-Za-z_][\w.-]*)?(/)?(${SEGMENT}(?:/${SEGMENT})*)`, 'g');

function segments(path: string): FieldStep[] {
  return path.split('/').map((s) => {
    const m = /^fn:(\w+)(?:\[@key='([^']*)'\])?$/.exec(s);
    return m ? { type: m[1], ...(m[2] !== undefined ? { key: m[2] } : {}) } : { type: '' };
  });
}

interface Context {
  /** $name, or '' for the source body. */
  doc: string;
  steps: FieldStep[];
}

/** The absolute paths an XPath expression reads, resolved against the for-each context. */
function readPaths(expression: string, context: Context | undefined): Context[] {
  const found: Context[] = [];
  for (const m of expression.matchAll(PATH)) {
    const [, variable, slash, path] = m;
    const steps = segments(path);
    if (steps.some((s) => !FN_TYPES.has(s.type))) continue;
    if (variable) found.push({ doc: variable.slice(1), steps });
    else if (slash) found.push({ doc: '', steps });
    else if (context) found.push({ doc: context.doc, steps: [...context.steps, ...steps] });
  }
  return found;
}

/** Leaves out the document's root (a path starts at it) and keeps the steps below it. */
const belowRoot = (steps: FieldStep[]) => steps.slice(1);

export function mappedFields(xsl: string): MappedFields {
  const result: MappedFields = { source: [], parameters: {}, target: [] };
  const doc = new DOMParser().parseFromString(xsl, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) return result;

  const addRead = (read: Context) => {
    const steps = belowRoot(read.steps);
    if (!steps.length) return;
    if (read.doc === '') result.source.push(steps);
    else (result.parameters[read.doc] ??= []).push(steps);
  };

  /** target: where the target document is written so far; null outside the mapped-xml variable, [] before its root. */
  const walk = (el: Element, context: Context | undefined, target: FieldStep[] | null, rootSeen: boolean) => {
    let nextContext = context;
    let nextTarget = target;
    let nextRootSeen = rootSeen;
    if (el.namespaceURI === XSL_NS) {
      for (const attr of ['select', 'test', 'group-by']) {
        const value = el.getAttribute(attr);
        if (!value) continue;
        const reads = readPaths(value, context);
        reads.forEach(addRead);
        if (el.localName === 'for-each' && attr === 'select' && reads[0]) nextContext = reads[0];
      }
      if (el.localName === 'variable' && el.getAttribute('name') === 'mapped-xml') {
        nextTarget = [];
        nextRootSeen = false;
      }
    } else if (el.namespaceURI === FN_NS && FN_TYPES.has(el.localName) && target) {
      if (!rootSeen) {
        // The target document's root map is not a field.
        nextRootSeen = true;
      } else {
        const key = el.getAttribute('key');
        nextTarget = [...target, { type: el.localName, ...(key !== null ? { key } : {}) }];
        result.target.push(nextTarget);
      }
    }
    for (const child of Array.from(el.children)) walk(child, nextContext, nextTarget, nextRootSeen);
  };
  walk(doc.documentElement, undefined, null, false);
  return result;
}

/** What JSON Schema type an XPath JSON type stands for. */
const SCHEMA_TYPES: Record<string, string[]> = {
  map: ['object'],
  array: ['array'],
  string: ['string'],
  number: ['number', 'integer'],
  boolean: ['boolean'],
  null: ['null'],
};

/** Follows $ref within the schema file and merges allOf, oneOf and anyOf, so properties can be looked up. */
function resolve(schema: Json, node: unknown, depth = 0): Json[] {
  if (!node || typeof node !== 'object' || Array.isArray(node) || depth > 32) return [];
  const n = node as Json;
  if (typeof n.$ref === 'string') {
    const target = n.$ref.startsWith('#/')
      ? n.$ref
          .slice(2)
          .split('/')
          .reduce<unknown>((cur, k) => (cur && typeof cur === 'object' ? (cur as Json)[k] : undefined), schema)
      : undefined;
    return resolve(schema, target, depth + 1);
  }
  const all = [n];
  for (const k of ['allOf', 'oneOf', 'anyOf']) {
    if (Array.isArray(n[k])) for (const sub of n[k] as unknown[]) all.push(...resolve(schema, sub, depth + 1));
  }
  return all;
}

function typesOf(nodes: Json[]): string[] {
  const types = new Set<string>();
  for (const n of nodes) {
    if (typeof n.type === 'string') types.add(n.type);
    else if (Array.isArray(n.type)) n.type.forEach((t) => typeof t === 'string' && types.add(t));
    if (n.properties) types.add('object');
    if (n.items) types.add('array');
  }
  types.delete('null');
  return [...types];
}

const fieldName = (steps: FieldStep[]) =>
  steps.map((s, i) => (s.key !== undefined ? (i ? `.${s.key}` : s.key) : '[]')).join('').replace(/^\./, '') || '(body)';

/**
 * Problems with the mapped paths against the schema, e.g. "customer.email is not in the schema".
 * Only the first missing step of a path is told, once.
 */
export function checkPaths(schema: Json, paths: FieldStep[][]): string[] {
  const problems = new Map<string, string>();
  for (const path of paths) {
    let nodes = resolve(schema, schema);
    for (let i = 0; i < path.length; i++) {
      const step = path[i];
      const here = path.slice(0, i + 1);
      const name = fieldName(here);
      let next: Json[] = [];
      if (step.key !== undefined) {
        const holders = nodes.filter((n) => n.properties && typeof n.properties === 'object');
        if (!holders.length) break; // No properties declared: anything may be there.
        for (const h of holders) {
          const prop = (h.properties as Json)[step.key];
          if (prop !== undefined) next.push(...resolve(schema, prop));
        }
        if (!next.length) {
          problems.set(name, `${name} is not in the schema`);
          break;
        }
      } else {
        for (const n of nodes) if (n.items !== undefined) next.push(...resolve(schema, n.items));
        if (!next.length) break;
      }
      const types = typesOf(next);
      if (types.length && !types.some((t) => SCHEMA_TYPES[step.type]?.includes(t))) {
        problems.set(name, `${name} is ${types.join(' or ')} in the schema; the mapping uses it as ${SCHEMA_TYPES[step.type]?.[0] ?? step.type}`);
        break;
      }
      nodes = next;
    }
  }
  return [...problems.values()];
}
