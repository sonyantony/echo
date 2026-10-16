/** The flow's OpenAPI spec is a side file next to the Camel YAML, like the DataMapper schemas. */
export const OPENAPI_FILE = 'openapi.json';

/** The spec a flow starts with when it has none yet. */
export function newApiSpec(flowName: string, description?: string | null): string {
  const spec = {
    openapi: '3.0.3',
    info: { title: flowName, version: '1.0.0', ...(description ? { description } : {}) },
    paths: {},
    components: {},
  };
  return JSON.stringify(spec, null, 2);
}
