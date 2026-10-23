import { describe, expect, it } from 'vitest';
import {
  makeJsonSchema,
  schemaFileBase,
  schemaFileName,
  serializeSchema,
  sourceOf,
  specSchemaParts,
  SOURCE_KEY,
} from './specSchemas';
import { ORDERS_SPEC } from './ordersSpec.fixture';

describe('schemas from the Openapi spec', () => {
  it('lists the JSON request and response bodies of each operation', () => {
    expect(specSchemaParts(ORDERS_SPEC).map((p) => p.label)).toEqual([
      'POST /orders: Request body',
      'POST /orders: Response 200',
      'POST /orders: Response 400',
      'PATCH /v1/Customer_Accounts/{accountId}/notes: Request body',
    ]);
    expect(specSchemaParts(ORDERS_SPEC)[0].operationId).toBe('createOrder');
  });

  it('names files openapi-<endpoint>-<method>-<request or response-code>', () => {
    expect(schemaFileBase({ method: 'post', path: '/orders', part: 'request' })).toBe('openapi-orders-post-request');
    expect(schemaFileBase({ method: 'post', path: '/orders', part: 'response', status: '200' })).toBe('openapi-orders-post-response-200');
    expect(schemaFileBase({ method: 'put', path: '/orders/{id}', part: 'request' })).toBe('openapi-orders-id-put-request');
    expect(schemaFileBase({ method: 'patch', path: '/v1/Customer_Accounts/{accountId}/notes', part: 'request' })).toBe(
      'openapi-v1-Customer_Accounts-accountId-notes-patch-request',
    );
    expect(schemaFileBase({ method: 'get', path: '/', part: 'response', status: 'default' })).toBe('openapi-root-get-response-default');
  });

  it('keeps the name of the file already made from the same body, and adds -2 when another file has the name', () => {
    const source = { method: 'post', path: '/orders', part: 'request' as const };
    const made = serializeSchema(makeJsonSchema(ORDERS_SPEC, source)!);
    expect(schemaFileName(source, { 'openapi-orders-post-request.schema.json': made })).toBe('openapi-orders-post-request.schema.json');
    expect(schemaFileName(source, { 'openapi-orders-post-request.schema.json': '{"type":"object"}' })).toBe(
      'openapi-orders-post-request-2.schema.json',
    );
    expect(schemaFileName({ method: 'put', path: '/orders/{id}', part: 'request' }, { 'openapi-orders-id-put-request.schema.json': made })).toBe(
      'openapi-orders-id-put-request-2.schema.json',
    );
  });

  it('makes a standalone JSON Schema: referenced schemas in $defs, OpenAPI-only keywords left out', () => {
    const schema = makeJsonSchema(ORDERS_SPEC, { method: 'post', path: '/orders', part: 'request' })!;
    expect(schema.type).toBe('object');
    expect(schema.title).toBe('POST /orders: Request body');
    expect((schema.properties as Record<string, unknown>).customer).toEqual({ $ref: '#/$defs/Customer' });
    expect(Object.keys(schema.$defs as object).sort()).toEqual(['Customer', 'Line']);
    expect((schema.$defs as Record<string, Record<string, unknown>>).Line['x-internal']).toBeUndefined();
    expect(sourceOf(serializeSchema(schema))).toEqual({ method: 'post', path: '/orders', part: 'request' });

    const patch = makeJsonSchema(ORDERS_SPEC, { method: 'patch', path: '/v1/Customer_Accounts/{accountId}/notes', part: 'request' })!;
    expect(patch.properties).toEqual({ text: { type: 'string' } });
    expect(makeJsonSchema(ORDERS_SPEC, { method: 'post', path: '/orders', part: 'response', status: '200' })![SOURCE_KEY]).toEqual({
      method: 'post',
      path: '/orders',
      part: 'response',
      status: '200',
    });
  });

  it('a body gone from the spec makes no schema', () => {
    expect(makeJsonSchema(ORDERS_SPEC, { method: 'delete', path: '/orders', part: 'request' })).toBeUndefined();
    expect(makeJsonSchema(ORDERS_SPEC, { method: 'post', path: '/orders', part: 'response', status: '204' })).toBeUndefined();
  });

  it('reads Swagger 2.0 body parameters and definitions', () => {
    const swagger = {
      swagger: '2.0',
      paths: {
        '/pets': {
          post: {
            parameters: [{ in: 'body', name: 'pet', schema: { $ref: '#/definitions/Pet' } }],
            responses: { '201': { description: 'ok', schema: { $ref: '#/definitions/Pet' } } },
          },
        },
      },
      definitions: { Pet: { type: 'object', properties: { name: { type: 'string' } } } },
    };
    expect(specSchemaParts(swagger).map((p) => p.label)).toEqual(['POST /pets: Request body', 'POST /pets: Response 201']);
    const schema = makeJsonSchema(swagger, { method: 'post', path: '/pets', part: 'request' })!;
    expect(schema.properties).toEqual({ name: { type: 'string' } });
    expect(schema.$defs).toBeUndefined();
  });
});
