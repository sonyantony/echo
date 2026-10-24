import YAML, { isMap, isSeq, type Document, type YAMLMap } from 'yaml';

/**
 * operationIds are ECHO's business, not the user's (docs/decisions/0013). Camel sends each operation
 * of the flow's spec to direct:<operationId>, so the id is what connects an operation to its route.
 * ECHO names every operation after its method and path (GET /cards/{cardId} is getCardsCardId)
 * when the spec is saved, and when a path or method changes it renames the operation and the
 * flow's routes together. Openapi hides the Operation ID field, and Flow > Add Route For Operation
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

/**
 * Every operation gets its natural id: its method and path in camelCase, with 2, 3... added if two
 * paths come out the same (/cards-x and /cards_x). One that already has that id keeps it. One that
 * had another id (its path or method changed, or it came from an upload) is renamed, and the rename
 * is returned so the flow's routes can follow. Operations without an id are new: nothing to rename.
 *
 * @returns the spec as the editor's JSON (the same string when nothing changed) and the renames
 */
export function naturalOperationIds(editorJson: string): { json: string; renames: OperationRename[] } {
  const spec = JSON.parse(editorJson) as Record<string, unknown>;
  const ops = operationsIn(spec);
  const bases = ops.map(({ method, path }) => operationIdFor(method, path));
  const assigned: (string | undefined)[] = ops.map(() => undefined);
  const taken = new Set<string>();
  // Ids that are already natural stay, so adding an operation never renames another.
  ops.forEach(({ op }, i) => {
    const id = idOf(op);
    if (id && (id === bases[i] || new RegExp(`^${bases[i]}\\d+$`).test(id)) && !taken.has(id)) {
      assigned[i] = id;
      taken.add(id);
    }
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
