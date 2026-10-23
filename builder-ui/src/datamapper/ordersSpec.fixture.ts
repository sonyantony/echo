/** A small Orders spec for the DataMapper schema tests. */
export const ORDERS_SPEC = {
  openapi: '3.0.3',
  info: { title: 'Orders', version: '1.0.0' },
  paths: {
    '/orders': {
      post: {
        operationId: 'createOrder',
        requestBody: { $ref: '#/components/requestBodies/NewOrder' },
        responses: {
          '200': { description: 'ok', content: { 'application/json': { schema: { $ref: '#/components/schemas/Accepted' } } } },
          '400': { description: 'bad', content: { 'application/json': { schema: { type: 'object', properties: { message: { type: 'string' } } } } } },
          '204': { description: 'no body' },
        },
      },
    },
    '/v1/Customer_Accounts/{accountId}/notes': {
      patch: {
        requestBody: { content: { 'application/merge-patch+json': { schema: { type: 'object', properties: { text: { type: 'string', nullable: true, example: 'hi' } } } } } },
        responses: { '200': { description: 'ok' } },
      },
    },
  },
  components: {
    requestBodies: {
      NewOrder: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Order' } } } },
    },
    schemas: {
      Order: {
        type: 'object',
        properties: {
          orderId: { type: 'string' },
          customer: { $ref: '#/components/schemas/Customer' },
          lines: { type: 'array', items: { $ref: '#/components/schemas/Line' } },
        },
      },
      Customer: { type: 'object', properties: { name: { type: 'string' }, email: { type: 'string' } } },
      Line: { type: 'object', properties: { sku: { type: 'string' }, qty: { type: 'integer' } }, 'x-internal': true },
      Accepted: { type: 'object', properties: { orderId: { type: 'string' }, status: { type: 'string' } } },
    },
  },
};
