import YAML, { isAlias, isMap, isScalar, isSeq, type Document } from 'yaml';

/**
 * A flow's OpenAPI spec is a side file next to the Camel YAML, like the DataMapper schemas. It
 * keeps the name it was uploaded or saved with (flows made before that have openapi.json), in
 * JSON or YAML; the backend finds it by its content and says which file it is (FlowDetail.apiSpec).
 */
export type SpecFormat = 'yaml' | 'json';

/** What a spec file name may look like (the backend checks the same). */
export const SPEC_NAME_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]*\.(json|ya?ml)$/i;
export const SPEC_NAME_HINT = "Letters, digits, '.', '-' and '_'. The extension follows the format.";

/** The spec a flow starts with when it has none yet, or after Discard. */
export function newApiSpec(flowName: string, description?: string | null): string {
  const spec = {
    openapi: '3.0.3',
    info: { title: flowName, version: '1.0.0', ...(description ? { description } : {}) },
    paths: {},
    components: {},
  };
  return JSON.stringify(spec, null, 2);
}

export function formatOf(name: string): SpecFormat | undefined {
  if (/\.ya?ml$/i.test(name)) return 'yaml';
  if (/\.json$/i.test(name)) return 'json';
  return undefined;
}

export function stripExtension(name: string): string {
  return name.replace(/\.(json|ya?ml)$/i, '');
}

/** The name ECHO offers for a flow's new spec, without extension: <flow name>-api (orders -> orders-api). */
export function defaultSpecBase(flowName: string): string {
  const base = flowName.trim().replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^[^A-Za-z0-9_]+/, '');
  return `${base || 'flow'}-api`;
}

/** The name with the extension of format: customer.json as YAML is customer.yaml (a .yml file stays .yml). */
export function withFormat(name: string, format: SpecFormat): string {
  if (formatOf(name) === format) return name;
  return `${stripExtension(name)}.${format}`;
}

/** Reads a spec in JSON or YAML (YAML reads JSON too). Throws if it is not an OpenAPI or Swagger document. */
export function parseSpec(text: string): Record<string, unknown> {
  let doc: unknown;
  try {
    doc = YAML.parse(text);
  } catch (e) {
    throw new Error(`This file is neither JSON nor YAML: ${(e as Error).message}`);
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) || !('openapi' in doc || 'swagger' in doc)) {
    throw new Error("This is not an OpenAPI spec: it needs an 'openapi' (or Swagger 2.0 'swagger') field at the top.");
  }
  return doc as Record<string, unknown>;
}

/** The spec as the editor takes it (and gives it back): formatted JSON. */
export function toEditorJson(text: string): string {
  return JSON.stringify(parseSpec(text), null, 2);
}

/**
 * The editor's JSON in the file's format. With the file as it was (`previous`), only what changed
 * is written: in YAML its comments, layout and quoting stay wherever the spec did not change (a
 * comment goes with what it is on when that is deleted), and a file whose spec did not change at
 * all comes back as it was.
 *
 * @param previous the file before the change (an upload, or the spec as stored), if any
 */
export function serialize(editorJson: string, format: SpecFormat, previous?: string): string {
  const value: unknown = JSON.parse(editorJson);
  if (format === 'json') {
    return previous !== undefined && /^\s*\{/.test(previous) && sameJson(previous, value) ? previous : editorJson;
  }
  // A JSON file saved as YAML for the first time has no YAML layout to keep.
  if (previous !== undefined && !/^\s*\{/.test(previous)) {
    const doc = YAML.parseDocument(previous);
    if (!doc.errors.length && doc.contents) {
      const changed = { value: false };
      doc.contents = merged(doc, doc.contents, value, changed) as typeof doc.contents;
      return changed.value ? doc.toString({ lineWidth: 0 }) : previous;
    }
  }
  return YAML.stringify(value, { lineWidth: 0 });
}

function sameJson(text: string, value: unknown): boolean {
  try {
    return JSON.stringify(JSON.parse(text)) === JSON.stringify(value);
  } catch {
    return false;
  }
}

const keyOf = (key: unknown) => String(isScalar(key) ? key.value : key);

/**
 * The YAML node changed in place to hold value: maps and lists keep their entries' order (new ones
 * go last), and an entry or scalar that stays keeps its comments. A node of another kind is replaced,
 * keeping the comments on it.
 */
function merged(doc: Document, node: unknown, value: unknown, changed: { value: boolean }): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value) && isMap(node)) {
    const entries = value as Record<string, unknown>;
    const before = node.items.length;
    node.items = node.items.filter((pair) => Object.hasOwn(entries, keyOf(pair.key)));
    if (node.items.length !== before) changed.value = true;
    for (const [key, v] of Object.entries(entries)) {
      const pair = node.items.find((p) => keyOf(p.key) === key);
      if (pair) {
        pair.value = merged(doc, pair.value, v, changed);
      } else {
        node.items.push(doc.createPair(key, v));
        changed.value = true;
      }
    }
    return node;
  }
  if (Array.isArray(value) && isSeq(node)) {
    if (node.items.length > value.length) {
      node.items.splice(value.length);
      changed.value = true;
    }
    value.forEach((v, i) => {
      if (i < node.items.length) {
        node.items[i] = merged(doc, node.items[i], v, changed);
      } else {
        node.items.push(doc.createNode(v));
        changed.value = true;
      }
    });
    return node;
  }
  if (isScalar(node) && (value === null || typeof value !== 'object')) {
    if (node.value === value) return node;
    if (node.value === null || value === null || typeof node.value === typeof value) {
      node.value = value;
      changed.value = true;
      return node;
    }
  }
  if (isAlias(node) && JSON.stringify(node.resolve(doc)?.toJSON()) === JSON.stringify(value)) return node;
  changed.value = true;
  const created = doc.createNode(value);
  if (node && typeof node === 'object' && 'commentBefore' in node) {
    const old = node as { commentBefore?: string | null; comment?: string | null };
    created.commentBefore = old.commentBefore;
    created.comment = old.comment;
  }
  return created;
}

/** The spec's info.title, if it has one. */
export function titleOf(editorJson: string): string | undefined {
  const info = (JSON.parse(editorJson) as { info?: { title?: unknown } }).info;
  return typeof info?.title === 'string' ? info.title : undefined;
}

/** The spec's info.description, if it has one. */
export function descriptionOf(editorJson: string): string | undefined {
  const info = (JSON.parse(editorJson) as { info?: { description?: unknown } }).info;
  return typeof info?.description === 'string' ? info.description : undefined;
}

/** The spec's paths (the keys of its paths object), as the editor's JSON has them; none if it cannot be read. */
export function pathsOf(editorJson: string | undefined): string[] {
  try {
    const paths = editorJson === undefined ? undefined : (JSON.parse(editorJson) as { paths?: unknown }).paths;
    return paths && typeof paths === 'object' ? Object.keys(paths) : [];
  } catch {
    return [];
  }
}

/** The editor's JSON without these paths (and their operations). */
export function withoutPaths(editorJson: string, paths: string[]): string {
  const spec = JSON.parse(editorJson) as { paths?: Record<string, unknown> };
  if (!spec.paths) return editorJson;
  for (const path of paths) delete spec.paths[path];
  return JSON.stringify(spec);
}
