import YAML from 'yaml';
import {
  appendRoute,
  directRoutes,
  naturalOperationIds,
  operationIdFor,
  renameDirectRoutes,
  routeForOperation,
  specOperations,
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

  it('renames an operation whose path or method changed, and two that swapped', () => {
    const json = spec({
      '/payment-cards': { get: { operationId: 'getCards' } },
      '/cards': { get: {} },
      '/a': { post: { operationId: 'postB' } },
      '/b': { post: { operationId: 'postA' } },
    });
    const { json: named, renames } = naturalOperationIds(json);
    expect(ids(named)).toEqual(['getPaymentCards', 'getCards', 'postA', 'postB']);
    expect(renames).toEqual([
      { from: 'getCards', to: 'getPaymentCards', label: 'GET /payment-cards' },
      { from: 'postB', to: 'postA', label: 'POST /a' },
      { from: 'postA', to: 'postB', label: 'POST /b' },
    ]);
  });

  it('does not move routes for an id two operations share, but does for an uploaded one', () => {
    const json = spec({ '/a': { get: { operationId: 'dup' } }, '/b': { get: { operationId: 'dup' } }, '/orders/{id}': { get: { operationId: 'getOrder' } } });
    const { renames } = naturalOperationIds(json);
    expect(renames).toEqual([{ from: 'getOrder', to: 'getOrdersId', label: 'GET /orders/{id}' }]);
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
});
