import YAML from 'yaml';
import {
  appendRoute,
  callsDirect,
  directRoutes,
  fillMissingOperationIds,
  naturalOperationIds,
  operationChanges,
  operationIdFor,
  removeDirectRoutes,
  renameDirectRoutes,
  renameOperationIds,
  routableOperations,
  routeForOperation,
  specOperations,
  untouchedRoutes,
} from './operationIds';

const spec = (paths: Record<string, Record<string, object>>) => JSON.stringify({ openapi: '3.0.3', info: { title: 'Cards' }, paths }, null, 2);
const ids = (json: string) => specOperations(json).map((op) => op.operationId);

describe('operationIds', () => {
  it('names an operation after its method and path in camelCase', () => {
    expect(operationIdFor('POST', '/cards/{cardId}/activate')).toBe('postCardsCardIdActivate');
    expect(operationIdFor('GET', '/customer-accounts/{account_id}')).toBe('getCustomerAccountsAccountId');
    expect(operationIdFor('get', '/somthing1/hahaha/Cards')).toBe('getSomthing1HahahaCards');
    expect(operationIdFor('DELETE', '/')).toBe('delete');
  });

  it('fills in missing ids, numbering paths that come out the same, and leaves natural ones alone', () => {
    const json = spec({
      '/cards': { get: { operationId: 'getCards' }, post: {} },
      '/cards_x': { get: {} },
      '/cards-x': { get: {} },
    });
    const { json: named, renames } = naturalOperationIds(json);
    expect(ids(named)).toEqual(['getCards', 'postCards', 'getCardsX', 'getCardsX2']);
    expect(renames).toEqual([]);
    // Already natural: the same string back.
    expect(naturalOperationIds(named).json).toBe(named);
  });

  it('gives only operations without an id one, keeping every id there already (a renamed path keeps its old one)', () => {
    const json = spec({
      '/payment-cards': { get: { operationId: 'getCards' } },
      '/cards': { get: {}, put: {} },
    });
    expect(ids(fillMissingOperationIds(json))).toEqual(['getCards', 'getCards2', 'putCards']);
    const full = spec({ '/cards': { get: { operationId: 'mine' } } });
    expect(fillMissingOperationIds(full)).toBe(full);
  });

  it('renames an operation whose path or method changed since it was stored, and two that swapped', () => {
    const before = spec({
      '/cards': { get: { operationId: 'getCards' } },
      '/a': { post: { operationId: 'postA' } },
      '/b': { post: { operationId: 'postB' } },
    });
    const json = spec({
      '/payment-cards': { get: { operationId: 'getCards' } },
      '/cards': { get: {} },
      '/a': { post: { operationId: 'postB' } },
      '/b': { post: { operationId: 'postA' } },
    });
    const { json: named, renames } = naturalOperationIds(json, before);
    expect(ids(named)).toEqual(['getPaymentCards', 'getCards', 'postA', 'postB']);
    expect(renames).toEqual([
      { from: 'getCards', to: 'getPaymentCards', label: 'GET /payment-cards' },
      { from: 'postB', to: 'postA', label: 'POST /a' },
      { from: 'postA', to: 'postB', label: 'POST /b' },
    ]);
  });

  it("keeps an uploaded spec's own ids, and the ids of operations whose path and method stayed", () => {
    const json = spec({ '/orders': { get: { operationId: 'listOrders' }, post: {} }, '/orders/{id}': { get: { operationId: 'fetchOrder' } } });
    const { json: named, renames } = naturalOperationIds(json);
    expect(ids(named)).toEqual(['listOrders', 'postOrders', 'fetchOrder']);
    expect(renames).toEqual([]);
    // Saved again with an edit elsewhere: the ids stay.
    const edited = spec({ '/orders': { get: { operationId: 'listOrders', summary: 'All' }, post: { operationId: 'postOrders' } }, '/orders/{id}': { get: { operationId: 'fetchOrder' } } });
    expect(naturalOperationIds(edited, named).json).toBe(edited);
    // Its path changed: it is ECHO's to name now, and its route follows.
    const moved = spec({ '/orders': { get: { operationId: 'listOrders' }, post: { operationId: 'postOrders' } }, '/purchases/{id}': { get: { operationId: 'fetchOrder' } } });
    expect(naturalOperationIds(moved, named).renames).toEqual([{ from: 'fetchOrder', to: 'getPurchasesId', label: 'GET /purchases/{id}' }]);
  });

  it('renames an id two operations share (the second) or one that cannot name a route, moving routes only for the latter', () => {
    const json = spec({ '/a': { get: { operationId: 'dup' } }, '/b': { get: { operationId: 'dup' } }, '/orders/{id}': { get: { operationId: 'get order' } } });
    const { json: named, renames } = naturalOperationIds(json);
    expect(ids(named)).toEqual(['dup', 'getB', 'getOrdersId']);
    expect(renames).toEqual([{ from: 'get order', to: 'getOrdersId', label: 'GET /orders/{id}' }]);
  });

  it('changes the ids a save renamed while the editor still shows the old ones', () => {
    const json = spec({ '/payment-cards': { get: { operationId: 'getCards' } } });
    expect(ids(renameOperationIds(json, new Map([['getCards', 'getPaymentCards']])))).toEqual(['getPaymentCards']);
    expect(renameOperationIds(json, new Map())).toBe(json);
  });

  it('renames the routes, in either way of writing a direct endpoint, and their ECHO-made ids and labels', () => {
    const yaml = `- route:
    id: route-getCards
    description: GET /cards
    from:
      uri: direct
      parameters:
        name: getCards
      steps:
        - to:
            uri: direct:postA?timeout=5
- route:
    id: mine
    description: My own words
    from:
      uri: direct:postA
      steps:
        - to: direct:postB
- route:
    from:
      uri: direct://postB
      steps:
        - log: hi
`;
    const renamed = renameDirectRoutes(yaml, [
      { from: 'getCards', to: 'getPaymentCards', label: 'GET /payment-cards' },
      { from: 'postA', to: 'postB', label: 'POST /b' },
      { from: 'postB', to: 'postA', label: 'POST /a' },
    ]);
    const routes = YAML.parse(renamed) as { route: { id?: string; description?: string; from: Record<string, unknown> } }[];
    expect(routes[0].route).toMatchObject({ id: 'route-getPaymentCards', description: 'GET /payment-cards' });
    expect(routes[0].route.from).toMatchObject({ parameters: { name: 'getPaymentCards' }, steps: [{ to: { uri: 'direct:postB?timeout=5' } }] });
    expect(routes[1].route).toMatchObject({ id: 'mine', description: 'My own words', from: { uri: 'direct:postB', steps: [{ to: 'direct:postA' }] } });
    expect(routes[2].route.from.uri).toBe('direct://postA');
    expect(renameDirectRoutes(yaml, [{ from: 'other', to: 'x', label: 'GET /x' }])).toBe(yaml);
  });

  it('finds the routes for operations, and adds one for an operation', () => {
    const op = { method: 'GET', path: '/cards/{id}', operationId: 'getCardsId' };
    const yaml = appendRoute('- route:\n    autoStartup: false\n    from:\n      uri: direct:getCards\n      steps: []\n', routeForOperation(op));
    expect(directRoutes(yaml)).toEqual(new Map([['getCards', false], ['getCardsId', true]]));
    expect(YAML.parse(yaml)[1]).toEqual({
      route: {
        id: 'route-getCardsId',
        description: 'GET /cards/{id}',
        from: { id: 'from-getCardsId', uri: 'direct', parameters: { name: 'getCardsId' }, steps: [{ log: { id: 'log-getCardsId', message: 'GET /cards/{id} called' } }] },
      },
    });
    expect(appendRoute('', routeForOperation(op))).toBe(routeForOperation(op));
  });

  it('tells which operations an edit added and removed, a renamed path keeping its operation', () => {
    const before = routableOperations(spec({ '/cards': { get: { operationId: 'getCards' }, delete: { operationId: 'deleteCards' } } }));
    const after = routableOperations(spec({ '/payment-cards': { get: { operationId: 'getCards' }, post: {} } }));
    const { added, removed } = operationChanges(before, after);
    expect(added).toMatchObject([{ method: 'POST', path: '/payment-cards', operationId: 'postPaymentCards' }]);
    expect(removed).toMatchObject([{ method: 'DELETE', operationId: 'deleteCards' }]);
    expect(operationChanges(after, after)).toEqual({ added: [], removed: [] });
  });

  it('removes the routes for operations and gives them back as they were', () => {
    const designed = `- route:
    id: mine
    from:
      uri: direct
      parameters:
        name: getCards
      steps:
        - setBody:
            constant: hi
`;
    const yaml = appendRoute(designed, routeForOperation({ method: 'POST', path: '/cards', operationId: 'postCards' }));
    const { yaml: left, removed } = removeDirectRoutes(yaml, ['getCards', 'other']);
    expect(directRoutes(left)).toEqual(new Map([['postCards', true]]));
    expect([...removed.keys()]).toEqual(['getCards']);
    expect(YAML.parse(appendRoute(left, removed.get('getCards')!))[1]).toEqual(YAML.parse(designed)[0]);
    expect(removeDirectRoutes(yaml, ['other']).yaml).toBe(yaml);
    expect(directRoutes(removeDirectRoutes(yaml, ['getCards', 'postCards']).yaml).size).toBe(0);
  });

  it('tells routes still as ECHO made them from ones somebody worked on', () => {
    const made = routeForOperation({ method: 'GET', path: '/cards', operationId: 'getCards' });
    expect(untouchedRoutes(made)).toEqual(new Set(['getCards']));
    expect(untouchedRoutes(made.replace('called', 'was called'))).toEqual(new Set(['getCards']));
    const added = made.replace(/( +)- log:/, '$1- setBody:\n$1    constant: hi\n$1- log:');
    expect(directRoutes(added).has('getCards')).toBe(true);
    expect(untouchedRoutes(added).size).toBe(0);
    expect(untouchedRoutes(made.replace('id: log-getCards', 'id: log-1234')).size).toBe(0);
    expect(untouchedRoutes(made.replace('    description:', '    autoStartup: false\n    description:')).size).toBe(0);
  });

  it('finds calls to a direct endpoint, in either form', () => {
    const caller = (to: string) => `- route:\n    from:\n      uri: direct:a\n      steps:\n        - to:\n${to}`;
    expect(callsDirect(caller('            uri: direct:getCards?timeout=5\n'), 'getCards')).toBe(true);
    expect(callsDirect(caller('            uri: direct\n            parameters:\n              name: getCards\n'), 'getCards')).toBe(true);
    expect(callsDirect(caller('            uri: direct:other\n'), 'getCards')).toBe(false);
  });
});
