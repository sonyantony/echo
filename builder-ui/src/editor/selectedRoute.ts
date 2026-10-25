/**
 * The route holding what is selected on the canvas. Kaoto outlines only the selected step (and
 * ECHO's theme gives every route the same border, which hides Kaoto's own outline of a selected
 * route), so ECHO outlines the route and marks its row in the Routes list.
 *
 * Kaoto's canvas wraps each step and route in a `g[data-id]` whose id is `<route id>|<path>`, e.g.
 * `get-order|route.from.steps.0.log`; the route's own box is `get-order|route`.
 */
export function selectedRouteGroupId(root: ParentNode): string | undefined {
  const selected = root.querySelector(".pf-topology-visualization-surface [data-selected='true']");
  const id = selected?.closest('[data-id]')?.getAttribute('data-id');
  const bar = id?.indexOf('|') ?? -1;
  if (!id || bar <= 0) return undefined;
  return id.slice(0, bar) + '|' + id.slice(bar + 1).split('.')[0];
}

/** CSS that outlines this route's box on the canvas and marks its row in Kaoto's Routes list. */
export function selectedRouteCss(groupId: string | undefined): string {
  if (!groupId) return '';
  const routeId = groupId.slice(0, groupId.indexOf('|'));
  const box = `[data-echo-theme] .echo-kaoto-host g[data-id=${JSON.stringify(groupId)}] > .custom-group .custom-group__container`;
  const row = `#flows-list tr[data-testid=${JSON.stringify(`flows-list-row-${routeId}`)}]`;
  return `${box} {
  border: 2px solid var(--echo-brand);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--echo-brand) 35%, transparent);
}
${row} > td {
  background-color: color-mix(in srgb, var(--echo-selected) 14%, transparent);
}
${row} > td:first-child {
  box-shadow: inset 3px 0 0 var(--echo-selected);
  font-weight: var(--pf-t--global--font--weight--body--bold);
}`;
}
