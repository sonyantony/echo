import { defaultSpecBase, flowNameFromTitle, formatOf, parseSpec, serialize, titleOf, toEditorJson, withFormat } from './apiSpec';

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

  it('refuses files that are not OpenAPI specs', () => {
    expect(() => parseSpec('title: notes')).toThrow(/not an OpenAPI spec/);
    expect(() => parseSpec('- a\n- b')).toThrow(/not an OpenAPI spec/);
    expect(() => parseSpec('{ "openapi": ')).toThrow(/neither JSON nor YAML/);
  });

  it('makes a flow name from the spec title', () => {
    expect(flowNameFromTitle('Card API')).toBe('card-api');
    expect(flowNameFromTitle('  2nd Order -- Intake (v1) ')).toBe('nd-order-intake-v1');
    expect(flowNameFromTitle('123')).toBe('');
    expect(flowNameFromTitle(undefined)).toBe('');
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
