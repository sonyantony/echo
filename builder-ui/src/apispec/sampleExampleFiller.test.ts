import { newlyTyped } from './sampleExampleFiller';

const spec = (media: Record<string, unknown>) =>
  JSON.stringify({
    openapi: '3.0.3',
    paths: { '/nodes': { get: { responses: { '200': { content: { 'application/json': media } } } } } },
    components: {
      schemas: { GetNodeResponse: { type: 'object', example: { name: 'n1' } }, Plain: { type: 'object' } },
      responses: { GetNodeSuccess: { content: { 'application/json': media } } },
    },
  });

describe('a body or response newly set to a data type made from a sample', () => {
  const typed = { schema: { $ref: '#/components/schemas/GetNodeResponse' } };

  it('is found when its type changes to one with an example', () => {
    expect(newlyTyped(spec({}), spec(typed))).toEqual([
      { at: 'paths//nodes/get/200/application/json', mediaType: 'application/json', type: 'GetNodeResponse', sample: { name: 'n1' } },
      { at: 'components/responses/GetNodeSuccess/application/json', mediaType: 'application/json', type: 'GetNodeResponse', sample: { name: 'n1' } },
    ]);
  });

  it('is not found when the type did not change, so a deleted example stays deleted', () => {
    expect(newlyTyped(spec(typed), spec(typed))).toEqual([]);
  });

  it('is not found when it has an example of its own or its type has none', () => {
    expect(newlyTyped(spec({}), spec({ ...typed, examples: { mine: { value: 1 } } }))).toEqual([]);
    expect(newlyTyped(spec({}), spec({ schema: { $ref: '#/components/schemas/Plain' } }))).toEqual([]);
  });

  it('ignores content that is not JSON', () => {
    expect(newlyTyped(undefined, 'openapi: 3.0.3')).toEqual([]);
  });
});
