import YAML from 'yaml';
import { KAOTO_METADATA_FILE, type FlowFiles } from '../editor/flowFiles';
import { checkPaths, mappedFields, type FieldStep } from './mappingCheck';
import { isGeneratedSchemaName, makeJsonSchema, serializeSchema, sourceOf, type SpecSchemaSource } from './specSchemas';

type Json = Record<string, unknown>;

/** A DataMapper step whose mapping uses fields its schema (made from the spec) no longer has. */
export interface MappingWarning {
  /** The route the step is in, when the Camel YAML says. */
  routeId?: string;
  stepId: string;
  /** "source body", "target body" or "parameter <name>". */
  side: string;
  schemaFile: string;
  problems: string[];
}

interface DocumentMetadata {
  filePath?: string[];
}

interface StepMetadata {
  xsltPath?: string;
  sourceBody?: DocumentMetadata;
  targetBody?: DocumentMetadata;
  sourceParameters?: Record<string, DocumentMetadata>;
}

const isObject = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);

const describe = (s: SpecSchemaSource) =>
  `${s.method.toUpperCase()} ${s.path} ${s.part === 'request' ? 'request body' : `response ${s.status}`}`;

/**
 * Makes each schema file ECHO generated from the spec again from spec (the spec just saved),
 * writing those that changed. Returns, by file, why it could not be made: its body is gone from the spec.
 */
export async function refreshSpecSchemas(files: FlowFiles, names: string[], spec: Json): Promise<Map<string, string>> {
  const gone = new Map<string, string>();
  for (const name of names.filter(isGeneratedSchemaName)) {
    const current = await files.read(name);
    const source = sourceOf(current);
    if (!source) continue;
    const schema = makeJsonSchema(spec, source);
    if (!schema) {
      gone.set(name, `${describe(source)} is no longer in the Openapi spec`);
      continue;
    }
    const text = serializeSchema(schema);
    if (text !== current) await files.write(name, text);
  }
  return gone;
}

/** The id of the route holding the step with id stepId. */
function routeOf(routeYaml: string | undefined, stepId: string): string | undefined {
  if (!routeYaml) return undefined;
  let doc: unknown;
  try {
    doc = YAML.parse(routeYaml);
  } catch {
    return undefined;
  }
  const holds = (node: unknown): boolean =>
    Array.isArray(node) ? node.some(holds) : isObject(node) && (node.id === stepId || Object.values(node).some(holds));
  for (const entry of Array.isArray(doc) ? doc : []) {
    if (isObject(entry) && isObject(entry.route) && holds(entry.route)) {
      return typeof entry.route.id === 'string' ? entry.route.id : undefined;
    }
  }
  return undefined;
}

/**
 * The DataMapper steps whose mappings use fields that the spec's schemas (the openapi-*.schema.json
 * files) do not have, or whose schema's body is gone from the spec (gone, from refreshSpecSchemas).
 */
export async function checkSpecMappings(
  files: FlowFiles,
  gone: Map<string, string> = new Map(),
  routeYaml?: string,
): Promise<MappingWarning[]> {
  let metadata: Record<string, StepMetadata>;
  try {
    metadata = JSON.parse((await files.read(KAOTO_METADATA_FILE)) ?? '{}');
  } catch {
    return [];
  }
  const warnings: MappingWarning[] = [];
  for (const [stepId, step] of Object.entries(isObject(metadata) ? metadata : {})) {
    if (!isObject(step)) continue;
    const sides: { side: string; doc?: DocumentMetadata; paths: (m: ReturnType<typeof mappedFields>) => FieldStep[][] }[] = [
      { side: 'source body', doc: step.sourceBody, paths: (m) => m.source },
      { side: 'target body', doc: step.targetBody, paths: (m) => m.target },
      ...Object.entries(step.sourceParameters ?? {}).map(([param, doc]) => ({
        side: `parameter ${param}`,
        doc,
        paths: (m: ReturnType<typeof mappedFields>) => m.parameters[param] ?? [],
      })),
    ];
    const generated = sides
      .map((s) => ({ ...s, schemaFile: (s.doc?.filePath ?? []).find(isGeneratedSchemaName) }))
      .filter((s): s is typeof s & { schemaFile: string } => !!s.schemaFile);
    if (!generated.length) continue;

    const xsl = typeof step.xsltPath === 'string' ? await files.read(step.xsltPath) : undefined;
    const mapped = xsl ? mappedFields(xsl) : undefined;
    for (const s of generated) {
      let problems: string[];
      const reason = gone.get(s.schemaFile);
      if (reason) {
        problems = [reason];
      } else {
        if (!mapped) continue;
        let schema: Json;
        try {
          schema = JSON.parse((await files.read(s.schemaFile)) ?? '');
        } catch {
          continue;
        }
        problems = checkPaths(schema, s.paths(mapped));
      }
      if (problems.length) {
        warnings.push({ routeId: routeOf(routeYaml, stepId), stepId, side: s.side, schemaFile: s.schemaFile, problems });
      }
    }
  }
  return warnings;
}
