import { isMap, isSeq, LineCounter, parseDocument, type Node } from 'yaml';
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
}

/** Every canvas node in a route file, with the lines (1-based) it spans. */
function stepsIn(yaml: string): Found[] {
  const lines = new LineCounter();
  const doc = parseDocument(yaml, { lineCounter: lines });
  if (doc.errors.length > 0 || !isSeq(doc.contents)) return [];
  const found: Found[] = [];
  const add = (routeId: string, path: string, node: Node | null | undefined) => {
    if (!node?.range) return;
    found.push({ id: `${routeId}|${path}`, start: lines.linePos(node.range[0]).line, end: lines.linePos(node.range[1]).line });
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
          add(routeId, stepPath, item as Node);
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
