import { describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { routeForOperation } from '../apispec/operationIds';
import { InMemoryFlowFiles, KAOTO_METADATA_FILE } from '../editor/flowFiles';
import { attachCallTargets, calledSpecs, mapperCalls, operationIdsOf, withCallLabels, withXsltFile } from './callSchemas';
import { attachScaffoldSchemas } from './scaffoldSchemas';

/** The approved API: createService takes a body, deleteService none. */
const inventory = {
  openapi: '3.0.3',
  info: { title: 'Inventory' },
  components: { schemas: { NewService: { type: 'object', properties: { serviceName: { type: 'string' } } } } },
  paths: {
    '/services': {
      post: {
        operationId: 'createService',
        requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/NewService' } } } },
        responses: { '201': { description: 'Created' } },
      },
    },
    '/services/{id}': {
      put: {
        operationId: 'replaceService',
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { state: { type: 'string' } } } } } },
        responses: { '200': { description: 'OK' } },
      },
      delete: { operationId: 'deleteService', responses: { '204': { description: 'Gone' } } },
    },
  },
};
const loadSpec = async (uri: string) => (uri === 'inventory.openapi.json' ? inventory : undefined);

const op = {
  method: 'POST',
  path: '/orders',
  operationId: 'postOrders',
  schemas: { request: { title: 'POST /orders: Request body', 'x-echo-openapi': { method: 'post', path: '/orders', part: 'request' }, type: 'object' } },
};
const call = { specificationUri: 'inventory.openapi.json' };
const picking = (yaml: string, operationId: string) =>
  yaml.replace('specificationUri: inventory.openapi.json', `specificationUri: inventory.openapi.json\n                          operationId: ${operationId}`);
const metadata = async (files: InMemoryFlowFiles) => JSON.parse((await files.read(KAOTO_METADATA_FILE)) ?? '{}');
const STEP = 'kaoto-datamapper-request-postOrders-1';

describe("the request DataMapper's target follows the operation its call picks", () => {
  it('finds each request DataMapper with the call after it', () => {
    const yaml = picking(routeForOperation(op, call), 'createService');
    expect(mapperCalls(yaml)).toEqual([
      { stepId: STEP, specificationUri: 'inventory.openapi.json', operationId: 'createService', xslt: `${STEP}.xsl` },
    ]);
  });

  it("attaches the picked operation's request body, follows a change of operation, and lets go when none is picked", async () => {
    const files = new InMemoryFlowFiles();
    await attachScaffoldSchemas(files, [op]);
    const made = routeForOperation(op, call);
    // No operation picked yet: the target stays as it is.
    expect(await attachCallTargets(files, made, loadSpec)).toEqual([]);
    expect((await metadata(files))[STEP].targetBody.filePath).toEqual([]);

    await attachCallTargets(files, picking(made, 'createService'), loadSpec);
    const meta = (await metadata(files))[STEP];
    expect(meta.targetBody).toEqual({ type: 'JSON Schema', filePath: ['api-inventory-createService-request.schema.json'], fieldTypeOverrides: [] });
    // The source stays the flow's request body.
    expect(meta.sourceBody.filePath).toEqual(['openapi-orders-post-request.schema.json']);
    expect(JSON.parse((await files.read('api-inventory-createService-request.schema.json'))!)).toMatchObject({
      properties: { serviceName: { type: 'string' } },
    });

    await attachCallTargets(files, picking(made, 'replaceService'), loadSpec);
    expect((await metadata(files))[STEP].targetBody.filePath).toEqual(['api-inventory-replaceService-request.schema.json']);
    // An operation without a body, or none picked: no target.
    await attachCallTargets(files, picking(made, 'deleteService'), loadSpec);
    expect((await metadata(files))[STEP].targetBody).toEqual({ type: 'Primitive', filePath: [], fieldTypeOverrides: [] });
  });

  it('leaves a DataMapper with mappings, and a target the user attached, as they are', async () => {
    const files = new InMemoryFlowFiles();
    await attachScaffoldSchemas(files, [op]);
    const yaml = picking(routeForOperation(op, call), 'createService');
    await files.write(KAOTO_METADATA_FILE, JSON.stringify({ [STEP]: { xsltPath: `${STEP}.xsl`, targetBody: { type: 'JSON Schema', filePath: ['mine.json'] } } }));
    await attachCallTargets(files, yaml, loadSpec);
    expect((await metadata(files))[STEP].targetBody.filePath).toEqual(['mine.json']);

    await files.write(KAOTO_METADATA_FILE, '{}');
    await files.write(`${STEP}.xsl`, '<xsl:stylesheet><xsl:template match="/"/></xsl:stylesheet>');
    await attachCallTargets(files, yaml, loadSpec);
    expect(await metadata(files)).toEqual({});
  });

  it('names the XSLT file of a request DataMapper that has none yet, so its target can be attached', async () => {
    // A POST whose spec has no request body: its DataMapper is as Kaoto adds one.
    const bare = picking(routeForOperation({ ...op, schemas: undefined }, call), 'createService');
    const files = new InMemoryFlowFiles();
    expect(await attachCallTargets(files, bare, loadSpec)).toEqual([STEP]);
    const named = withXsltFile(bare, [STEP]);
    const steps = YAML.parse(named)[0].route.from.steps[2].multicast.steps[0].pipeline.steps[1].step.steps;
    expect(steps[1].to.uri).toBe(`xslt-saxon:${STEP}.xsl`);
    expect(await attachCallTargets(files, named, loadSpec)).toEqual([]);
    expect((await metadata(files))[STEP]).toMatchObject({
      xsltPath: `${STEP}.xsl`,
      sourceBody: { type: 'Primitive' },
      targetBody: { filePath: ['api-inventory-createService-request.schema.json'] },
    });
    expect(await files.read(`${STEP}.xsl`)).toContain('xsl:stylesheet');
  });

  it("labels the call's reply after the operation it picks, following a change of operation", () => {
    const ids = new Set(operationIdsOf(inventory));
    expect([...ids]).toEqual(['createService', 'replaceService', 'deleteService']);
    const made = routeForOperation({ method: 'GET', path: '/orders', operationId: 'getOrders' }, call);
    const label = (yaml: string) => YAML.parse(yaml)[0].route.from.steps[2].multicast.steps[0].pipeline.steps[3].setBody.simple;
    // Nothing picked: still "result".
    expect(withCallLabels(made, () => ids)).toBe(made);
    expect(calledSpecs(made)).toEqual(['inventory.openapi.json']);
    const created = withCallLabels(picking(made, 'createService'), () => ids);
    expect(label(created)).toBe('"createService": ${body}');
    expect(withCallLabels(created, () => ids)).toBe(created);
    const replaced = withCallLabels(created.replace('operationId: createService', 'operationId: replaceService'), () => ids);
    expect(label(replaced)).toBe('"replaceService": ${body}');
    // A name the user gave stays.
    const named = replaced.replace('"replaceService": ${body}', '"service": ${body}');
    expect(withCallLabels(named.replace('operationId: replaceService', 'operationId: createService'), () => ids)).toBe(
      named.replace('operationId: replaceService', 'operationId: createService'),
    );
  });
});
