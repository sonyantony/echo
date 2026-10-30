import { isMap, isSeq, LineCounter, parseDocument, type Node, type YAMLMap } from 'yaml';
import type { ValidationProblem } from '../api/flows';

/**
 * Validation problems shown on the canvas: each problem the backend reports at a line of the route
 * file goes to the step holding that line, which gets a red badge (KaotoEditorHost). A problem in
 * another file, without a line, or at a line no step holds (e.g. the route file is not valid YAML)
 * is left over, and the toolbar shows those beside Validate (FlowEditorPage).
 *
 * A step is named as Kaoto names its canvas node: `<route id>|<path>`, the path being the YAML keys
 * from `route` down to the step, e.g. `get-order|route.from.steps.2.choice.when.0.steps.0.log`.
 */
export interface StepProblems {
  /** Problems by the step they belong to. */
  steps: Map<string, ValidationProblem[]>;
  /** Problems no step holds. */
  other: ValidationProblem[];
}

/** Keys whose value is a canvas node of its own besides the processors in `steps` lists. */
const BRANCHES = new Set(['when', 'otherwise', 'doCatch', 'doFinally', 'onWhen']);

interface Found {
  id: string;
  start: number;
  end: number;
  /** The processor (e.g. `to`), and its settings: none for a branch or a route's `from`. */
  processor?: string;
  settings?: unknown;
}

/** Every canvas node in a route file, with the lines (1-based) it spans. */
function stepsIn(yaml: string): Found[] {
  const lines = new LineCounter();
  const doc = parseDocument(yaml, { lineCounter: lines });
  if (doc.errors.length > 0 || !isSeq(doc.contents)) return [];
  const found: Found[] = [];
  const add = (routeId: string, path: string, node: Node | null | undefined, processor?: string, settings?: unknown) => {
    if (!node?.range) return;
    const step = { id: `${routeId}|${path}`, start: lines.linePos(node.range[0]).line, end: lines.linePos(node.range[1]).line };
    found.push(processor ? { ...step, processor, settings: isMap(settings) ? (settings as YAMLMap).toJSON() : settings } : step);
  };
  // Walks a node's children, adding the processors of each `steps` list and the branches.
  const walk = (routeId: string, path: string, node: unknown) => {
    if (isSeq(node)) {
      node.items.forEach((item, i) => walk(routeId, `${path}.${i}`, item));
      return;
    }
    if (!isMap(node)) return;
    for (const pair of node.items) {
      const key = String((pair.key as { value?: unknown } | null)?.value ?? pair.key);
      const value = pair.value;
      if (key === 'steps' && isSeq(value)) {
        value.items.forEach((item, i) => {
          if (!isMap(item) || item.items.length !== 1) return;
          const step = item.items[0];
          const name = String((step.key as { value?: unknown } | null)?.value ?? step.key);
          const stepPath = `${path}.steps.${i}.${name}`;
          add(routeId, stepPath, item as Node, name, step.value);
          walk(routeId, stepPath, step.value);
        });
      } else if (BRANCHES.has(key)) {
        if (isSeq(value)) {
          value.items.forEach((item, i) => {
            add(routeId, `${path}.${key}.${i}`, item as Node);
            walk(routeId, `${path}.${key}.${i}`, item);
          });
        } else {
          add(routeId, `${path}.${key}`, value as Node);
          walk(routeId, `${path}.${key}`, value);
        }
      } else if (isMap(value) || isSeq(value)) {
        walk(routeId, `${path}.${key}`, value);
      }
    }
  };
  for (const item of doc.contents.items) {
    const route = isMap(item) ? item.get('route', true) : undefined;
    if (!isMap(route)) continue;
    const routeId = route.get('id');
    if (typeof routeId !== 'string' || !routeId) continue;
    // A problem with the route itself (its id, its `from`) goes on the route's first node.
    add(routeId, 'route.from', item as Node);
    const from = route.get('from', true);
    if (isMap(from)) walk(routeId, 'route.from', from);
  }
  return found;
}

/** What is left to do on one scaffold step: its YAML id (to mark it done by) and what to do. */
export interface ToDo {
  stepId: string;
  messages: string[];
}

/**
 * What the user still has to do on the steps of ECHO's route scaffolds (routeForOperation), by step,
 * while those steps are as ECHO made them and the user has not marked them done (`done`, step ids):
 * the canvas shows a red circle on each, as for a problem. A scaffold DataMapper ECHO gave a schema
 * already has its XSLT file named; it is done once that file has mappings (in `mapped`, mappedXslFiles).
 */
export function scaffoldAttention(
  yaml: string,
  done: ReadonlySet<string> = new Set(),
  mapped?: ReadonlySet<string>,
): Map<string, ToDo> {
  const todo = new Map<string, ToDo>();
  for (const step of stepsIn(yaml)) {
    const s = (step.settings ?? {}) as Record<string, unknown> & { id?: string; parameters?: Record<string, unknown> };
    const id = typeof s.id === 'string' ? s.id : '';
    let message: string | undefined;
    if (step.processor === 'to' && /^call-/.test(id) && s.uri === 'rest-openapi' && !s.parameters?.operationId) {
      message = s.parameters?.specificationUri
        ? 'Pick the operation this step calls: Operation Id.'
        : 'Pick the API and the operation this step calls: Specification Uri and Operation Id.';
    } else if (step.processor === 'setHeaders' && /^parameters-.+-\d+$/.test(id) && madeHeaders(s.headers)) {
      message =
        'Match these headers to the operation this step\'s call picks: name each as the operation names its parameter, and add or remove rows as it needs. Any change marks this done.';
    } else if (step.processor === 'setBody' && /^label-/.test(id) && s.simple === '"result": ${body}') {
      message = 'Name this call\'s part of the reply: change "result" to a name for it.';
    } else if (step.processor === 'step' && /^kaoto-datamapper-/.test(id) && !mapperDone(step.id, id, s.steps, mapped)) {
      message = /^kaoto-datamapper-request-/.test(id)
        ? 'Map the request to what the called operation takes: select this step, choose Configure and map its fields in the DataMapper.'
        : 'Map the reply: select this step, choose Configure and map its fields in the DataMapper.';
    }
    if (message && !done.has(id)) todo.set(step.id, { stepId: id, messages: [message] });
  }
  return todo;
}

/** Accept and a header per variable, as the scaffold makes them. */
function madeHeaders(headers: unknown): boolean {
  if (!Array.isArray(headers) || headers.length === 0) return false;
  const [accept, ...rest] = headers as Record<string, unknown>[];
  if (accept?.name !== 'Accept' || accept.constant !== 'application/json' || Object.keys(accept).length !== 2) return false;
  return rest.every((h) => typeof h.name === 'string' && h.simple === `\${variable.${h.name}}` && Object.keys(h).length === 2);
}

/**
 * Whether a DataMapper step is done with: its XSLT has a file (Kaoto names one when the DataMapper is
 * opened), and for a scaffold's DataMapper ECHO named the file of (`kaoto-datamapper-<id>.xsl`, a
 * schema attached), that file has mappings. `node` is the step's canvas node, `id` its own.
 */
function mapperDone(node: string, id: string, steps: unknown, mapped: ReadonlySet<string> | undefined): boolean {
  if (!Array.isArray(steps)) return true;
  const xslt = steps
    .map((s) => (s as { to?: { uri?: unknown; parameters?: { resourceUri?: unknown } } }).to)
    .find((to) => typeof to?.uri === 'string' && /^xslt/.test(to.uri));
  if (!xslt || xslt.parameters?.resourceUri) return true;
  if (xslt.uri === 'xslt-saxon') return false;
  const route = node.slice(0, node.indexOf('|'));
  const scaffold = /^kaoto-datamapper-request-.+-\d+$/.test(id) || (route.startsWith('route-') && id === `kaoto-datamapper-${route.slice(6)}`);
  return !mapped || !scaffold || xslt.uri !== `xslt-saxon:${id}.xsl` || mapped.has(`${id}.xsl`);
}

/** Sorts the problems into those on a step of this route file and the others. */
export function stepProblems(problems: ValidationProblem[], routeFile: string, yaml: string): StepProblems {
  const steps = new Map<string, ValidationProblem[]>();
  const other: ValidationProblem[] = [];
  const found = problems.some((p) => p.file === routeFile && p.line) ? stepsIn(yaml) : [];
  for (const problem of problems) {
    const line = problem.file === routeFile ? problem.line : undefined;
    // The innermost step holding the line: the one starting last, as steps nest.
    const step = line
      ? found.filter((s) => s.start <= line && line <= s.end).sort((a, b) => b.start - a.start || a.end - b.end)[0]
      : undefined;
    if (step) steps.set(step.id, [...(steps.get(step.id) ?? []), problem]);
    else other.push(problem);
  }
  return { steps, other };
}

/**
 * The canvas node to put a step's badge on: its own, or while it is inside a collapsed container
 * the nearest one shown above it. Kaoto names nodes `g[data-id]`, groups and steps alike, and adds
 * `:<id>` to some (a DataMapper is `...steps.4.step:kaoto-datamapper`); `host` picks, among the
 * node's elements (Kaoto draws some in more than one layer), the one the badge goes in.
 */
export function stepNode<T>(root: ParentNode, id: string, host: (node: Element) => T | undefined): { node: string; host: T } | undefined {
  const nodes = [...root.querySelectorAll('.pf-topology-visualization-surface g[data-id]')];
  const bar = id.indexOf('|');
  const route = id.slice(0, bar);
  const parts = id.slice(bar + 1).split('.');
  for (let n = parts.length; n >= 2; n--) {
    const candidate = `${route}|${parts.slice(0, n).join('.')}`;
    for (const node of nodes) {
      const nodeId = node.getAttribute('data-id')!;
      if (nodeId !== candidate && !nodeId.startsWith(candidate + ':')) continue;
      const found = host(node);
      if (found !== undefined) return { node: nodeId, host: found };
    }
  }
  return undefined;
}
