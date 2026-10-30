import YAML from 'yaml';
import { callDescription, pipelineDescription } from '../apispec/operationIds';
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

/** A scaffold's reply DataMapper (the one after the multicast) and the calls of the multicast's pipelines. */
export interface ReplyMapper {
  stepId: string;
  /** The DataMapper's XSLT file, when its step names one. */
  xslt?: string;
  /** Each pipeline's reply label (`"<label>": ${body}`) and the operation its REST OpenApi step picks. */
  calls: { label: string; specificationUri?: string; operationId?: string }[];
}

const REPLY_MAPPER = /^kaoto-datamapper-(?!request-).+$/;

const xsltOf = (step: Json) =>
  (Array.isArray(step.steps) ? step.steps : [])
    .map((s) => (isObject(s) && isObject(s.to) ? text(s.to.uri) : undefined))
    .find((uri) => uri?.startsWith('xslt-saxon:'))
    ?.slice('xslt-saxon:'.length);

/** The labelled calls of a multicast's pipelines (a step list each, or a step of its own). */
function pipelineCalls(multicast: Json): ReplyMapper['calls'] {
  const calls: ReplyMapper['calls'] = [];
  for (const branch of Array.isArray(multicast.steps) ? multicast.steps : []) {
    const pipeline = isObject(branch) && isObject(branch.pipeline) ? branch.pipeline : undefined;
    const steps: unknown[] = pipeline && Array.isArray(pipeline.steps) ? pipeline.steps : [branch];
    let call: Json | undefined;
    for (const step of steps) {
      if (!isObject(step)) continue;
      if (isObject(step.to) && step.to.uri === 'rest-openapi') call = isObject(step.to.parameters) ? step.to.parameters : {};
      const label = isObject(step.setBody) ? LABEL.exec(String(step.setBody.simple ?? ''))?.[1] : undefined;
      if (label !== undefined) {
        calls.push({
          label,
          specificationUri: call && text(call.specificationUri)?.replace(/^classpath:/, ''),
          operationId: call && text(call.operationId),
        });
        call = undefined;
      }
    }
  }
  return calls;
}

/** The scaffolds' reply DataMappers in the route YAML, each with the multicast before it. */
export function replyMappers(yaml: string): ReplyMapper[] {
  let doc: unknown;
  try {
    doc = YAML.parse(yaml);
  } catch {
    return [];
  }
  const found: ReplyMapper[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      let multicast: Json | undefined;
      for (const item of node) {
        if (isObject(item) && isObject(item.multicast)) multicast = item.multicast;
        const step = isObject(item) && isObject(item.step) ? item.step : undefined;
        if (multicast && step && typeof step.id === 'string' && REPLY_MAPPER.test(step.id)) {
          found.push({ stepId: step.id, xslt: xsltOf(step), calls: pipelineCalls(multicast) });
          multicast = undefined;
        }
        visit(item);
      }
    } else if (isObject(node)) {
      Object.values(node).forEach(visit);
    }
  };
  visit(doc);
  return found;
}

/** api-replies-getOrders.schema.json for the reply DataMapper kaoto-datamapper-getOrders. */
export function replySchemaName(stepId: string): string {
  return `${CALL_SCHEMA_PREFIX}replies-${stepId.replace(/^kaoto-datamapper-/, '').replace(/[^A-Za-z0-9_.-]+/g, '-')}.schema.json`;
}

/** The response body schema of an operation: 200, else another 2xx, else default. */
function responseSchema(spec: Json, operationId: string): Json | undefined {
  const responses = specSchemaParts(spec).filter((p) => p.operationId === operationId && p.part === 'response');
  const part =
    responses.find((p) => p.status === '200') ??
    responses.find((p) => /^2\d\d$/.test(p.status ?? '')) ??
    responses.find((p) => p.status === 'default');
  return part ? makeJsonSchema(spec, part) : undefined;
}

/**
 * The schema of the multicast's joined replies, `{"<label>": <reply>, ...}`: an object with a
 * property per labelled pipeline whose call picks an operation with a response body, typed by that
 * body. Each reply's $defs are kept under its label. Undefined when no pipeline has one.
 */
export async function repliesSchema(
  calls: ReplyMapper['calls'],
  loadSpec: (specificationUri: string) => Promise<Json | undefined>,
): Promise<Json | undefined> {
  const properties: Json = {};
  const defs: Json = {};
  for (const { label, specificationUri, operationId } of calls) {
    if (!specificationUri || !operationId) continue;
    const spec = await loadSpec(specificationUri);
    const schema = spec && responseSchema(spec, operationId);
    if (!schema) continue;
    const prefix = `${label.replace(/[^A-Za-z0-9_.-]+/g, '-')}.`;
    const body = JSON.parse(JSON.stringify(schema).replaceAll('"#/$defs/', `"#/$defs/${prefix}`)) as Json;
    const $defs = body.$defs;
    for (const key of ['$schema', 'title', '$defs', 'x-echo-openapi']) delete body[key];
    properties[label] = body;
    for (const [name, def] of Object.entries(isObject($defs) ? $defs : {})) defs[`${prefix}${name}`] = def;
  }
  if (!Object.keys(properties).length) return undefined;
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'Replies of the calls',
    type: 'object',
    properties,
    ...(Object.keys(defs).length ? { $defs: defs } : {}),
  };
}

const sourceFile = (metadata: unknown): string | undefined => {
  const path = (metadata as { sourceBody?: { filePath?: unknown } } | undefined)?.sourceBody?.filePath;
  return Array.isArray(path) && typeof path[0] === 'string' ? path[0] : undefined;
};

/**
 * Sets the source of each scaffold reply DataMapper with nothing mapped to the schema of the
 * multicast's joined replies (repliesSchema), as api-replies-<operationId>.schema.json, following
 * the operations the calls pick and the labels; with none, the source goes back to none. A source
 * the user attached stays theirs.
 *
 * @returns `unnamed`: reply DataMappers with a schema to take but no XSLT file named yet
 *   (withXsltFile); `json`: whether each DataMapper whose source ECHO set reads the body as JSON
 *   now (withJsonSources).
 */
export async function attachReplySources(
  files: FlowFiles,
  yaml: string,
  loadSpec: (specificationUri: string) => Promise<Json | undefined>,
): Promise<{ unnamed: string[]; json: Map<string, boolean> }> {
  const unnamed: string[] = [];
  const json = new Map<string, boolean>();
  const mappers = replyMappers(yaml);
  if (!mappers.length) return { unnamed, json };
  const mapped = await mappedXslFiles(files);
  const names = await files.list();
  const specs = new Map<string, Promise<Json | undefined>>();
  const load = (uri: string) => {
    if (!specs.has(uri)) specs.set(uri, loadSpec(uri).catch(() => undefined));
    return specs.get(uri)!;
  };
  const sources = new Map<string, { xslt: string; file?: string }>();
  for (const mapper of mappers) {
    if (mapper.xslt && mapped.has(mapper.xslt)) continue;
    const schema = await repliesSchema(mapper.calls, load);
    if (!mapper.xslt) {
      if (schema) unnamed.push(mapper.stepId);
      continue;
    }
    let file: string | undefined;
    if (schema) {
      file = replySchemaName(mapper.stepId);
      const content = serializeSchema(schema);
      if ((await files.read(file)) !== content) await files.write(file, content);
    }
    sources.set(mapper.stepId, { xslt: mapper.xslt, file });
  }
  for (const { xslt } of sources.values()) {
    if (!names.includes(xslt)) await files.write(xslt, EMPTY_XSL);
  }
  await updateKaotoMetadata(files, (metadata) => {
    for (const [stepId, { xslt, file }] of sources) {
      const was = metadata[stepId];
      const current = sourceFile(was);
      // A source the user attached stays theirs.
      if (current && !current.startsWith(CALL_SCHEMA_PREFIX)) continue;
      if (file || current) json.set(stepId, !!file);
      if (current === file) continue;
      metadata[stepId] = {
        xsltPath: xslt,
        sourceParameters: {},
        targetBody: document(),
        namespaceMap: {},
        ...(isObject(was) ? was : {}),
        sourceBody: document(file),
      };
    }
  });
  return { unnamed, json };
}

/**
 * The route YAML with these DataMappers reading the body as JSON or not, as Kaoto sets them when a
 * source schema is attached or taken off: with a JSON source, no Set Body ${null} before the XSLT and
 * useJsonBody: true on it; without, the other way round. Unchanged (the same string) otherwise.
 */
export function withJsonSources(yaml: string, json: ReadonlyMap<string, boolean>): string {
  if (!json.size) return yaml;
  const doc = YAML.parseDocument(yaml);
  if (doc.errors.length) return yaml;
  let changed = false;
  YAML.visit(doc, {
    Map(_, map) {
      const step = map.get('step');
      const id = YAML.isMap(step) ? String(step.get('id')) : '';
      const on = json.get(id);
      if (on === undefined || !YAML.isMap(step)) return;
      const steps = step.get('steps');
      if (!YAML.isSeq(steps)) return;
      const nullIndex = steps.items.findIndex((item) => {
        const setBody = YAML.isMap(item) ? item.get('setBody') : undefined;
        return YAML.isMap(setBody) && String(setBody.get('id') ?? '').startsWith('kaoto-datamapper-set-body') && JSON.stringify(setBody.toJSON()).includes('${null}');
      });
      const to = steps.items.map((item) => (YAML.isMap(item) ? item.get('to') : undefined)).find((t) => YAML.isMap(t) && String(t.get('uri')).startsWith('xslt-saxon'));
      if (!YAML.isMap(to)) return;
      let parameters = to.get('parameters');
      if (!YAML.isMap(parameters)) {
        parameters = doc.createNode({});
        to.set('parameters', parameters);
      }
      const params = parameters as YAML.YAMLMap;
      if (on) {
        if (nullIndex >= 0) {
          steps.items.splice(nullIndex, 1);
          changed = true;
        }
        if (params.get('useJsonBody') !== true) {
          params.set('useJsonBody', true);
          changed = true;
        }
      } else {
        if (nullIndex < 0) {
          const suffix = id.replace(/^kaoto-datamapper-/, '');
          steps.items.unshift(doc.createNode({ setBody: { id: `kaoto-datamapper-set-body-${suffix}`, expression: { simple: { expression: '${null}' } } } }));
          changed = true;
        }
        if (params.has('useJsonBody')) {
          params.delete('useJsonBody');
          changed = true;
        }
      }
    },
  });
  return changed ? doc.toString({ lineWidth: 0 }) : yaml;
}

const CALL_DESCRIPTION = /^(\S+)(?: Call|:(\S+))$/;
const PIPELINE_DESCRIPTION = /^(\S+) (\S+) Path$/;

/**
 * The route YAML with each scaffold call step (id call-*) described after the API and the operation it
 * picks: "BluePlanet Call" becomes "BluePlanet:getResource" once an Operation Id is picked, follows a
 * change of operation, and goes back to "BluePlanet Call" when none is picked. The scaffold pipeline
 * (id pipeline-*) around it likewise: "BluePlanet Call Path" becomes "BluePlanet getResource Path".
 * `apiName` gives the name for a step without a description yet (apiStepName). A description the user
 * gave stays. Unchanged (the same string) otherwise.
 */
export function withCallDescriptions(
  yaml: string,
  operationIds: (specificationUri: string) => ReadonlySet<string> | undefined,
  apiName: (specificationUri: string) => string | undefined,
): string {
  if (!yaml.includes('rest-openapi')) return yaml;
  const doc = YAML.parseDocument(yaml);
  if (doc.errors.length) return yaml;
  let changed = false;
  const describe = (node: YAML.YAMLMap, next: string) => {
    if (node.get('description') !== next) {
      node.set('description', next);
      changed = true;
    }
  };
  /** The API name a description of ECHO's starts with, if it is one: its operation part is "Call" or one of the spec's. */
  const ours = (description: unknown, pattern: RegExp, uri: string | undefined, callWord?: string) => {
    const m = pattern.exec(String(description));
    if (!m) return undefined;
    const op = m[2];
    return op === undefined || op === callWord || (uri && operationIds(uri)?.has(op)) ? m[1] : undefined;
  };
  const callOf = (to: YAML.YAMLMap) => {
    const parameters = to.get('parameters');
    return {
      operationId: YAML.isMap(parameters) ? text(parameters.get('operationId')) : undefined,
      uri: YAML.isMap(parameters) ? text(parameters.get('specificationUri'))?.replace(/^classpath:/, '') : undefined,
    };
  };
  const isCall = (node: unknown): boolean =>
    YAML.isMap(node) && node.get('uri') === 'rest-openapi' && String(node.get('id') ?? '').startsWith('call-');
  YAML.visit(doc, {
    Map(_, map) {
      if (isCall(map)) {
        const { operationId, uri } = callOf(map);
        const description = map.get('description');
        const name =
          description === undefined ? (uri && operationId ? apiName(uri) : undefined) : ours(description, CALL_DESCRIPTION, uri);
        if (name) describe(map, callDescription(name, operationId));
        return;
      }
      const pipeline = map.get('pipeline');
      if (!YAML.isMap(pipeline) || !String(pipeline.get('id') ?? '').startsWith('pipeline-')) return;
      const steps = pipeline.get('steps');
      const to = YAML.isSeq(steps) ? steps.items.map((item) => (YAML.isMap(item) ? item.get('to') : undefined)).find(isCall) : undefined;
      if (!YAML.isMap(to)) return;
      const { operationId, uri } = callOf(to);
      const description = pipeline.get('description');
      const name =
        description === undefined
          ? uri && operationId
            ? apiName(uri)
            : undefined
          : ours(description, PIPELINE_DESCRIPTION, uri, 'Call');
      if (name) describe(pipeline, pipelineDescription(name, operationId));
    },
  });
  return changed ? doc.toString({ lineWidth: 0 }) : yaml;
}
