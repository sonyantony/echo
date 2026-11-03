import { findDataMapperNode, isDataMapperDefinition, listDataMappers, type VizNodeLike } from './dataMapperList';

const node = (definition: unknown, label: string, children: VizNodeLike[] = []): VizNodeLike => ({
  data: { definition },
  getNodeLabel: () => label,
  getChildren: () => children,
});
const mapper = (id: string, description?: string) => ({
  id,
  ...(description ? { description } : {}),
  steps: [{ to: { id: `${id}-xslt`, uri: `xslt-saxon:${id}.xsl` } }],
});

describe('dataMapperList', () => {
  it('knows a DataMapper step by its id and xslt-saxon step', () => {
    expect(isDataMapperDefinition(mapper('kaoto-datamapper-1'))).toBe(true);
    expect(isDataMapperDefinition({ id: 'kaoto-datamapper-2', steps: [{ to: 'xslt-saxon:a.xsl' }] })).toBe(true);
    expect(isDataMapperDefinition({ id: 'kaoto-datamapper-3', steps: [{ to: 'log:x' }] })).toBe(false);
    expect(isDataMapperDefinition({ id: 'step-1', steps: [{ to: 'xslt-saxon:a.xsl' }] })).toBe(false);
    expect(isDataMapperDefinition('xslt-saxon:a.xsl')).toBe(false);
  });

  it('lists the DataMappers of every route, nested ones too, by their canvas names', async () => {
    const first = node({ id: 'route-1' }, 'Get Customer', [
      node(mapper('kaoto-datamapper-a', 'Request Mapping'), 'Request Mapping'),
      node({ id: 'multicast-1' }, 'Parallel Processor', [
        node({ id: 'pipeline-1' }, 'pipeline', [node(mapper('kaoto-datamapper-b'), 'kaoto-datamapper')]),
      ]),
    ]);
    const second = node({ id: 'route-2' }, 'route-2', [node(mapper('kaoto-datamapper-c', 'Reply Mapping'), 'Reply Mapping')]);
    const entities = [
      { id: 'route-1', toVizNode: async () => first },
      { id: 'route-2', toVizNode: async () => second },
    ];

    expect(await listDataMappers(entities)).toEqual([
      { id: 'kaoto-datamapper-a', label: 'Request Mapping', description: 'Request Mapping', routeId: 'route-1', routeLabel: 'Get Customer' },
      { id: 'kaoto-datamapper-b', label: 'kaoto-datamapper', description: undefined, routeId: 'route-1', routeLabel: 'Get Customer' },
      { id: 'kaoto-datamapper-c', label: 'Reply Mapping', description: 'Reply Mapping', routeId: 'route-2', routeLabel: 'route-2' },
    ]);
    expect((await findDataMapperNode(entities, 'kaoto-datamapper-c'))?.getNodeLabel()).toBe('Reply Mapping');
    expect(await findDataMapperNode(entities, 'kaoto-datamapper-x')).toBeUndefined();
  });
});
