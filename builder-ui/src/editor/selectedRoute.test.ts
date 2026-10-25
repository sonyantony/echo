import { describe, expect, it } from 'vitest';
import { selectedRouteCss, selectedRouteGroupId } from './selectedRoute';

function canvas(html: string) {
  const root = document.createElement('div');
  root.innerHTML = `<div class="pf-topology-visualization-surface"><svg>${html}</svg></div>`;
  return root;
}

describe('selectedRouteGroupId', () => {
  it('is the route holding the selected step', () => {
    const root = canvas(`<g data-id="get-order|route"><g class="custom-group" data-selected="false"></g></g>
      <g data-id="list-orders|route.from.steps.0.log"><g class="custom-node" data-selected="true"></g></g>`);
    expect(selectedRouteGroupId(root)).toBe('list-orders|route');
  });

  it('is the route itself when its title bar is selected', () => {
    const root = canvas(`<g data-id="get-order|route"><g class="custom-group" data-selected="true"></g></g>`);
    expect(selectedRouteGroupId(root)).toBe('get-order|route');
  });

  it('is nothing when nothing is selected', () => {
    const root = canvas(`<g data-id="get-order|route"><g class="custom-group" data-selected="false"></g></g>`);
    expect(selectedRouteGroupId(root)).toBeUndefined();
  });
});

describe('selectedRouteCss', () => {
  it('outlines the route and marks its row in the Routes list', () => {
    const css = selectedRouteCss('get-order|route');
    expect(css).toContain('g[data-id="get-order|route"] > .custom-group .custom-group__container');
    expect(css).toContain('#flows-list tr[data-testid="flows-list-row-get-order"]');
  });

  it('is empty when no route is selected', () => {
    expect(selectedRouteCss(undefined)).toBe('');
  });
});
