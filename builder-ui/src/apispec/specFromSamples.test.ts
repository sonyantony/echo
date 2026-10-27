import { pathParameters, queryParameters, sampleExamples, specFromSamples, splitPath } from './specFromSamples';

describe('New From Samples', () => {
  it('finds the path parameters', () => {
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
    // The samples are kept as named examples, which Apicurio lists (a bare example shows "No examples defined").
    expect(op.requestBody.content['application/json'].examples.sample.value.owner).toEqual({ name: 'Ann', since: '2024-01-31' });
    expect(op.responses['200'].content['application/json'].examples.sample.value.cardId).toBe('c-42');
    expect(op.responses['200'].content['application/json'].example).toBeUndefined();

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
      // The data type keeps the sample, for bodies and responses set to it later (sampleExamples).
      example: { code: '123456', pin: null, owner: { name: 'Ann', since: '2024-01-31' } },
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

  it('makes optional, typed query parameters from a sample query string', () => {
    expect(splitPath('cards/{cardId}?expand=owner')).toEqual({ path: '/cards/{cardId}', query: 'expand=owner' });
    expect(splitPath('/cards')).toEqual({ path: '/cards', query: '' });
    expect(queryParameters('status=ACTIVE&limit=10&rate=2.5&open=true&expand=owner&expand=limits&q=a%20b&empty=')).toEqual([
      { name: 'status', in: 'query', required: false, schema: { type: 'string' }, examples: { sample: { summary: 'The sample', value: 'ACTIVE' } } },
      { name: 'limit', in: 'query', required: false, schema: { type: 'integer' }, examples: { sample: { summary: 'The sample', value: 10 } } },
      { name: 'rate', in: 'query', required: false, schema: { type: 'number' }, examples: { sample: { summary: 'The sample', value: 2.5 } } },
      { name: 'open', in: 'query', required: false, schema: { type: 'boolean' }, examples: { sample: { summary: 'The sample', value: true } } },
      { name: 'expand', in: 'query', required: false, schema: { type: 'array', items: { type: 'string' } }, examples: { sample: { summary: 'The sample', value: ['owner', 'limits'] } } },
      { name: 'q', in: 'query', required: false, schema: { type: 'string' }, examples: { sample: { summary: 'The sample', value: 'a b' } } },
      { name: 'empty', in: 'query', required: false, schema: { type: 'string' } },
    ]);

    const spec = JSON.parse(
      specFromSamples({ method: 'GET', path: '/cards/{cardId}', query: 'limit=5', operationId: 'getCardsCardId', response: {}, flowName: 'cards' }),
    );
    expect(Object.keys(spec.paths)).toEqual(['/cards/{cardId}']);
    expect(spec.paths['/cards/{cardId}'].get.parameters.map((p: { name: string; in: string }) => `${p.in}:${p.name}`)).toEqual([
      'path:cardId',
      'query:limit',
    ]);
  });
});

describe('sampleExamples', () => {
  const spec = (extra: Record<string, unknown>) =>
    JSON.stringify({
      openapi: '3.0.3',
      paths: {
        '/nodes': {
          get: { responses: { '200': { $ref: '#/components/responses/GetNodeSuccess' } } },
          post: {
            requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Node' } } } },
            responses: { '200': { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Node' }, example: { name: 'own' } } } } },
          },
        },
      },
      components: {
        schemas: { Node: { type: 'object', properties: { name: { type: 'string' } }, example: { name: 'n1' } }, Plain: { type: 'object' } },
        responses: { GetNodeSuccess: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Node' } } } } },
        ...extra,
      },
    });

  it('gives bodies and responses set to a data type with a sample that sample as their example', () => {
    const doc = JSON.parse(sampleExamples(spec({})));
    const sample = { sample: { summary: 'The sample', value: { name: 'n1' } } };
    expect(doc.components.responses.GetNodeSuccess.content['application/json'].examples).toEqual(sample);
    expect(doc.paths['/nodes'].post.requestBody.content['application/json'].examples).toEqual(sample);
    // A body with an example of its own keeps it.
    expect(doc.paths['/nodes'].post.responses['200'].content['application/json']).toEqual({ schema: { $ref: '#/components/schemas/Node' }, example: { name: 'own' } });
  });

  it('leaves the spec as it is when there is nothing to add', () => {
    const plain = JSON.stringify({ openapi: '3.0.3', paths: {}, components: { schemas: { Plain: { type: 'object' } } } });
    expect(sampleExamples(plain)).toBe(plain);
    expect(sampleExamples('not json')).toBe('not json');
  });

  it('New From Samples keeps the sample on the data types it makes', () => {
    const made = JSON.parse(
      specFromSamples({ method: 'GET', path: '/nodes', operationId: 'getNodes', response: { name: 'n1' }, flowName: 'nodes' }),
    );
    expect(made.components.schemas.GetNodesResponse.example).toEqual({ name: 'n1' });
    // Already filled: a second pass changes nothing.
    const json = JSON.stringify(made, null, 2);
    expect(sampleExamples(json)).toBe(json);
  });
});
