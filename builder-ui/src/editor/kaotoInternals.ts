/**
 * Kaoto internals used by ECHO's replacements of Kaoto's DataMapper pages (EchoDataMappersPage.tsx,
 * EchoDataMapperPage.tsx). @kaoto/kaoto does not export them, so they are imported from its files.
 *
 * Only those pages may import this module. vite.config.ts puts them in place of Kaoto's own pages,
 * so they are bundled with Kaoto and share its module instances (its React contexts above all).
 * Imported from anywhere else, in the dev server these would be second copies with empty contexts.
 */
export { EntitiesContext } from '../../node_modules/@kaoto/kaoto/lib/providers/entities.provider';
export { SettingsContext } from '../../node_modules/@kaoto/kaoto/lib/providers/settings.provider';
export { DataMapper } from '../../node_modules/@kaoto/kaoto/lib/components/DataMapper/DataMapper';
