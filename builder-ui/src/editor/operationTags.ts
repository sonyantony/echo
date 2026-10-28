import type { ApiTags } from '../api/flows';

/** Kaoto's step form field wrappers and the Operation Id drop-down's menu (see KaotoEditorHost). */
export const OPERATION_FIELD = "[data-testid='#.parameters.operationId__field-wrapper']";
export const SPEC_FIELD = "[data-testid='#.parameters.specificationUri__field-wrapper']";
const OPERATION_MENU = "[data-testid='#.parameters.operationId-typeahead-select']";

/** The approved API a REST OpenApi step's Specification Uri names (with or without classpath:), if any. */
export function apiFor(apis: ApiTags[], specificationUri: string): ApiTags | undefined {
  const uri = specificationUri.trim().replace(/^classpath:/, '');
  return apis.find((a) => a.specificationUri === uri);
}

/** The tags to offer: the chosen spec's, or every approved spec's (merged by name) when none is chosen. */
export function tagsFor(apis: ApiTags[], specificationUri: string): ApiTags['tags'] {
  const api = apiFor(apis, specificationUri);
  if (api) return api.tags;
  const merged = new Map<string, string[]>();
  for (const tag of apis.flatMap((a) => a.tags)) merged.set(tag.name, [...(merged.get(tag.name) ?? []), ...tag.operations]);
  return [...merged].map(([name, operations]) => ({ name, operations })).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/** The tag a step whose operation is already set starts on: the operation's first; '' (all tags) otherwise. */
export function tagOf(tags: ApiTags['tags'], operationId: string): string {
  const id = operationId.trim();
  return (id && tags.find((t) => t.operations.includes(id))?.name) || '';
}

/**
 * CSS that hides the Operation Id drop-down's options not under the tag. Kaoto's options carry
 * aria-label "option <operationId in lower case>"; anything else (e.g. its "Create" option) stays.
 */
export function operationFilterCss(tags: ApiTags['tags'], tag: string): string {
  const operations = tags.find((t) => t.name === tag)?.operations;
  if (!operations) return '';
  const shown = operations.map((id) => `[aria-label=${JSON.stringify(`option ${id.toLowerCase()}`)}]`).join(', ');
  return `${OPERATION_MENU} li:has(> [role='option'][aria-label^='option ']):not(:has(> :is(${shown}))) {
  display: none;
}
`;
}
