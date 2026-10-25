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
}

/** What users read for an operation: GET /cards/{cardId}. */
export const operationLabel = (op: { method: string; path: string }) => `${op.method} ${op.path}`;

type Operation = Record<string, unknown>;

function operationsIn(spec: Record<string, unknown>): { method: string; path: string; op: Operation }[] {
  const paths = spec.paths;
  if (!paths || typeof paths !== 'object') return [];
  const result: { method: string; path: string; op: Operation }[] = [];
  for (const [path, item] of Object.entries(paths as Record<string, unknown>)) {
    if (!item || typeof item !== 'object') continue;
    for (const [verb, op] of Object.entries(item as Record<string, unknown>)) {
      if (VERBS.includes(verb.toLowerCase()) && op && typeof op === 'object' && !Array.isArray(op)) {
        result.push({ method: verb.toUpperCase(), path, op: op as Operation });
      }
    }
  }
  return result;
}

const idOf = (op: Operation) => (typeof op.operationId === 'string' && op.operationId.trim() ? op.operationId.trim() : undefined);

/** The spec's operations (editor JSON), in order. */
export function specOperations(editorJson: string): SpecOperation[] {
  return operationsIn(JSON.parse(editorJson) as Record<string, unknown>).map(({ method, path, op }) => ({
    method,
    path,
    operationId: idOf(op),
    summary: typeof op.summary === 'string' ? op.summary : undefined,
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

/** A route for the operation, as Add Route For Operation appends it: it logs the call until the user designs it. */
export function routeForOperation(op: SpecOperation & { operationId: string }): string {
  return YAML.stringify(
    [
      {
        route: {
          id: `route-${op.operationId}`,
          description: operationLabel(op),
          from: {
            id: `from-${op.operationId}`,
            uri: 'direct',
            parameters: { name: op.operationId },
            steps: [{ log: { id: `log-${op.operationId}`, message: `${operationLabel(op)} called` } }],
          },
        },
      },
    ],
    { lineWidth: 0 },
  );
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
  const was = new Set(before.map((op) => op.operationId));
  const now = new Set(after.map((op) => op.operationId));
  return {
    added: after.filter((op) => !was.has(op.operationId)),
    removed: before.filter((op) => !now.has(op.operationId)),
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
 * The direct endpoints whose route is still as ECHO made it (routeForOperation): nothing but its log
 * step. Removing one of those loses no work.
 */
export function untouchedRoutes(yaml: string): Set<string> {
  const names = new Set<string>();
  const doc = parseRoute(yaml);
  if (!doc) return names;
  const only = (map: YAMLMap, keys: string[]) => map.items.every((pair) => keys.includes(String((pair.key as YAML.Scalar)?.value ?? pair.key)));
  for (const { route, name } of routeEntries(doc)) {
    if (!route || !name || !only(route, ['id', 'description', 'from'])) continue;
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
