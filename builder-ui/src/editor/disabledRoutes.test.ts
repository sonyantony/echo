import { describe, expect, it } from 'vitest';
import { disabledRouteCss, disabledRouteIds } from './disabledRoutes';

describe('disabledRouteIds', () => {
  it('lists the routes with autoStartup false', () => {
    const yaml = `- route:
    id: get-order
    autoStartup: false
    from: {uri: direct:getOrder}
- route:
    id: list-orders
    autoStartup: "false"
    from: {uri: direct:listOrders}
- route:
    id: on
    autoStartup: true
    from: {uri: direct:on}
- route:
    id: plain
    from: {uri: direct:plain}
`;
    expect(disabledRouteIds(yaml)).toEqual(['get-order', 'list-orders']);
  });

  it('is empty for YAML it cannot read', () => {
    expect(disabledRouteIds('- route: [')).toEqual([]);
    expect(disabledRouteIds('route: {}')).toEqual([]);
  });
});

describe('disabledRouteCss', () => {
  it('marks each row of Kaoto’s Routes list', () => {
    const css = disabledRouteCss(['get-order']);
    expect(css).toContain('#flows-list tr[data-testid="flows-list-row-get-order"] td:first-child::after');
    expect(css).toContain("content: 'Disabled'");
    expect(disabledRouteCss([])).toBe('');
  });
});
