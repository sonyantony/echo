import YAML from 'yaml';

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

/** The editor's JSON in the file's format. */
export function serialize(editorJson: string, format: SpecFormat): string {
  if (format === 'json') return editorJson;
  return YAML.stringify(JSON.parse(editorJson), { lineWidth: 0 });
}
