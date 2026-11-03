/**
 * The Kaoto DataMappers of a flow, for ECHO's Datamappers page (EchoDataMappersPage.tsx).
 *
 * A Kaoto DataMapper is a `step` whose id starts with "kaoto-datamapper" and which holds an
 * xslt-saxon step (Kaoto's isDataMapperNode). Each one is named as the canvas names it: its
 * description, else its default label; the route it is in tells two of the same name apart.
 */

/** The parts of Kaoto's IVisualizationNode used here. */
export interface VizNodeLike {
  data: { definition?: unknown };
  getNodeLabel(labelType?: never): string;
  getChildren(): VizNodeLike[] | undefined;
}

/** The parts of Kaoto's BaseVisualEntity used here: a route (or other top-level entity). */
export interface VisualEntityLike {
  id: string;
  toVizNode(): Promise<VizNodeLike>;
}

export interface DataMapperEntry {
  /** The step's id: Kaoto opens it at #/datamapper/<id>. */
  id: string;
  /** The name the canvas shows for the step. */
  label: string;
  /** The step's description, when it has one. */
  description?: string;
  routeId: string;
  /** The name the canvas shows for the route (its description, else its id). */
  routeLabel: string;
}

const DATAMAPPER_ID_PREFIX = 'kaoto-datamapper';
const XSLT_COMPONENT_NAME = 'xslt-saxon';

interface StepDefinition {
  id?: unknown;
  description?: unknown;
  steps?: { to?: string | { uri?: unknown } }[];
}

/** Kaoto's isDataMapperNode, kept here so this module needs nothing from Kaoto. */
export function isDataMapperDefinition(definition: unknown): definition is StepDefinition & { id: string } {
  if (!definition || typeof definition !== 'object') return false;
  const step = definition as StepDefinition;
  if (typeof step.id !== 'string' || !step.id.startsWith(DATAMAPPER_ID_PREFIX)) return false;
  if (!Array.isArray(step.steps)) return false;
  return step.steps.some((s) => {
    const to = s?.to;
    if (typeof to === 'string') return to.startsWith(XSLT_COMPONENT_NAME);
    return typeof to?.uri === 'string' && to.uri.startsWith(XSLT_COMPONENT_NAME);
  });
}

function collect(node: VizNodeLike, found: VizNodeLike[]) {
  if (isDataMapperDefinition(node.data.definition)) found.push(node);
  for (const child of node.getChildren() ?? []) collect(child, found);
}

/** The DataMappers of these entities (the flow's routes), in route order and then step order. */
export async function listDataMappers(entities: readonly VisualEntityLike[], labelType?: unknown): Promise<DataMapperEntry[]> {
  const entries: DataMapperEntry[] = [];
  for (const entity of entities) {
    const root = await entity.toVizNode();
    const found: VizNodeLike[] = [];
    collect(root, found);
    const routeLabel = root.getNodeLabel(labelType as never) || entity.id;
    for (const node of found) {
      const definition = node.data.definition as StepDefinition & { id: string };
      const description = typeof definition.description === 'string' && definition.description.trim() ? definition.description : undefined;
      entries.push({
        id: definition.id,
        label: node.getNodeLabel(labelType as never) || description || definition.id,
        description,
        routeId: entity.id,
        routeLabel,
      });
    }
  }
  return entries;
}

/** Finds the DataMapper step with this id in these entities, built from the flow (not from the canvas). */
export async function findDataMapperNode<T extends VizNodeLike>(entities: readonly VisualEntityLike[], id: string): Promise<T | undefined> {
  for (const entity of entities) {
    const found: VizNodeLike[] = [];
    collect(await entity.toVizNode(), found);
    const node = found.find((n) => (n.data.definition as { id: string }).id === id);
    if (node) return node as T;
  }
  return undefined;
}
