import { defaultSpecBase, formatOf, parseSpec, serialize, titleOf, toEditorJson, withFormat } from './apiSpec';

describe('OpenAPI spec files', () => {
  it('takes the format from the extension, and changes the extension with the format', () => {
    expect(formatOf('customer-api.yaml')).toBe('yaml');
    expect(formatOf('customer-api.YML')).toBe('yaml');
    expect(formatOf('openapi.json')).toBe('json');
    expect(formatOf('notes.txt')).toBeUndefined();
    expect(withFormat('customer.json', 'yaml')).toBe('customer.yaml');
    expect(withFormat('customer.yml', 'yaml')).toBe('customer.yml');
    expect(withFormat('customer', 'json')).toBe('customer.json');
  });

  it('reads JSON and YAML specs for the editor and writes them back in either format', () => {
    const json = toEditorJson('openapi: 3.0.3\ninfo:\n  title: Orders\n  version: 1.0.0\npaths: {}\n');
    expect(JSON.parse(json)).toEqual({ openapi: '3.0.3', info: { title: 'Orders', version: '1.0.0' }, paths: {} });
    expect(serialize(json, 'json')).toBe(json);
    expect(serialize(json, 'yaml')).toBe('openapi: 3.0.3\ninfo:\n  title: Orders\n  version: 1.0.0\npaths: {}\n');
    expect(parseSpec('{"swagger":"2.0"}')).toEqual({ swagger: '2.0' });
  });

  it('writes only what changed over the file it had, keeping its comments and layout', () => {
    const file = [
      '# Orders, as the partner sent it',
      'openapi: 3.0.3',
      'info: { title: Orders, version: 1.0.0 } # flow style stays',
      'paths:',
      '  /orders:',
      '    # every order',
      '    get:',
      '      operationId: listOrders',
      "      responses: { '200': { description: ok } }",
      '    post:',
      "      responses: { '201': { description: created } }",
      '  /old:',
      '    # goes with its path',
      '    get: { operationId: old }',
      '',
    ].join('\n');
    const spec = JSON.parse(toEditorJson(file));
    // Nothing changed: the file as it was.
    expect(serialize(JSON.stringify(spec), 'yaml', file)).toBe(file);
    spec.paths['/orders'].post.operationId = 'postOrders';
    spec.paths['/orders'].get.responses['200'].description = 'true';
    delete spec.paths['/old'];
    const written = serialize(JSON.stringify(spec), 'yaml', file);
    expect(written).toContain('# Orders, as the partner sent it\nopenapi: 3.0.3\n');
    expect(written).toContain('info: { title: Orders, version: 1.0.0 } # flow style stays');
    expect(written).toContain('    # every order\n    get:\n      operationId: listOrders');
    expect(written).toContain('operationId: postOrders');
    expect(written).not.toContain('/old');
    expect(written).not.toContain('goes with its path');
    expect(JSON.parse(toEditorJson(written))).toEqual(spec);
    // A JSON file is kept as it was while nothing changed; a JSON file saved as YAML has no layout to keep.
    const jsonFile = '{"openapi":"3.0.3","info":{"title":"Orders","version":"1.0.0"},"paths":{}}';
    expect(serialize(toEditorJson(jsonFile), 'json', jsonFile)).toBe(jsonFile);
    expect(serialize(toEditorJson(jsonFile), 'yaml', jsonFile)).toBe('openapi: 3.0.3\ninfo:\n  title: Orders\n  version: 1.0.0\npaths: {}\n');
  });

  it('refuses files that are not OpenAPI specs', () => {
    expect(() => parseSpec('title: notes')).toThrow(/not an OpenAPI spec/);
    expect(() => parseSpec('- a\n- b')).toThrow(/not an OpenAPI spec/);
    expect(() => parseSpec('{ "openapi": ')).toThrow(/neither JSON nor YAML/);
  });

  it('reads the spec title', () => {
    expect(titleOf('{"info":{"title":"Card API"}}')).toBe('Card API');
    expect(titleOf('{"openapi":"3.0.3"}')).toBeUndefined();
  });
});

describe('Default spec name', () => {
  it('is <flow name>-api, with characters a file cannot have replaced', () => {
    expect(defaultSpecBase('secondflow')).toBe('secondflow-api');
    expect(defaultSpecBase('My orders')).toBe('My-orders-api');
  });
});
