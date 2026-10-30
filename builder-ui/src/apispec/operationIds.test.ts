import YAML from 'yaml';
import {
  apiStepName,
  appendRoute,
  callsDirect,
  directRoutes,
  fillMissingOperationIds,
  naturalOperationIds,
  operationChanges,
  operationIdFor,
  refreshRoutes,
  relabelRoutes,
  removeDirectRoutes,
  renameDirectRoutes,
  renameOperationIds,
  routableOperations,
  routeForOperation,
  specOperations,
  untouchedRoutes,
  withJoinBean,
  withoutAttentionLabels,
  withoutUnusedJoinBean,
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

  it('moves the label of a route whose operation moved under the same id, leaving labels people wrote', () => {
    const yaml = `- route:
    id: route-listCards
    description: GET /cards
    from:
      uri: direct:listCards
- route:
    description: Lists the cards
    from:
      uri: direct:other
`;
    const ops = [
      { method: 'GET', path: '/payment-cards', operationId: 'listCards' },
      { method: 'GET', path: '/x', operationId: 'other' },
    ];
    const next = relabelRoutes(yaml, ops);
    expect(next).toContain('description: GET /payment-cards');
    expect(next).toContain('description: Lists the cards');
    expect(relabelRoutes(next, ops)).toBe(next);
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
    expect(YAML.parse(yaml)[1].route).toMatchObject({ id: 'route-getCardsId', description: 'GET /cards/{id}', from: { uri: 'direct', parameters: { name: 'getCardsId' } } });
    expect(appendRoute('', routeForOperation(op))).toBe(routeForOperation(op));
  });

  it('describes the call step after the approved API it calls, and still knows the route as its scaffold', () => {
    const op = { method: 'GET', path: '/cards', operationId: 'getCards', parameters: [{ name: 'limit', in: 'query' }] };
    const call = { specificationUri: 'blueplanet.openapi.json', name: apiStepName('Blue Planet') };
    const yaml = routeForOperation(op, call);
    const step = YAML.parse(yaml)[0].route.from.steps[3].multicast.steps[0].pipeline.steps[1].to;
    expect(step).toMatchObject({ id: 'call-getCards-1', description: 'BluePlanet Call', uri: 'rest-openapi' });
    expect(untouchedRoutes(yaml)).toEqual(new Set(['getCards']));
    // Refreshed for a new parameter, it keeps its description.
    const refreshed = refreshRoutes(yaml, [{ ...op, parameters: [...op.parameters, { name: 'status', in: 'query' }] }]);
    expect(refreshed).toBe(routeForOperation({ ...op, parameters: [...op.parameters, { name: 'status', in: 'query' }] }, call));
    // Routes made before the description still count.
    expect(untouchedRoutes(routeForOperation(op, { specificationUri: 'blueplanet.openapi.json' }))).toEqual(new Set(['getCards']));
  });

  it('makes a route a scaffold: variables, Remove Headers, a multicast calling REST OpenApi, a JSON reply', () => {
    const [op] = routableOperations(
      JSON.stringify({
        openapi: '3.0.3',
        info: { title: 'Cards' },
        components: { parameters: { Limit: { name: 'limit', in: 'query' } } },
        paths: {
          '/cards/{cardId}': {
            parameters: [{ name: 'cardId', in: 'path' }],
            get: {
              parameters: [
                { name: 'X-Trace', in: 'header' },
                { name: 'status', in: 'query' },
                { $ref: '#/components/parameters/Limit' },
                { name: 'session', in: 'cookie' },
              ],
            },
          },
        },
      }),
    );
    expect(op.parameters?.map((p) => p.name)).toEqual(['cardId', 'status', 'limit', 'X-Trace']);
    const route = YAML.parse(routeForOperation(op, { specificationUri: 'blueplanet.openapi.json', host: '{{blueplanet.base-url}}' }))[0].route;
    expect(route.from.steps).toEqual([
      { setVariable: { id: 'variable-getCardsCardId-cardId', name: 'cardId', simple: '${header.cardId}' } },
      { setVariable: { id: 'variable-getCardsCardId-status', name: 'status', simple: '${header.status}' } },
      { setVariable: { id: 'variable-getCardsCardId-limit', name: 'limit', simple: '${header.limit}' } },
      { setVariable: { id: 'variable-getCardsCardId-X-Trace', name: 'X-Trace', simple: '${header.X-Trace}' } },
      { removeHeaders: { id: 'remove-headers-getCardsCardId', pattern: '*' } },
      {
        setHeaders: {
          id: 'authorization-getCardsCardId',
          description: 'SetAuthorizationHeaders',
          headers: [{ name: 'Authorization', simple: 'Bearer {{blueplanet.token}}' }],
        },
      },
      {
        multicast: {
          id: 'multicast-getCardsCardId',
          parallelProcessing: true,
          aggregationStrategy: '#joinWithComma',
          steps: [
            {
              pipeline: {
                id: 'pipeline-getCardsCardId-1',
                steps: [
                  {
                    setHeaders: {
                      id: 'parameters-getCardsCardId-1',
                      headers: [
                        { name: 'Accept', constant: 'application/json' },
                        { name: 'cardId', simple: '${variable.cardId}' },
                        { name: 'status', simple: '${variable.status}' },
                        { name: 'limit', simple: '${variable.limit}' },
                        { name: 'X-Trace', simple: '${variable.X-Trace}' },
                      ],
                    },
                  },
                  { to: { id: 'call-getCardsCardId-1', uri: 'rest-openapi', parameters: { specificationUri: 'blueplanet.openapi.json', host: '{{blueplanet.base-url}}' } } },
                  { convertBodyTo: { id: 'to-string-getCardsCardId-1', type: 'String' } },
                  { setBody: { id: 'label-getCardsCardId-1', simple: '"result": ${body}' } },
                ],
              },
            },
          ],
        },
      },
      { setBody: { id: 'reply-getCardsCardId', simple: '{${body}}' } },
      {
        step: {
          id: 'kaoto-datamapper-getCardsCardId',
          steps: [
            { setBody: { id: 'kaoto-datamapper-set-body-getCardsCardId', expression: { simple: { expression: '${null}' } } } },
            { to: { id: 'kaoto-datamapper-xslt-getCardsCardId', uri: 'xslt-saxon', parameters: { failOnNullBody: false } } },
          ],
        },
      },
      {
        setHeaders: {
          id: 'reply-headers-getCardsCardId',
          description: 'SetResponseHeaders',
          headers: [
            { name: 'Content-Type', constant: 'application/json' },
            { name: 'CamelHttpResponseCode', constant: '200' },
          ],
        },
      },
    ]);
    // No approved API to point at: the call is left for the user to pick.
    const bare = YAML.parse(routeForOperation({ method: 'POST', path: '/cards', operationId: 'postCards' }))[0].route.from.steps;
    expect(bare[0]).toEqual({ removeHeaders: { id: 'remove-headers-postCards', pattern: '*' } });
    // Camel needs a header in each Set Headers step: Authorization's token placeholder, and Accept.
    expect(bare[1].setHeaders.headers).toEqual([{ name: 'Authorization', simple: 'Bearer {{api.token}}' }]);
    expect(bare[2].multicast.steps[0].pipeline.steps[0].setHeaders.headers).toEqual([{ name: 'Accept', constant: 'application/json' }]);
    expect(bare[2].multicast.steps[0].pipeline.steps[1].step.id).toBe('kaoto-datamapper-request-postCards-1');
    expect(bare[2].multicast.steps[0].pipeline.steps[2].to).toEqual({ id: 'call-postCards-1', uri: 'rest-openapi', parameters: {} });
  });

  it("starts a POST's DataMappers from its request body and its response, and attaches them once the spec has them", () => {
    const spec = (withBodies: boolean) =>
      JSON.stringify({
        openapi: '3.0.3',
        info: { title: 'Cards' },
        components: { schemas: { Card: { type: 'object', properties: { name: { type: 'string' } } } } },
        paths: {
          '/cards': {
            post: withBodies
              ? {
                  requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Card' } } } },
                  responses: {
                    '400': { content: { 'application/json': { schema: { type: 'object' } } } },
                    '201': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Card' } } } },
                  },
                }
              : { responses: { '201': { description: 'Created' } } },
            delete: { responses: { '200': { content: { 'application/json': { schema: { type: 'object' } } } } } },
          },
        },
      });
    const [post, del] = routableOperations(spec(true));
    // The request body; the reply's 2xx response (no 200 here), not the 400.
    expect(post.schemas?.request).toMatchObject({ title: 'POST /cards: Request body', properties: { name: { type: 'string' } } });
    expect(post.schemas?.response).toMatchObject({ title: 'POST /cards: Response 201' });
    expect(del.schemas).toBeUndefined();
    const steps = YAML.parse(routeForOperation(post))[0].route.from.steps;
    // The request's DataMapper reads the body as JSON (no Set Body ${null}); both name their XSLT file.
    expect(steps[2].multicast.steps[0].pipeline.steps[1].step).toEqual({
      id: 'kaoto-datamapper-request-postCards-1',
      steps: [
        {
          to: {
            id: 'kaoto-datamapper-xslt-request-postCards-1',
            uri: 'xslt-saxon:kaoto-datamapper-request-postCards-1.xsl',
            parameters: { failOnNullBody: false, useJsonBody: true },
          },
        },
      ],
    });
    expect(steps[4].step.steps).toEqual([
      { setBody: { id: 'kaoto-datamapper-set-body-postCards', expression: { simple: { expression: '${null}' } } } },
      { to: { id: 'kaoto-datamapper-xslt-postCards', uri: 'xslt-saxon:kaoto-datamapper-postCards.xsl', parameters: { failOnNullBody: false } } },
    ]);
    // A DELETE gets no DataMapper before the call.
    expect(routeForOperation(del)).not.toContain('kaoto-datamapper-request');

    // Added in Interface before it had bodies: its route takes them when they come.
    const [bare] = routableOperations(spec(false));
    const made = routeForOperation(bare);
    expect(made).not.toContain('xslt-saxon:');
    expect(operationChanges([bare], [post]).changed).toEqual([post]);
    const attached = refreshRoutes(made, [post]);
    expect(attached).toBe(routeForOperation(post));
    expect(untouchedRoutes(attached)).toEqual(new Set(['postCards']));
    // Once one of its DataMappers has mappings it is somebody's work.
    const mapped = new Set(['kaoto-datamapper-postCards.xsl']);
    expect(untouchedRoutes(attached, mapped).size).toBe(0);
    expect(refreshRoutes(attached, [bare], mapped)).toBe(attached);
    expect(refreshRoutes(attached, [bare])).toBe(made);
  });

  it('adds the bean the multicasts join replies with, once', () => {
    const route = routeForOperation({ method: 'GET', path: '/cards', operationId: 'getCards' });
    const once = withJoinBean(appendRoute('[]', route));
    expect(YAML.parse(once)[0]).toEqual({
      beans: [{ name: 'joinWithComma', type: 'org.apache.camel.processor.aggregate.StringAggregationStrategy', properties: { delimiter: ', ' } }],
    });
    expect(directRoutes(once).has('getCards')).toBe(true);
    expect(withJoinBean(once)).toBe(once);
    expect(YAML.parse(withJoinBean('[]'))).toHaveLength(1);
    const otherBeans = withJoinBean(`- beans:\n    - name: other\n      type: java.lang.String\n${route}`);
    expect(YAML.parse(otherBeans)[0].beans.map((b: { name: string }) => b.name)).toEqual(['other', 'joinWithComma']);
    // Taken out again once no route uses it.
    expect(withoutUnusedJoinBean(once)).toBe(once);
    expect(withoutUnusedJoinBean(removeDirectRoutes(once, ['getCards']).yaml)).toBe('[]\n');
    expect(YAML.parse(withoutUnusedJoinBean(removeDirectRoutes(otherBeans, ['getCards']).yaml))).toEqual([{ beans: [{ name: 'other', type: 'java.lang.String' }] }]);
  });

  it('follows parameters added and removed later, on routes still as ECHO made them', () => {
    const op = { method: 'GET', path: '/cards', operationId: 'getCards', parameters: [] };
    const call = { specificationUri: 'blueplanet.openapi.json' };
    const made = routeForOperation(op, call);
    const withStatus = { ...op, parameters: [{ name: 'status', in: 'query' as const }] };
    const refreshed = refreshRoutes(made, [withStatus]);
    expect(refreshed).toBe(routeForOperation(withStatus, call));
    expect(untouchedRoutes(refreshed)).toEqual(new Set(['getCards']));
    expect(refreshRoutes(refreshed, [op])).toBe(made);
    expect(refreshRoutes(refreshed, [withStatus])).toBe(refreshed);
    // Picked the operation: the user's now.
    const picked = made.replace('specificationUri: blueplanet.openapi.json', 'specificationUri: blueplanet.openapi.json\n                          operationId: getService');
    expect(untouchedRoutes(picked).size).toBe(0);
    expect(refreshRoutes(picked, [withStatus])).toBe(picked);
  });

  it('tells which operations an edit added and removed, a renamed path keeping its operation', () => {
    const before = routableOperations(spec({ '/cards': { get: { operationId: 'getCards' }, delete: { operationId: 'deleteCards' } } }));
    const after = routableOperations(spec({ '/payment-cards': { get: { operationId: 'getCards' }, post: {} } }));
    const { added, removed } = operationChanges(before, after);
    expect(added).toMatchObject([{ method: 'POST', path: '/payment-cards', operationId: 'postPaymentCards' }]);
    expect(removed).toMatchObject([{ method: 'DELETE', operationId: 'deleteCards' }]);
    expect(operationChanges(after, after)).toEqual({ added: [], removed: [], changed: [] });
    const withQuery = routableOperations(spec({ '/payment-cards': { get: { operationId: 'getCards', parameters: [{ name: 'q', in: 'query' }] }, post: {} } }));
    expect(operationChanges(after, withQuery).changed).toMatchObject([{ operationId: 'getCards', parameters: [{ name: 'q', in: 'query' }] }]);
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
    const made = routeForOperation({ method: 'PUT', path: '/cards/{id}', operationId: 'getCardsId', parameters: [{ name: 'id', in: 'path' }] });
    expect(untouchedRoutes(made)).toEqual(new Set(['getCardsId']));
    // A GET's route had a DataMapper before the call too until schemas came.
    expect(untouchedRoutes(made.replace('description: PUT /cards/{id}', 'description: GET /cards/{id}'))).toEqual(new Set(['getCardsId']));
    // A renamed operation's route keeps its step ids.
    expect(untouchedRoutes(made.replace('id: remove-headers-getCardsId', 'id: remove-headers-getCardId'))).toEqual(new Set(['getCardsId']));
    const added = made.replace(/( +)- removeHeaders:/, '$1- setBody:\n$1    constant: hi\n$1- removeHeaders:');
    expect(directRoutes(added).has('getCardsId')).toBe(true);
    expect(untouchedRoutes(added).size).toBe(0);
    expect(untouchedRoutes(made.replace('"result"', '"cards"')).size).toBe(0);
    expect(untouchedRoutes(made.replace('    description:', '    autoStartup: false\n    description:')).size).toBe(0);
    expect(made).not.toContain('Attention');
    // Routes made while the steps left to the user read Attention, before red circles; once the
    // labels are taken off (withoutAttentionLabels) they are routes as made now.
    const labelled = made.replace(
      /^( +)id: (parameters-getCardsId-1|kaoto-datamapper-request-getCardsId-1|call-getCardsId-1|label-getCardsId-1|kaoto-datamapper-getCardsId)\n/gm,
      '$1id: $2\n$1description: Attention\n',
    );
    expect(labelled.match(/description: Attention/g)).toHaveLength(5);
    expect(untouchedRoutes(labelled)).toEqual(new Set(['getCardsId']));
    expect(untouchedRoutes(labelled.replace('description: Attention', 'description: Done')).size).toBe(0);
    expect(withoutAttentionLabels(labelled)).toBe(made);
    expect(withoutAttentionLabels(made)).toBe(made);
    // A step's own description of Attention elsewhere stays.
    const own = made.replace('    description: PUT /cards/{id}', '    description: Attention');
    expect(withoutAttentionLabels(own)).toBe(own);
    // Routes made before the DataMapper before the call.
    const doc = YAML.parse(labelled);
    const steps = doc[0].route.from.steps;
    const multicast = steps.find((s: { multicast?: unknown }) => s.multicast).multicast.steps[0].pipeline;
    multicast.steps = multicast.steps.filter((s: { step?: unknown }) => !s.step);
    const replyMapper = YAML.stringify(doc, { lineWidth: 0 });
    expect(replyMapper).not.toContain('kaoto-datamapper-request');
    expect(untouchedRoutes(replyMapper)).toEqual(new Set(['getCardsId']));
    // ...which a parameter added later keeps as they were made.
    const kept = refreshRoutes(replyMapper, [{ method: 'GET', path: '/cards/{id}', operationId: 'getCardsId', parameters: [{ name: 'id', in: 'path' }, { name: 'q', in: 'query' }] }]);
    expect(kept).toContain('variable-getCardsId-q');
    expect(kept).not.toContain('kaoto-datamapper-request');
    // Routes made before the DataMapper and the Attention descriptions.
    doc[0].route.from.steps = steps.filter((s: { step?: unknown }) => !s.step);
    const pipeline = multicast.steps;
    pipeline[0].setHeaders.description = 'SetMethodParameters';
    delete pipeline[1].to.description;
    delete pipeline[3].setBody.description;
    const replyHeaders = YAML.stringify(doc, { lineWidth: 0 });
    expect(replyHeaders).not.toContain('Attention');
    expect(untouchedRoutes(replyHeaders)).toEqual(new Set(['getCardsId']));
    // A parameter added later keeps such a route as it was made, with one more variable.
    const synced = refreshRoutes(replyHeaders, [{ method: 'GET', path: '/cards/{id}', operationId: 'getCardsId', parameters: [{ name: 'id', in: 'path' }, { name: 'q', in: 'query' }] }]);
    expect(synced).toContain('variable-getCardsId-q');
    expect(synced).not.toContain('Attention');
    // Routes made before the reply's Set Headers: a Set Header Content-Type only.
    const contentTypeOnly = replyHeaders.replace(
      /( +)- setHeaders:\n\s+id: reply-headers-getCardsId[\s\S]*$/,
      '$1- setHeader:\n$1    id: content-type-getCardsId\n$1    name: Content-Type\n$1    constant: application/json\n',
    );
    expect(contentTypeOnly).not.toBe(replyHeaders);
    expect(untouchedRoutes(contentTypeOnly)).toEqual(new Set(['getCardsId']));
    expect(untouchedRoutes(contentTypeOnly.replace('constant: application/json\n', 'constant: text/plain\n')).size).toBe(0);
    // Routes made before the scaffold: a log step only.
    const logged = '- route:\n    id: route-getCards\n    description: GET /cards\n    from:\n      id: from-getCards\n      uri: direct\n      parameters:\n        name: getCards\n      steps:\n        - log:\n            id: log-getCards\n            message: GET /cards called\n';
    expect(untouchedRoutes(logged)).toEqual(new Set(['getCards']));
    expect(untouchedRoutes(logged.replace('called', 'was called'))).toEqual(new Set(['getCards']));
    expect(untouchedRoutes(logged.replace('id: log-getCards', 'id: log-1234')).size).toBe(0);
  });

  it('finds calls to a direct endpoint, in either form', () => {
    const caller = (to: string) => `- route:\n    from:\n      uri: direct:a\n      steps:\n        - to:\n${to}`;
    expect(callsDirect(caller('            uri: direct:getCards?timeout=5\n'), 'getCards')).toBe(true);
    expect(callsDirect(caller('            uri: direct\n            parameters:\n              name: getCards\n'), 'getCards')).toBe(true);
    expect(callsDirect(caller('            uri: direct:other\n'), 'getCards')).toBe(false);
  });
});
