import { operationIdFor, pathParameters, specFromSamples } from './specFromSamples';

describe('New From Samples', () => {
  it('prefills the operationId from the method and path in camelCase', () => {
    expect(operationIdFor('POST', '/cards/{cardId}/activate')).toBe('postCardsCardIdActivate');
    expect(operationIdFor('GET', '/customer-accounts/{account_id}')).toBe('getCustomerAccountsAccountId');
    expect(operationIdFor('DELETE', '/')).toBe('delete');
    expect(pathParameters('/cards/{cardId}/items/{itemId}')).toEqual(['cardId', 'itemId']);
  });

  it('makes schemas, the path, the operation and its path parameters from the samples', () => {
    const spec = JSON.parse(
      specFromSamples({
        method: 'POST',
        path: 'cards/{cardId}/activate',
        operationId: 'postCardsCardIdActivate',
        request: { code: '123456', pin: null, owner: { name: 'Ann', since: '2024-01-31' } },
        response: { cardId: 'c-42', active: true, limit: 2500.5, tries: 1, lines: [{ sku: 'a', qty: 1 }, { sku: 'b' }] },
        flowName: 'cards',
      }),
    );
    const op = spec.paths['/cards/{cardId}/activate'].post;
    expect(op.operationId).toBe('postCardsCardIdActivate');
    expect(op.parameters).toEqual([{ name: 'cardId', in: 'path', required: true, schema: { type: 'string' } }]);
    expect(op.requestBody.content['application/json'].schema).toEqual({ $ref: '#/components/schemas/PostCardsCardIdActivateRequest' });
    expect(op.responses['200'].content['application/json'].example.cardId).toBe('c-42');

    const s = spec.components.schemas;
    // Fields with a value are required; a null one is optional and nullable.
    expect(s.PostCardsCardIdActivateRequest).toEqual({
      type: 'object',
      required: ['code', 'owner'],
      properties: {
        code: { type: 'string' },
        pin: { type: 'string', nullable: true },
        owner: { $ref: '#/components/schemas/PostCardsCardIdActivateRequestOwner' },
      },
    });
    expect(s.PostCardsCardIdActivateRequestOwner.properties.since).toEqual({ type: 'string', format: 'date' });
    expect(s.PostCardsCardIdActivateResponse.properties).toMatchObject({
      active: { type: 'boolean' },
      limit: { type: 'number' },
      tries: { type: 'integer' },
      lines: { type: 'array', items: { $ref: '#/components/schemas/PostCardsCardIdActivateResponseLinesItem' } },
    });
    // qty is missing from one line, so it is not required.
    expect(s.PostCardsCardIdActivateResponseLinesItem.required).toEqual(['sku']);
    expect(spec.info).toEqual({ title: 'cards', version: '1.0.0' });
  });

  it('numbers a schema name that is already taken, and keeps the info and Base Path of the spec on screen', () => {
    const current = JSON.stringify({ openapi: '3.0.3', info: { title: 'Cards API', version: '2.0.0' }, servers: [{ url: '/cards' }], paths: {} });
    const spec = JSON.parse(
      specFromSamples({
        method: 'GET',
        path: '/a',
        operationId: 'getA',
        response: { b: { c: 1 }, B: { d: 2 } },
        current,
        flowName: 'cards',
      }),
    );
    expect(Object.keys(spec.components.schemas)).toEqual(['GetAResponse', 'GetAResponseB', 'GetAResponseB2']);
    expect(spec.paths['/a'].get.requestBody).toBeUndefined();
    expect(spec.info.title).toBe('Cards API');
    expect(spec.servers).toEqual([{ url: '/cards' }]);
  });
});
