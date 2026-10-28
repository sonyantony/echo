import { describe, expect, it } from 'vitest';
import { apiFor, operationFilterCss, tagOf, tagsFor } from './operationTags';

const apis = [
  { specificationUri: 'blueplanet.openapi.json', tags: [{ name: 'B', operations: ['getB', 'shared'] }, { name: 'c', operations: ['shared'] }] },
  { specificationUri: 'inventory.openapi.json', tags: [{ name: 'A', operations: ['getA'] }, { name: 'B', operations: ['other'] }] },
];

describe('operation tags', () => {
  it('finds the approved API of a Specification Uri, with or without classpath:', () => {
    expect(apiFor(apis, 'classpath:blueplanet.openapi.json')).toBe(apis[0]);
    expect(apiFor(apis, 'other.json')).toBeUndefined();
  });

  it("offers the spec's tags, or every spec's merged A to Z when none is chosen", () => {
    expect(tagsFor(apis, 'blueplanet.openapi.json').map((t) => t.name)).toEqual(['B', 'c']);
    expect(tagsFor(apis, '')).toEqual([
      { name: 'A', operations: ['getA'] },
      { name: 'B', operations: ['getB', 'shared', 'other'] },
      { name: 'c', operations: ['shared'] },
    ]);
  });

  it("starts on the set operation's first tag, else all tags", () => {
    expect(tagOf(apis[0].tags, 'shared')).toBe('B');
    expect(tagOf(apis[0].tags, '')).toBe('');
    expect(tagOf(apis[0].tags, 'unknown')).toBe('');
  });

  it("hides the Operation Id options not under the tag (Kaoto's labels are lower case)", () => {
    expect(operationFilterCss(apis[0].tags, '')).toBe('');
    const css = operationFilterCss(apis[0].tags, 'B');
    expect(css).toContain('[aria-label="option getb"], [aria-label="option shared"]');
    expect(css).toContain('display: none');
  });
});
