import { addOperations, basePathOf, operationKeys, pathInSpec, withoutBasePath } from './jiraImport';

const current = JSON.stringify({
  openapi: '3.0.3',
  info: { title: 'Payments', version: '1.0.0' },
  servers: [{ url: '/banking/v1' }],
  paths: {
    '/accounts': { get: { operationId: 'getAccounts', responses: { '200': { description: 'OK' } } } },
    '/cards': { get: { operationId: 'listCards', responses: { '200': { description: 'OK' } } } },
  },
  components: { schemas: { PostAccountsIdPaymentsRequest: { type: 'object' } } },
});

describe('Import From Jira', () => {
  it('adds operations and data types to the spec, keeping what it has', () => {
    const result = addOperations(current, [
      { method: 'POST', path: '/accounts/{id}/payments', request: { amount: 10, reference: null }, response: { paymentId: 'p-1' } },
      { method: 'GET', path: '/payments', query: 'status=OPEN&limit=20', response: [{ paymentId: 'p-1' }] },
    ]);
    const spec = JSON.parse(result.json);

    // What was there stays.
    expect(spec.paths['/accounts'].get.operationId).toBe('getAccounts');
    expect(spec.servers).toEqual([{ url: '/banking/v1' }]);
    expect(spec.components.schemas.PostAccountsIdPaymentsRequest).toEqual({ type: 'object' });

    // A name the spec has already gets a number.
    const post = spec.paths['/accounts/{id}/payments'].post;
    expect(post.operationId).toBe('postAccountsIdPayments');
    expect(post.requestBody.content['application/json'].schema).toEqual({ $ref: '#/components/schemas/PostAccountsIdPaymentsRequest2' });
    expect(spec.components.schemas.PostAccountsIdPaymentsRequest2.required).toEqual(['amount']);

    const get = spec.paths['/payments'].get;
    expect(get.parameters.map((p: { name: string }) => p.name)).toEqual(['status', 'limit']);
    expect(get.parameters[1].schema).toEqual({ type: 'integer' });

    expect(result.paths).toEqual([
      { method: 'POST', path: '/accounts/{id}/payments', replaced: false },
      { method: 'GET', path: '/payments', replaced: false },
    ]);
    expect(result.schemas).toEqual([
      { name: 'PostAccountsIdPaymentsRequest2', fields: 2 },
      { name: 'PostAccountsIdPaymentsResponse', fields: 1 },
      { name: 'GetPaymentsResponseItem', fields: 1 },
    ]);
    expect(result.notes).toEqual(['PostAccountsIdPaymentsRequest2.reference was null in the example, so it is an optional string.']);
  });

  it('replaces an operation the spec has, keeping its operationId so its route stays', () => {
    const result = addOperations(current, [{ method: 'GET', path: 'cards' }]);
    const spec = JSON.parse(result.json);
    expect(spec.paths['/cards'].get.operationId).toBe('listCards');
    expect(result.paths).toEqual([{ method: 'GET', path: '/cards', replaced: true }]);
    expect(result.notes).toEqual(['GET /cards had no response example: its 200 response has no body.']);
  });

  it('knows the operations and Base Path the spec has', () => {
    expect(operationKeys(current)).toEqual(new Set(['GET /accounts', 'GET /cards']));
    expect(basePathOf(current)).toBe('/banking/v1');
    expect(basePathOf(JSON.stringify({ servers: [{ url: 'https://api.acme.com/banking/v1/' }] }))).toBe('/banking/v1');
    expect(withoutBasePath('/banking/v1/payments?status=OPEN', '/banking/v1')).toBe('/payments?status=OPEN');
    expect(withoutBasePath('/other/payments', '/banking/v1')).toBe('/other/payments');
  });
});

describe('Interface Specs from Samples > Add to this spec', () => {
  const spec = JSON.stringify({
    openapi: '3.0.3',
    info: { title: 'Cards', version: '1.0.0' },
    paths: { '/cards/{id}': { get: { operationId: 'getCardsId', responses: { '200': { description: 'OK' } } } } },
    components: { schemas: { GetCardsIdResponse: { type: 'object', properties: { id: { type: 'string' } } } } },
  });

  it('puts a method under the path the spec has, whatever its {names}', () => {
    expect(pathInSpec(spec, '/cards/{cardId}')).toBe('/cards/{id}');
    expect(pathInSpec(spec, '/cards/{id}/')).toBe('/cards/{id}');
    expect(pathInSpec(spec, '/cards')).toBe('/cards');
  });

  it('adds the method with its types, keeping what the spec has', () => {
    const { json } = addOperations(spec, [{ method: 'PUT', path: pathInSpec(spec, '/cards/{cardId}'), request: { id: 'c-1' }, response: { id: 'c-1' } }]);
    const doc = JSON.parse(json);
    expect(Object.keys(doc.paths)).toEqual(['/cards/{id}']);
    expect(doc.paths['/cards/{id}'].get.operationId).toBe('getCardsId');
    expect(doc.paths['/cards/{id}'].put.operationId).toBe('putCardsId');
    expect(doc.paths['/cards/{id}'].put.parameters).toEqual([{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }]);
    expect(Object.keys(doc.components.schemas)).toEqual(['GetCardsIdResponse', 'PutCardsIdRequest', 'PutCardsIdResponse']);
    expect(doc.paths['/cards/{id}'].put.responses['200'].content['application/json'].examples.sample.value).toEqual({ id: 'c-1' });
  });

  it('replaces one method, keeping its operationId, and drops the data types only it used', () => {
    const typed = JSON.parse(spec);
    typed.paths['/cards/{id}'].get.responses['200'].content = { 'application/json': { schema: { $ref: '#/components/schemas/GetCardsIdResponse' } } };
    const { json, paths } = addOperations(JSON.stringify(typed), [{ method: 'GET', path: '/cards/{id}', response: { id: 'c-1', limit: 5 } }], true);
    const doc = JSON.parse(json);
    expect(paths).toEqual([{ method: 'GET', path: '/cards/{id}', replaced: true }]);
    expect(doc.paths['/cards/{id}'].get.operationId).toBe('getCardsId');
    // The old GetCardsIdResponse was used by nothing else, so the new one takes its name.
    expect(Object.keys(doc.components.schemas)).toEqual(['GetCardsIdResponse']);
    expect(doc.components.schemas.GetCardsIdResponse.properties.limit).toEqual({ type: 'integer' });
  });

  it('keeps a replaced method\'s data types another operation uses', () => {
    const shared = JSON.parse(spec);
    const ref = { $ref: '#/components/schemas/GetCardsIdResponse' };
    shared.paths['/cards/{id}'].get.responses['200'].content = { 'application/json': { schema: ref } };
    shared.paths['/cards'] = { get: { operationId: 'getCards', responses: { '200': { description: 'OK', content: { 'application/json': { schema: ref } } } } } };
    const doc = JSON.parse(addOperations(JSON.stringify(shared), [{ method: 'GET', path: '/cards/{id}', response: { id: 'c-1' } }], true).json);
    expect(Object.keys(doc.components.schemas)).toEqual(['GetCardsIdResponse', 'GetCardsIdResponse2']);
  });
});
