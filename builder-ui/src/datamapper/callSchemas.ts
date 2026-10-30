import YAML from 'yaml';
import { updateKaotoMetadata, type FlowFiles } from '../editor/flowFiles';
import { EMPTY_XSL, mappedXslFiles } from './scaffoldSchemas';
import { makeJsonSchema, serializeSchema, specSchemaParts } from './specSchemas';

/**
 * The target of a scaffold's request DataMapper (the one before a REST OpenApi step, routeForOperation)
 * follows the operation that step calls: once the step has a Specification Uri and an Operation Id,
 * the request body of that operation in the approved API's spec becomes the DataMapper's target, as
 * api-<api>-<operationId>-request.schema.json. While nothing is mapped it follows a change of
 * operation, and goes when the step calls nothing. A target the user attached is theirs.
 */

type Json = Record<string, unknown>;

/** A request DataMapper and the call right after it. */
export interface MapperCall {
  stepId: string;
  /** The approved spec's file name, e.g. blueplanet.openapi.json; undefined while none is picked. */
  specificationUri?: string;
  operationId?: string;
  /** The DataMapper's XSLT file, when its step names one (`xslt-saxon:<file>`). */
  xslt?: string;
}

const REQUEST_MAPPER = /^kaoto-datamapper-request-.+-\d+$/;
export const CALL_SCHEMA_PREFIX = 'api-';

const isObject = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** The scaffolds' request DataMappers in the route YAML, each with the REST OpenApi step after it. */
export function mapperCalls(yaml: string): MapperCall[] {
  let doc: unknown;
  try {
    doc = YAML.parse(yaml);
  } catch {
    return [];
  }
  const found: MapperCall[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach((item, i) => {
        const step = isObject(item) && isObject(item.step) ? item.step : undefined;
        const next = node[i + 1];
        const to = isObject(next) && isObject(next.to) ? next.to : undefined;
        if (step && typeof step.id === 'string' && REQUEST_MAPPER.test(step.id) && to?.uri === 'rest-openapi') {
          const parameters = isObject(to.parameters) ? to.parameters : {};
          const xslt = (Array.isArray(step.steps) ? step.steps : [])
            .map((s) => (isObject(s) && isObject(s.to) ? text(s.to.uri) : undefined))
            .find((uri) => uri?.startsWith('xslt-saxon:'));
          found.push({
            stepId: step.id,
            specificationUri: text(parameters.specificationUri)?.replace(/^classpath:/, ''),
            operationId: text(parameters.operationId),
            xslt: xslt?.slice('xslt-saxon:'.length),
          });
        }
        visit(item);
      });
    } else if (isObject(node)) {
      Object.values(node).forEach(visit);
    }
  };
  visit(doc);
  return found;
}

/** api-blueplanet-createService-request.schema.json for blueplanet.openapi.json and createService. */
export function callSchemaName(specificationUri: string, operationId: string): string {
  const api = specificationUri.replace(/\.openapi\.json$/, '').replace(/\.[^.]+$/, '');
  const safe = (s: string) => s.replace(/[^A-Za-z0-9_.-]+/g, '-');
  return `${CALL_SCHEMA_PREFIX}${safe(api)}-${safe(operationId)}-request.schema.json`;
}

const targetFile = (metadata: unknown): string | undefined => {
  const path = (metadata as { targetBody?: { filePath?: unknown } } | undefined)?.targetBody?.filePath;
  return Array.isArray(path) && typeof path[0] === 'string' ? path[0] : undefined;
};

const document = (file?: string) => ({ type: file ? 'JSON Schema' : 'Primitive', filePath: file ? [file] : [], fieldTypeOverrides: [] });

/**
 * Sets the target of each scaffold request DataMapper whose XSLT file is named (a schema attached,
 * or opened in the DataMapper) and has nothing mapped to the request body of the operation its call
 * picks, writing that schema's file. `loadSpec` reads an approved API's spec (undefined if unknown).
 *
 * @returns the step ids of request DataMappers that call a picked operation but have no XSLT file
 *   named yet: their route needs one (withXsltFile) before the metadata can be written.
 */
export async function attachCallTargets(
  files: FlowFiles,
  yaml: string,
  loadSpec: (specificationUri: string) => Promise<Json | undefined>,
): Promise<string[]> {
  const calls = mapperCalls(yaml);
  if (!calls.length) return [];
  const mapped = await mappedXslFiles(files);
  const names = await files.list();
  const unnamed: string[] = [];
  const targets = new Map<string, { xslt: string; file?: string }>();
  const specs = new Map<string, Promise<Json | undefined>>();
  for (const call of calls) {
    const picked = call.specificationUri && call.operationId ? call : undefined;
    if (!call.xslt) {
      if (picked) unnamed.push(call.stepId);
      continue;
    }
    if (mapped.has(call.xslt)) continue;
    let file: string | undefined;
    if (picked) {
      const uri = picked.specificationUri!;
      if (!specs.has(uri)) specs.set(uri, loadSpec(uri).catch(() => undefined));
      const spec = await specs.get(uri)!;
      const part = spec && specSchemaParts(spec).find((p) => p.operationId === picked.operationId && p.part === 'request');
      const schema = spec && part ? makeJsonSchema(spec, part) : undefined;
      if (schema) {
        file = callSchemaName(uri, picked.operationId!);
        const content = serializeSchema(schema);
        if ((await files.read(file)) !== content) await files.write(file, content);
      }
    }
    targets.set(call.stepId, { xslt: call.xslt, file });
  }
  for (const { xslt } of targets.values()) {
    if (!names.includes(xslt)) await files.write(xslt, EMPTY_XSL);
  }
  await updateKaotoMetadata(files, (metadata) => {
    for (const [stepId, { xslt, file }] of targets) {
      const was = metadata[stepId];
      const current = targetFile(was);
      // A target the user attached stays theirs.
      if (current && !current.startsWith(CALL_SCHEMA_PREFIX)) continue;
      if (current === file) continue;
      if (!file && !isObject(was)) continue;
      metadata[stepId] = {
        xsltPath: xslt,
        sourceParameters: {},
        sourceBody: document(),
        namespaceMap: {},
        ...(isObject(was) ? was : {}),
        targetBody: document(file),
      };
    }
  });
  return unnamed;
}

/**
 * The route YAML with these request DataMappers' XSLT steps naming their file
 * (`xslt-saxon:<step id>.xsl`), as Kaoto names it when the DataMapper is first opened.
 */
export function withXsltFile(yaml: string, stepIds: string[]): string {
  if (!stepIds.length) return yaml;
  const doc = YAML.parseDocument(yaml);
  let changed = false;
  YAML.visit(doc, {
    Map(_, map) {
      const step = map.get('step');
      if (!YAML.isMap(step) || !stepIds.includes(String(step.get('id')))) return;
      const steps = step.get('steps');
      if (!YAML.isSeq(steps)) return;
      for (const item of steps.items) {
        const to = YAML.isMap(item) ? item.get('to') : undefined;
        if (YAML.isMap(to) && to.get('uri') === 'xslt-saxon') {
          to.set('uri', `xslt-saxon:${step.get('id')}.xsl`);
          changed = true;
        }
      }
    },
  });
  return changed ? doc.toString({ lineWidth: 0 }) : yaml;
}

const LABEL = /^"([^"]*)": \$\{body\}$/;

/** The approved specs (file names) the route's REST OpenApi steps call an operation of. */
export function calledSpecs(yaml: string): string[] {
  const uris = new Set<string>();
  for (const m of yaml.matchAll(/specificationUri: (?:classpath:)?(\S+)/g)) uris.add(m[1].replace(/^["']|["']$/g, ''));
  return [...uris];
}

/**
 * The route YAML with each scaffold call's reply labelled after the operation it picks: the
 * pipeline's Set Body `"result": ${body}` after a REST OpenApi step with an Operation Id becomes
 * `"<operationId>": ${body}`, and follows a later change of operation (a label naming another
 * operation of the same spec, `operationIds`). A name the user gave stays. Unchanged (the same
 * string) otherwise.
 */
export function withCallLabels(yaml: string, operationIds: (specificationUri: string) => ReadonlySet<string> | undefined): string {
  if (!yaml.includes('rest-openapi')) return yaml;
  const doc = YAML.parseDocument(yaml);
  if (doc.errors.length) return yaml;
  let changed = false;
  YAML.visit(doc, {
    Seq(_, seq) {
      seq.items.forEach((item, i) => {
        const to = YAML.isMap(item) ? item.get('to') : undefined;
        if (!YAML.isMap(to) || to.get('uri') !== 'rest-openapi') return;
        const parameters = to.get('parameters');
        const operationId = YAML.isMap(parameters) ? text(parameters.get('operationId')) : undefined;
        const uri = YAML.isMap(parameters) ? text(parameters.get('specificationUri'))?.replace(/^classpath:/, '') : undefined;
        if (!operationId) return;
        for (const next of seq.items.slice(i + 1)) {
          const setBody = YAML.isMap(next) ? next.get('setBody') : undefined;
          if (!YAML.isMap(setBody)) continue;
          const id = String(setBody.get('id') ?? '');
          const label = LABEL.exec(String(setBody.get('simple') ?? ''))?.[1];
          if (id.startsWith('label-') && label !== undefined && label !== operationId) {
            if (label === 'result' || (uri && operationIds(uri)?.has(label))) {
              setBody.set('simple', `"${operationId}": \${body}`);
              changed = true;
            }
          }
          break;
        }
      });
    },
  });
  return changed ? doc.toString({ lineWidth: 0 }) : yaml;
}

/** The operationIds of a spec. */
export function operationIdsOf(spec: Json): string[] {
  const ids: string[] = [];
  for (const item of Object.values(isObject(spec.paths) ? spec.paths : {})) {
    for (const op of Object.values(isObject(item) ? item : {})) {
      const id = isObject(op) ? text(op.operationId) : undefined;
      if (id) ids.push(id);
    }
  }
  return ids;
}
