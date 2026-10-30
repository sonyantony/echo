import YAML, { isMap, isSeq, type Document, type YAMLMap } from 'yaml';

/**
 * operationIds are ECHO's business, not the user's (docs/decisions/0013). Camel sends each operation
 * of the flow's spec to direct:<operationId>, so the id is what connects an operation to its route.
 * An operation without one gets one named after its method and path (GET /cards/{cardId} is
 * getCardsCardId); one that has one (e.g. from an uploaded spec) keeps it. When a path or method
 * changes, ECHO renames the operation and the flow's routes together. Openapi hides the Operation ID field, and Flow > Add Route For Operation
 * makes routes without anyone typing an id. The backend fills in missing ids the same way
 * (OperationIds.java) when a flow leaves the editor.
 */

const VERBS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

/** Method and path in camelCase: POST /cards/{cardId}/activate is postCardsCardIdActivate. */
export function operationIdFor(method: string, path: string): string {
  const words = path.split(/[^A-Za-z0-9]+/).filter(Boolean);
  return method.toLowerCase() + words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}

/** One operation of a spec. */
export interface SpecOperation {
  /** Upper case. */
  method: string;
  path: string;
  operationId?: string;
  summary?: string;
  /** Its path, query and header parameters, path first, as the route keeps them in variables. */
  parameters?: OperationParameter[];
}

/** A parameter of an operation: its name and where it comes from. */
export interface OperationParameter {
  name: string;
  in: 'path' | 'query' | 'header';
}

/** What users read for an operation: GET /cards/{cardId}. */
export const operationLabel = (op: { method: string; path: string }) => `${op.method} ${op.path}`;

type Operation = Record<string, unknown>;

function operationsIn(spec: Record<string, unknown>): { method: string; path: string; op: Operation; item: Operation }[] {
  const paths = spec.paths;
  if (!paths || typeof paths !== 'object') return [];
  const result: { method: string; path: string; op: Operation; item: Operation }[] = [];
  for (const [path, item] of Object.entries(paths as Record<string, unknown>)) {
    if (!item || typeof item !== 'object') continue;
    for (const [verb, op] of Object.entries(item as Record<string, unknown>)) {
      if (VERBS.includes(verb.toLowerCase()) && op && typeof op === 'object' && !Array.isArray(op)) {
        result.push({ method: verb.toUpperCase(), path, op: op as Operation, item: item as Operation });
      }
    }
  }
  return result;
}

const idOf = (op: Operation) => (typeof op.operationId === 'string' && op.operationId.trim() ? op.operationId.trim() : undefined);

const PARAMETER_PLACES: OperationParameter['in'][] = ['path', 'query', 'header'];

/**
 * An operation's parameters: those of its path (also each {name} in the path, declared or not) and
 * its own, a $ref to components/parameters followed. Path ones first, then query, then header; one
 * per name.
 */
function parametersOf(spec: Record<string, unknown>, path: string, item: Operation, op: Operation): OperationParameter[] {
  const components = (spec.components as Record<string, unknown> | undefined)?.parameters as Record<string, unknown> | undefined;
  const resolve = (p: unknown): Operation | undefined => {
    if (!p || typeof p !== 'object') return undefined;
    const ref = (p as Operation).$ref;
    if (typeof ref === 'string') {
      const m = /^#\/components\/parameters\/(.+)$/.exec(ref);
      const target = m ? components?.[m[1]] : undefined;
      return target && typeof target === 'object' ? (target as Operation) : undefined;
    }
    return p as Operation;
  };
  const found: OperationParameter[] = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => ({ name: m[1], in: 'path' }));
  for (const list of [item.parameters, op.parameters]) {
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      const p = resolve(raw);
      const name = typeof p?.name === 'string' ? p.name.trim() : '';
      const place = p?.in as OperationParameter['in'];
      if (name && PARAMETER_PLACES.includes(place)) found.push({ name, in: place });
    }
  }
  const seen = new Set<string>();
  return PARAMETER_PLACES.flatMap((place) => found.filter((p) => p.in === place)).filter((p) => !seen.has(p.name) && !!seen.add(p.name));
}

/** The spec's operations (editor JSON), in order. */
export function specOperations(editorJson: string): SpecOperation[] {
  const spec = JSON.parse(editorJson) as Record<string, unknown>;
  return operationsIn(spec).map(({ method, path, op, item }) => ({
    method,
    path,
    operationId: idOf(op),
    summary: typeof op.summary === 'string' ? op.summary : undefined,
    parameters: parametersOf(spec, path, item, op),
  }));
}

/** An operation that changed its id: the routes starting from direct:<from> now start from direct:<to>. */
export interface OperationRename {
  from: string;
  to: string;
  /** The operation it belongs to, e.g. GET /payment-cards (routes labelled with the old one take it). */
  label: string;
}

/** What an operationId may be: it names the direct endpoint of the operation's route. */
const VALID_ID = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

/**
 * The ids the operations should have when the spec is saved. An operation keeps the id it has (the
 * one an uploaded spec came with, or ECHO's), unless its path or method changed since `before` (the
 * spec as stored), or another operation has the id already, or it cannot name a route: then it gets
 * its natural id, its method and path in camelCase, with 2, 3... added if that is taken (/cards-x
 * and /cards_x). Operations without an id get their natural id too. A renamed operation's rename is
 * returned so the flow's routes can follow.
 *
 * @param before the spec as stored (editor JSON); left out, no path or method counts as changed
 * @returns the spec as the editor's JSON (the same string when nothing changed) and the renames
 */
export function naturalOperationIds(editorJson: string, before?: string): { json: string; renames: OperationRename[] } {
  const spec = JSON.parse(editorJson) as Record<string, unknown>;
  const ops = operationsIn(spec);
  /** Where each id was when the spec was stored: GET /cards. */
  const was = new Map<string, string>();
  if (before) {
    for (const { method, path, op } of operationsIn(JSON.parse(before) as Record<string, unknown>)) {
      const id = idOf(op);
      if (id) was.set(id, operationLabel({ method, path }));
    }
  }
  const bases = ops.map(({ method, path }) => operationIdFor(method, path));
  const assigned: (string | undefined)[] = ops.map(() => undefined);
  const taken = new Set<string>();
  // Ids that stay are decided first, so adding or renaming an operation never renames another.
  ops.forEach(({ method, path, op }, i) => {
    const id = idOf(op);
    if (!id || !VALID_ID.test(id) || taken.has(id)) return;
    const moved = was.has(id) && was.get(id) !== operationLabel({ method, path });
    if (moved && !(id === bases[i] || new RegExp(`^${bases[i]}\\d+$`).test(id))) return;
    assigned[i] = id;
    taken.add(id);
  });
  ops.forEach((_, i) => {
    if (assigned[i]) return;
    let id = bases[i];
    for (let n = 2; taken.has(id); n++) id = `${bases[i]}${n}`;
    assigned[i] = id;
    taken.add(id);
  });

  const count = new Map<string, number>();
  ops.forEach(({ op }) => {
    const id = idOf(op);
    if (id) count.set(id, (count.get(id) ?? 0) + 1);
  });
  const renames: OperationRename[] = [];
  let changed = false;
  ops.forEach(({ method, path, op }, i) => {
    const id = idOf(op);
    const to = assigned[i]!;
    if (op.operationId === to) return;
    changed = true;
    // Two operations sharing an id cannot both have had its route: leave the routes alone.
    if (id && id !== to && count.get(id) === 1) renames.push({ from: id, to, label: operationLabel({ method, path }) });
    op.operationId = to;
  });
  return { json: changed ? JSON.stringify(spec, null, 2) : editorJson, renames };
}

/**
 * The spec with these operations' ids changed (old id to new): a save renamed them while the editor
 * still shows the old ones.
 *
 * @returns the editor's JSON (the same string when nothing matched)
 */
export function renameOperationIds(editorJson: string, renames: ReadonlyMap<string, string>): string {
  if (!renames.size) return editorJson;
  const spec = JSON.parse(editorJson) as Record<string, unknown>;
  let changed = false;
  for (const { op } of operationsIn(spec)) {
    const to = renames.get(idOf(op) ?? '');
    if (to !== undefined) {
      op.operationId = to;
      changed = true;
    }
  }
  return changed ? JSON.stringify(spec, null, 2) : editorJson;
}

/**
 * The spec with an operationId on each operation that has none: its natural name, or that name with
 * 2, 3... when another operation has it already. Ids already there stay (renaming them is for the
 * save, which moves the routes along). The same as the backend's OperationIds.fill.
 *
 * @returns the editor's JSON (the same string when nothing was missing)
 */
export function fillMissingOperationIds(editorJson: string): string {
  const spec = JSON.parse(editorJson) as Record<string, unknown>;
  const ops = operationsIn(spec);
  const taken = new Set(ops.map(({ op }) => idOf(op)).filter((id): id is string => !!id));
  let changed = false;
  for (const { method, path, op } of ops) {
    if (idOf(op)) continue;
    const base = operationIdFor(method, path);
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}${n}`;
    taken.add(id);
    op.operationId = id;
    changed = true;
  }
  return changed ? JSON.stringify(spec, null, 2) : editorJson;
}

const DIRECT_URI = /^direct:(\/\/)?([^?]+)(\?.*)?$/;
const LABEL = /^(GET|PUT|POST|DELETE|OPTIONS|HEAD|PATCH|TRACE) \/\S*$/;

/** The direct endpoint a from starts from: uri: direct:getCards, or uri: direct with parameters.name (as Kaoto writes it). */
function directName(map: YAMLMap): string | undefined {
  const uri = map.get('uri');
  if (typeof uri !== 'string') return undefined;
  const m = DIRECT_URI.exec(uri.trim());
  if (m) return m[2];
  if (uri.trim() === 'direct' || uri.trim() === 'direct:') {
    const params = map.get('parameters');
    const name = isMap(params) ? params.get('name') : undefined;
    if (typeof name === 'string' && name.trim()) return name.trim();
  }
  return undefined;
}

function parseRoute(yaml: string): Document | undefined {
  try {
    const doc = YAML.parseDocument(yaml);
    return doc.errors.length || !isSeq(doc.contents) ? undefined : doc;
  } catch {
    return undefined;
  }
}

/**
 * The route YAML with the renames applied: every direct endpoint (a route's from, a to, a wireTap...)
 * named after an old id takes the new one, in one go (two operations may swap). A route labelled
 * with an operation (GET /cards, as Add Route For Operation writes it) takes the new label, and
 * one with the id route-<old> becomes route-<new>. Unchanged (the same string) if nothing matched.
 */
export function renameDirectRoutes(yaml: string, renames: OperationRename[]): string {
  if (!renames.length) return yaml;
  const doc = parseRoute(yaml);
  if (!doc) return yaml;
  const byOld = new Map(renames.map((r) => [r.from, r]));
  let changed = false;
  YAML.visit(doc, {
    // uri: direct with parameters.name (how Kaoto writes it).
    Map(_, map) {
      const uri = map.get('uri');
      const params = map.get('parameters');
      if (typeof uri !== 'string' || !['direct', 'direct:'].includes(uri.trim()) || !isMap(params)) return;
      const rename = byOld.get(String(params.get('name') ?? '').trim());
      if (rename) {
        params.set('name', rename.to);
        changed = true;
      }
    },
    // direct:getCards anywhere: a uri, or a to written as one string.
    Scalar(_, scalar) {
      if (typeof scalar.value !== 'string') return;
      const m = DIRECT_URI.exec(scalar.value.trim());
      const rename = m && byOld.get(m[2]);
      if (m && rename) {
        scalar.value = `direct:${m[1] ?? ''}${rename.to}${m[3] ?? ''}`;
        changed = true;
      }
    },
  });
  // Route ids and labels follow the from they start with.
  for (const entry of (doc.contents as YAML.YAMLSeq).items) {
    const route = isMap(entry) ? entry.get('route') : undefined;
    if (!isMap(route)) continue;
    const from = route.get('from');
    const name = isMap(from) ? directName(from) : undefined;
    const rename = renames.find((r) => r.to === name);
    if (!rename) continue;
    if (route.get('id') === `route-${rename.from}`) route.set('id', `route-${rename.to}`);
    const description = route.get('description');
    if (typeof description === 'string' && LABEL.test(description) && description !== rename.label) {
      route.set('description', rename.label);
    }
  }
  return changed ? doc.toString({ lineWidth: 0 }) : yaml;
}

/**
 * The route YAML with the operation label (GET /cards) of each route that starts from one of these
 * operations' direct endpoints set to where the operation is now, e.g. after an uploaded spec moved
 * it under the same id. Only labels ECHO wrote (a method and a path) change. Unchanged (the same
 * string) if none did.
 */
export function relabelRoutes(yaml: string, operations: RoutableOperation[]): string {
  const doc = parseRoute(yaml);
  if (!doc) return yaml;
  const labels = new Map(operations.map((op) => [op.operationId, operationLabel(op)]));
  let changed = false;
  for (const { route, name } of routeEntries(doc)) {
    const label = name === undefined ? undefined : labels.get(name);
    const description = route?.get('description');
    if (route && label && typeof description === 'string' && LABEL.test(description) && description !== label) {
      route.set('description', label);
      changed = true;
    }
  }
  return changed ? doc.toString({ lineWidth: 0 }) : yaml;
}

/** The routes in the YAML, each with the direct endpoint its from starts from (if any). */
function routeEntries(doc: Document): { entry: unknown; route: YAMLMap | undefined; name: string | undefined }[] {
  return (doc.contents as YAML.YAMLSeq).items.map((entry) => {
    const route = isMap(entry) ? entry.get('route') : undefined;
    const from = isMap(route) ? route.get('from') : isMap(entry) ? entry.get('from') : undefined;
    return { entry, route: isMap(route) ? route : undefined, name: isMap(from) ? directName(from) : undefined };
  });
}

/**
 * The direct endpoints routes start from, by name: true when the route starts, false when it is
 * switched off (autoStartup: false). Only routes, not what calls them.
 */
export function directRoutes(yaml: string): Map<string, boolean> {
  const names = new Map<string, boolean>();
  const doc = parseRoute(yaml);
  if (!doc) return names;
  for (const entry of (doc.contents as YAML.YAMLSeq).items) {
    if (!isMap(entry)) continue;
    const route = entry.get('route');
    const from = isMap(route) ? route.get('from') : entry.get('from');
    const name = isMap(from) ? directName(from) : undefined;
    if (!name) continue;
    const off = isMap(route) && String(route.get('autoStartup')).trim().toLowerCase() === 'false';
    names.set(name, (names.get(name) ?? false) || !off);
  }
  return names;
}

/**
 * Where the REST OpenApi step of a new route points before the user picks the operation: the
 * approved API's spec when the install has just one, and its Host placeholder when its spec names no
 * server. Empty when there are several (or none) to choose from.
 */
export interface ApiCall {
  specificationUri?: string;
  host?: string;
}

/** The bean the routes' multicasts join their replies with (docs/decisions/0013). */
export const JOIN_BEAN = 'joinWithComma';

const STRING_AGGREGATION = 'org.apache.camel.processor.aggregate.StringAggregationStrategy';

const JOIN_BEAN_YAML = YAML.stringify(
  [{ beans: [{ name: JOIN_BEAN, type: STRING_AGGREGATION, properties: { delimiter: ', ' } }] }],
  { lineWidth: 0 },
);

/**
 * What the steps the user still had to fill in read on the canvas in the `attention` and
 * `request-mapper` eras. They now get a red circle saying what to do instead (scaffoldAttention), and
 * the label is taken off routes made then (withoutAttentionLabels).
 */
export const ATTENTION = 'Attention';

/**
 * How ECHO made its routes over time: `content-type` before 2026-10-29 (a Set Header Content-Type
 * only, without the 200 response code), `reply-headers` until the DataMapper and the Attention
 * descriptions came, `attention` until the DataMapper before the call came, `request-mapper` until
 * 2026-10-30, `marked` now (no Attention descriptions: red circles).
 */
type ScaffoldEra = 'content-type' | 'reply-headers' | 'attention' | 'request-mapper' | 'marked';

const SCAFFOLD_ERAS: ScaffoldEra[] = ['marked', 'request-mapper', 'attention', 'reply-headers', 'content-type'];

/** Ids of the scaffold's steps the user still has to work on, as `scaffold` makes them. */
export const ATTENTION_STEP_IDS = /^(parameters-.+-\d+|call-.+-\d+|label-.+-\d+|kaoto-datamapper-.+)$/;

/**
 * The route YAML without the Attention descriptions ECHO put on its scaffold steps before red circles
 * replaced them (the steps still keep any description the user gave them). Unchanged (the same string) otherwise.
 */
export function withoutAttentionLabels(yaml: string): string {
  if (!yaml.includes(ATTENTION)) return yaml;
  const doc = parseRoute(yaml);
  if (!doc) return yaml;
  let changed = false;
  YAML.visit(doc, {
    Map(_, map) {
      const id = map.get('id');
      if (typeof id === 'string' && ATTENTION_STEP_IDS.test(id) && map.get('description') === ATTENTION) {
        map.delete('description');
        changed = true;
      }
    },
  });
  return changed ? doc.toString({ lineWidth: 0 }) : yaml;
}

/** A Kaoto DataMapper as Kaoto adds one (its id starts kaoto-datamapper): nothing mapped yet. */
const dataMapper = (id: string, labelled: boolean) => ({
  step: {
    id: `kaoto-datamapper-${id}`,
    ...(labelled ? { description: ATTENTION } : {}),
    steps: [
      { setBody: { id: `kaoto-datamapper-set-body-${id}`, expression: { simple: { expression: '${null}' } } } },
      { to: { id: `kaoto-datamapper-xslt-${id}`, uri: 'xslt-saxon', parameters: { failOnNullBody: false } } },
    ],
  },
});

/** The route as ECHO makes it, as data (routeForOperation's YAML), or as it made it in an earlier era. */
function scaffold(operationId: string, label: string, variables: string[], call: ApiCall, era: ScaffoldEra = 'marked') {
  const callParameters: Record<string, string> = {};
  if (call.specificationUri) callParameters.specificationUri = call.specificationUri;
  if (call.host) callParameters.host = call.host;
  // Camel refuses a Set Headers step without a header, so each starts with one.
  const api = call.specificationUri?.replace(/\.openapi\.json$/, '') || 'api';
  const attention = era === 'attention' || era === 'request-mapper';
  const marked = attention ? { description: ATTENTION } : {};
  // Since the request's DataMapper; since the reply's.
  const requestMapper = era === 'request-mapper' || era === 'marked';
  const replyMapper = attention || era === 'marked';
  return {
    route: {
      id: `route-${operationId}`,
      description: label,
      from: {
        id: `from-${operationId}`,
        uri: 'direct',
        parameters: { name: operationId },
        steps: [
          ...variables.map((name) => ({ setVariable: { id: `variable-${operationId}-${name}`, name, simple: `\${header.${name}}` } })),
          { removeHeaders: { id: `remove-headers-${operationId}`, pattern: '*' } },
          {
            setHeaders: {
              id: `authorization-${operationId}`,
              description: 'SetAuthorizationHeaders',
              headers: [{ name: 'Authorization', simple: `Bearer {{${api}.token}}` }],
            },
          },
          {
            multicast: {
              id: `multicast-${operationId}`,
              parallelProcessing: true,
              aggregationStrategy: `#${JOIN_BEAN}`,
              steps: [
                {
                  pipeline: {
                    id: `pipeline-${operationId}-1`,
                    steps: [
                      {
                        setHeaders: {
                          id: `parameters-${operationId}-1`,
                          ...(attention ? { description: ATTENTION } : era === 'marked' ? {} : { description: 'SetMethodParameters' }),
                          headers: [
                            { name: 'Accept', constant: 'application/json' },
                            ...variables.map((name) => ({ name, simple: `\${variable.${name}}` })),
                          ],
                        },
                      },
                      // The user maps the request to what the called operation takes.
                      ...(requestMapper ? [dataMapper(`request-${operationId}-1`, attention)] : []),
                      { to: { id: `call-${operationId}-1`, ...marked, uri: 'rest-openapi', parameters: callParameters } },
                      { convertBodyTo: { id: `to-string-${operationId}-1`, type: 'String' } },
                      { setBody: { id: `label-${operationId}-1`, ...marked, simple: '"result": ${body}' } },
                    ],
                  },
                },
              ],
            },
          },
          { setBody: { id: `reply-${operationId}`, simple: '{${body}}' } },
          // A Kaoto DataMapper as Kaoto adds one: the user maps the reply when they open it.
          ...(replyMapper ? [dataMapper(operationId, attention)] : []),
          era === 'content-type'
            ? { setHeader: { id: `content-type-${operationId}`, name: 'Content-Type', constant: 'application/json' } }
            : {
                // An explicit 200, so a status a downstream call left behind is not the reply's.
                setHeaders: {
                  id: `reply-headers-${operationId}`,
                  description: 'SetResponseHeaders',
                  headers: [
                    { name: 'Content-Type', constant: 'application/json' },
                    { name: 'CamelHttpResponseCode', constant: '200' },
                  ],
                },
              },
        ],
      },
    },
  };
}

/**
 * A route for the operation, as a method added in Interface Specs (or Add Route For Operation)
 * makes it, so the user only picks the operation to call: a Set Variable for each of its parameters
 * (from the header Camel puts it in), Remove Headers *, Set Headers "SetAuthorizationHeaders"
 * (Authorization: Bearer {{<api>.token}}), a multicast with one pipeline calling a REST OpenApi step
 * after Set Headers (Accept, and a header per variable) and a Kaoto DataMapper for the request, and
 * labelling its reply "result", then the joined replies wrapped as a JSON object, a Kaoto DataMapper
 * and Set Headers "SetResponseHeaders" (Content-Type: application/json, CamelHttpResponseCode: 200).
 * The steps the user still has to work on (the pipeline's Set Headers, DataMapper, REST OpenApi and
 * Set Body, and the reply's DataMapper) get a red circle on the canvas saying what to do (scaffoldAttention).
 * The multicast joins replies with the joinWithComma bean (withJoinBean adds it to the flow).
 */
export function routeForOperation(op: SpecOperation & { operationId: string }, call: ApiCall = {}): string {
  const variables = (op.parameters ?? []).map((p) => p.name);
  return YAML.stringify([scaffold(op.operationId, operationLabel(op), variables, call)], { lineWidth: 0 });
}

/** The route YAML with the joinWithComma bean the new routes' multicasts use, if it isn't there. */
export function withJoinBean(yaml: string): string {
  const doc = parseRoute(yaml);
  if (doc) {
    for (const entry of (doc.contents as YAML.YAMLSeq).items) {
      const beans = isMap(entry) ? entry.get('beans') : undefined;
      if (isSeq(beans) && beans.items.some((b) => isMap(b) && b.get('name') === JOIN_BEAN)) return yaml;
    }
    // Next to beans already there.
    const holder = (doc.contents as YAML.YAMLSeq).items.find((entry) => isMap(entry) && isSeq(entry.get('beans')));
    if (holder) {
      ((holder as YAMLMap).get('beans') as YAML.YAMLSeq).add(doc.createNode((YAML.parse(JOIN_BEAN_YAML) as { beans: unknown[] }[])[0].beans[0]));
      return doc.toString({ lineWidth: 0 });
    }
  }
  const trimmed = yaml.trimEnd();
  if (!trimmed || trimmed === '[]') return JOIN_BEAN_YAML;
  return `${JOIN_BEAN_YAML}${trimmed}\n`;
}

/**
 * The route YAML without the joinWithComma bean ECHO added (withJoinBean) once nothing uses it any
 * more, e.g. when the routes it was added for were taken away again. Unchanged (the same string)
 * otherwise.
 */
export function withoutUnusedJoinBean(yaml: string): string {
  const doc = parseRoute(yaml);
  if (!doc || yaml.includes(`#${JOIN_BEAN}`) || yaml.includes(`#bean:${JOIN_BEAN}`)) return yaml;
  const seq = doc.contents as YAML.YAMLSeq;
  let changed = false;
  for (const entry of [...seq.items]) {
    const beans = isMap(entry) ? entry.get('beans') : undefined;
    if (!isSeq(beans)) continue;
    const ours = beans.items.filter((b) => isMap(b) && b.get('name') === JOIN_BEAN && b.get('type') === STRING_AGGREGATION);
    if (!ours.length) continue;
    beans.items = beans.items.filter((b) => !ours.includes(b));
    if (!beans.items.length && (entry as YAMLMap).items.length === 1) seq.items = seq.items.filter((e) => e !== entry);
    changed = true;
  }
  if (!changed) return yaml;
  return seq.items.length ? doc.toString({ lineWidth: 0 }) : '[]\n';
}

/** The scaffold a route of ECHO's is, if it still is one: its variables and where its call points. */
function asScaffold(route: YAMLMap, name: string): { variables: string[]; call: ApiCall; era: ScaffoldEra } | undefined {
  const json = route.toJSON() as { description?: unknown; from?: { steps?: unknown[] } };
  const steps = Array.isArray(json.from?.steps) ? json.from.steps : [];
  const variables: string[] = [];
  for (const step of steps) {
    const v = (step as { setVariable?: { name?: unknown } }).setVariable;
    if (!v) break;
    if (typeof v.name !== 'string') return undefined;
    variables.push(v.name);
  }
  const callStep = JSON.stringify(json).match(/"uri":"rest-openapi","parameters":(\{[^{}]*\})/);
  const parameters = callStep ? (JSON.parse(callStep[1]) as Record<string, unknown>) : {};
  const call: ApiCall = {
    specificationUri: typeof parameters.specificationUri === 'string' ? parameters.specificationUri : undefined,
    host: typeof parameters.host === 'string' ? parameters.host : undefined,
  };
  const label = typeof json.description === 'string' ? json.description : '';
  // Step ids aside: a renamed operation's route keeps the ids it was made with.
  const withoutIds = (value: unknown) => JSON.stringify(value, (key, v) => (key === 'id' ? undefined : v));
  const made = withoutIds(json);
  // Routes made in earlier eras count too.
  const era = SCAFFOLD_ERAS.find((e) => made === withoutIds(scaffold(name, label, variables, call, e).route));
  return era ? { variables, call, era } : undefined;
}

/**
 * The route YAML with the scaffold route of each of these operations (still as ECHO made it) made
 * again for the operation's parameters as they are now: a parameter added in Interface Specs gets
 * its Set Variable, a removed one loses it. Routes somebody worked on stay as they are. Unchanged
 * (the same string) if no route changed.
 */
export function refreshRoutes(yaml: string, operations: RoutableOperation[]): string {
  const doc = parseRoute(yaml);
  if (!doc) return yaml;
  const byId = new Map(operations.map((op) => [op.operationId, op]));
  let changed = false;
  for (const { entry, route, name } of routeEntries(doc)) {
    const op = name === undefined ? undefined : byId.get(name);
    const was = op && route ? asScaffold(route, name!) : undefined;
    if (!op || !was) continue;
    const variables = (op.parameters ?? []).map((p) => p.name);
    if (variables.join('\n') === was.variables.join('\n')) continue;
    const label = String(route!.get('description') ?? operationLabel(op));
    (entry as YAMLMap).set('route', doc.createNode(scaffold(op.operationId, label, variables, was.call, was.era).route));
    changed = true;
  }
  return changed ? doc.toString({ lineWidth: 0 }) : yaml;
}

/** The route YAML with a route appended (an empty or blank file becomes just that route). */
export function appendRoute(yaml: string, route: string): string {
  const trimmed = yaml.trimEnd();
  if (!trimmed || trimmed === '[]') return route;
  return `${trimmed}\n${route}`;
}

/** An operation of the spec with the operationId its route starts from. */
export type RoutableOperation = SpecOperation & { operationId: string };

/**
 * The spec's operations with the operationId a route starts from: the one in the spec, or for an
 * operation without one, the id ECHO gives it (the backend fills in the same when the flow leaves
 * the editor).
 */
export function routableOperations(editorJson: string): RoutableOperation[] {
  const named = specOperations(naturalOperationIds(editorJson).json);
  return specOperations(editorJson).map((op, i) => ({ ...op, operationId: op.operationId ?? named[i].operationId! }));
}

/** Operations an edit added and removed, told apart by their operationId (a renamed path keeps it). */
export function operationChanges(before: RoutableOperation[], after: RoutableOperation[]) {
  const was = new Map(before.map((op) => [op.operationId, op]));
  const now = new Set(after.map((op) => op.operationId));
  const names = (op: RoutableOperation) => (op.parameters ?? []).map((p) => p.name).join('\n');
  return {
    added: after.filter((op) => !was.has(op.operationId)),
    removed: before.filter((op) => !now.has(op.operationId)),
    /** Still there, with other parameters. */
    changed: after.filter((op) => was.has(op.operationId) && names(was.get(op.operationId)!) !== names(op)),
  };
}

/**
 * The routes that start from these direct endpoints taken out of the YAML.
 *
 * @returns the YAML without them (the same string if there were none) and each removed route as
 *   YAML, by name, so it can be put back with appendRoute
 */
export function removeDirectRoutes(yaml: string, names: string[]): { yaml: string; removed: Map<string, string> } {
  const removed = new Map<string, string>();
  const doc = parseRoute(yaml);
  if (!doc || !names.length) return { yaml, removed };
  const seq = doc.contents as YAML.YAMLSeq;
  const kept = routeEntries(doc).filter(({ entry, name }) => {
    if (!name || !names.includes(name)) return true;
    const text = YAML.stringify([(entry as YAML.Node).toJSON()], { lineWidth: 0 });
    removed.set(name, (removed.get(name) ?? '') + text);
    return false;
  });
  if (!removed.size) return { yaml, removed };
  seq.items = kept.map(({ entry }) => entry);
  return { yaml: doc.toString({ lineWidth: 0 }), removed };
}

/**
 * The direct endpoints whose route is still as ECHO made it: the scaffold routeForOperation makes
 * (with the variables of any parameters, and the call's spec and Host, but no operation picked), or
 * the log step only routes were made with before. Removing one of those loses no work.
 */
export function untouchedRoutes(yaml: string): Set<string> {
  const names = new Set<string>();
  const doc = parseRoute(yaml);
  if (!doc) return names;
  const only = (map: YAMLMap, keys: string[]) => map.items.every((pair) => keys.includes(String((pair.key as YAML.Scalar)?.value ?? pair.key)));
  for (const { route, name } of routeEntries(doc)) {
    if (!route || !name) continue;
    if (asScaffold(route, name)) {
      names.add(name);
      continue;
    }
    // A route made before the scaffold: a log step only.
    if (!only(route, ['id', 'description', 'from'])) continue;
    const from = route.get('from') as YAMLMap;
    const steps = from.get('steps');
    if (!only(from, ['id', 'uri', 'parameters', 'steps']) || !isSeq(steps) || steps.items.length !== 1) continue;
    const step = steps.items[0];
    const log = isMap(step) && step.items.length === 1 ? step.get('log') : undefined;
    if (isMap(log) && log.get('id') === `log-${name}`) names.add(name);
  }
  return names;
}

/** Whether anything in the YAML (a to, a wireTap...) calls the direct endpoint. */
export function callsDirect(yaml: string, name: string): boolean {
  const doc = parseRoute(yaml);
  if (!doc) return false;
  let found = false;
  YAML.visit(doc, {
    Map(_, map) {
      if (directName(map) === name) found = true;
    },
    Scalar(_, scalar) {
      const m = typeof scalar.value === 'string' ? DIRECT_URI.exec(scalar.value.trim()) : null;
      if (m && m[2] === name) found = true;
    },
  });
  return found;
}
