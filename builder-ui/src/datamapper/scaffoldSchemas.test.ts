import { describe, expect, it } from 'vitest';
import { routableOperations } from '../apispec/operationIds';
import { InMemoryFlowFiles, KAOTO_METADATA_FILE } from '../editor/flowFiles';
import { attachScaffoldSchemas, forgetScaffoldSchemas, mappedXslFiles } from './scaffoldSchemas';

const spec = JSON.stringify({
  openapi: '3.0.3',
  info: { title: 'Cards' },
  components: { schemas: { Card: { type: 'object', properties: { name: { type: 'string' } } } } },
  paths: {
    '/cards': {
      post: {
        requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Card' } } } },
        responses: { '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Card' } } } } },
      },
      get: { responses: { '200': { description: 'No body' } } },
    },
  },
});

const metadata = async (files: InMemoryFlowFiles) => JSON.parse((await files.read(KAOTO_METADATA_FILE)) ?? '{}');

describe('scaffold DataMapper schemas', () => {
  it("writes the schemas a scaffold's DataMappers start from, and Kaoto's metadata naming them", async () => {
    const files = new InMemoryFlowFiles({ [KAOTO_METADATA_FILE]: JSON.stringify({ other: { xsltPath: 'x.xsl' } }) });
    const [post, get] = routableOperations(spec);
    await attachScaffoldSchemas(files, [post, get]);
    expect([...files.files.keys()].sort()).toEqual([
      '.kaoto',
      'kaoto-datamapper-postCards.xsl',
      'kaoto-datamapper-request-postCards-1.xsl',
      'openapi-cards-post-request.schema.json',
      'openapi-cards-post-response-200.schema.json',
    ]);
    expect(JSON.parse((await files.read('openapi-cards-post-request.schema.json'))!)).toMatchObject({ properties: { name: { type: 'string' } } });
    const meta = await metadata(files);
    expect(meta.other).toEqual({ xsltPath: 'x.xsl' });
    expect(meta['kaoto-datamapper-request-postCards-1']).toEqual({
      xsltPath: 'kaoto-datamapper-request-postCards-1.xsl',
      sourceParameters: {},
      sourceBody: { type: 'JSON Schema', filePath: ['openapi-cards-post-request.schema.json'], fieldTypeOverrides: [] },
      targetBody: { type: 'Primitive', filePath: [], fieldTypeOverrides: [] },
      namespaceMap: {},
    });
    expect(meta['kaoto-datamapper-postCards'].targetBody.filePath).toEqual(['openapi-cards-post-response-200.schema.json']);
    // A GET without a response body has nothing to start from.
    expect(meta['kaoto-datamapper-getCards']).toBeUndefined();
    // Nothing mapped yet.
    expect(await mappedXslFiles(files)).toEqual(new Set());
  });

  it('leaves a DataMapper with mappings alone, and takes the rest away with the route', async () => {
    const files = new InMemoryFlowFiles();
    const [post] = routableOperations(spec);
    await attachScaffoldSchemas(files, [post]);
    await files.write('kaoto-datamapper-postCards.xsl', '<xsl:stylesheet><xsl:template match="/"/></xsl:stylesheet>');
    expect(await mappedXslFiles(files)).toEqual(new Set(['kaoto-datamapper-postCards.xsl']));
    // The spec lost its bodies: the unmapped one goes back to a DataMapper without a schema.
    await attachScaffoldSchemas(files, [{ ...post, schemas: undefined }]);
    expect(Object.keys(await metadata(files))).toEqual(['kaoto-datamapper-postCards']);
    await attachScaffoldSchemas(files, [post]);
    await forgetScaffoldSchemas(files, ['postCards']);
    expect(Object.keys(await metadata(files))).toEqual(['kaoto-datamapper-postCards']);
    expect([...files.files.keys()].sort()).toEqual([
      '.kaoto',
      'kaoto-datamapper-postCards.xsl',
      'openapi-cards-post-response-200.schema.json',
    ]);
  });
});
