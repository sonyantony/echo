import { isMap, isScalar, isSeq, parseDocument } from 'yaml';

/**
 * Routes switched off with `autoStartup: false`: Camel loads them but does not start them, and
 * ECHO answers 404 for an operation whose route is switched off (RestFromSpec in the backend).
 * Kaoto's Routes list does not show this, so ECHO marks those rows "Disabled".
 */
export function disabledRouteIds(yaml: string): string[] {
  try {
    const doc = parseDocument(yaml);
    if (!isSeq(doc.contents)) return [];
    const ids: string[] = [];
    for (const item of doc.contents.items) {
      const route = isMap(item) ? item.get('route', true) : undefined;
      if (!isMap(route)) continue;
      const id = route.get('id');
      const autoStartup = route.get('autoStartup', true);
      const value = isScalar(autoStartup) ? autoStartup.value : autoStartup;
      if (typeof id === 'string' && (value === false || String(value).trim().toLowerCase() === 'false')) ids.push(id);
    }
    return ids;
  } catch {
    return [];
  }
}

/** CSS that adds a "Disabled" badge after the name of each of these routes in Kaoto's Routes list. */
export function disabledRouteCss(ids: string[]): string {
  if (ids.length === 0) return '';
  const rows = ids.map((id) => `#flows-list tr[data-testid=${JSON.stringify(`flows-list-row-${id}`)}] td:first-child`);
  return `${rows.map((r) => `${r} > *`).join(',\n')} {
  display: inline-flex;
}
${rows.map((r) => `${r}::after`).join(',\n')} {
  content: 'Disabled';
  margin-inline-start: var(--pf-t--global--spacer--sm);
  padding: 0 var(--pf-t--global--spacer--sm);
  border-radius: var(--pf-t--global--border--radius--pill);
  border: 1px solid var(--echo-border);
  color: var(--echo-text-subtle);
  font-size: var(--pf-t--global--font--size--body--sm);
  vertical-align: middle;
}`;
}
