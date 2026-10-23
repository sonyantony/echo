import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InMemoryFlowFiles, KAOTO_METADATA_FILE } from '../editor/flowFiles';
import { checkPaths, mappedFields } from './mappingCheck';
import { checkSpecMappings, refreshSpecSchemas } from './specMappings';
import { makeJsonSchema, serializeSchema } from './specSchemas';
import { ORDERS_SPEC } from './ordersSpec.fixture';

const sample = (name: string) => readFileSync(resolve(__dirname, '../../../samples/flows/orders', name), 'utf8');
const REQUEST_XSL = sample('kaoto-datamapper-order-request.xsl');

describe('fields a mapping uses', () => {
  it('reads source paths, for-each paths included, and the target fields Kaoto writes', () => {
    const fields = mappedFields(REQUEST_XSL);
    const names = (paths: { key?: string }[][]) => paths.map((p) => p.map((s) => s.key ?? '[]').join('.'));
    expect(names(fields.source)).toEqual(['orderId', 'customer.name', 'items.[]', 'items.[].sku', 'items.[].qty']);
    expect(names(fields.target)).toEqual(['reference', 'customerName', 'lines', 'lines.[]', 'lines.[].product', 'lines.[].quantity']);
  });

  it('reads parameters by name', () => {
    const xsl = `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:fn="http://www.w3.org/2005/xpath-functions" version="3.0">
      <xsl:param name="headers"/>
      <xsl:template match="/"><xsl:value-of select="upper-case($headers/fn:map/fn:string[@key='tenant'])"/></xsl:template>
    </xsl:stylesheet>`;
    expect(mappedFields(xsl).parameters.headers).toEqual([[{ type: 'string', key: 'tenant' }]]);
  });

  it('tells missing fields once, at the first step that is gone, and fields of another type', () => {
    const schema = JSON.parse(sample('order-request.schema.json'));
    expect(checkPaths(schema, mappedFields(REQUEST_XSL).source)).toEqual([]);
    delete schema.properties.customer;
    schema.properties.items.items.properties.qty = { type: 'string' };
    expect(checkPaths(schema, mappedFields(REQUEST_XSL).source)).toEqual([
      'customer is not in the schema',
      'items[].qty is string in the schema; the mapping uses it as number',
    ]);
  });
});

describe('DataMapper steps against the spec', () => {
  const REQUEST_FILE = 'openapi-orders-post-request.schema.json';
  const ROUTE = `- route:\n    id: orders\n    from:\n      uri: direct:createOrder\n      steps:\n        - step:\n            id: dm-order\n`;

  const flow = () =>
    new InMemoryFlowFiles({
      [REQUEST_FILE]: serializeSchema(makeJsonSchema(ORDERS_SPEC, { method: 'post', path: '/orders', part: 'request' })!),
      'dm-order.xsl': `<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:fn="http://www.w3.org/2005/xpath-functions" version="3.0">
        <xsl:template match="/">
          <xsl:value-of select="/fn:map/fn:map[@key='customer']/fn:string[@key='email']"/>
          <xsl:for-each select="/fn:map/fn:array[@key='lines']/fn:map"><xsl:value-of select="fn:number[@key='qty']"/></xsl:for-each>
        </xsl:template>
      </xsl:stylesheet>`,
      [KAOTO_METADATA_FILE]: JSON.stringify({
        'dm-order': {
          xsltPath: 'dm-order.xsl',
          sourceBody: { type: 'JSON Schema', filePath: [REQUEST_FILE] },
          targetBody: { type: 'JSON Schema', filePath: ['uploaded.schema.json'] },
          sourceParameters: {},
        },
      }),
      'uploaded.schema.json': '{"type":"object"}',
    });

  it('is quiet while the mapping matches the spec', async () => {
    const files = flow();
    const gone = await refreshSpecSchemas(files, await files.list(), ORDERS_SPEC);
    expect(await checkSpecMappings(files, gone, ROUTE)).toEqual([]);
  });

  it('after a spec change, makes the schema again and lists the step with the fields it maps that changed', async () => {
    const files = flow();
    const changed = structuredClone(ORDERS_SPEC);
    delete (changed.components.schemas.Customer.properties as Record<string, unknown>).email;
    (changed.components.schemas.Line.properties as Record<string, unknown>).qty = { type: 'string' };
    const gone = await refreshSpecSchemas(files, await files.list(), changed);
    expect(JSON.parse((await files.read(REQUEST_FILE))!).$defs.Customer.properties).toEqual({ name: { type: 'string' } });
    expect(await files.read('uploaded.schema.json')).toBe('{"type":"object"}');
    expect(await checkSpecMappings(files, gone, ROUTE)).toEqual([
      {
        routeId: 'orders',
        stepId: 'dm-order',
        side: 'source body',
        schemaFile: REQUEST_FILE,
        problems: ['customer.email is not in the schema', 'lines[].qty is string in the schema; the mapping uses it as number'],
      },
    ]);
  });

  it('says when the body the schema came from is gone from the spec', async () => {
    const files = flow();
    const changed = structuredClone(ORDERS_SPEC) as Record<string, unknown>;
    changed.paths = {};
    const gone = await refreshSpecSchemas(files, await files.list(), changed);
    const warnings = await checkSpecMappings(files, gone, ROUTE);
    expect(warnings.map((w) => w.problems)).toEqual([['POST /orders request body is no longer in the Openapi spec']]);
  });
});
