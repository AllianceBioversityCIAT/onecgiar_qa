import type { FieldCatalog } from './field-config-catalog.js';

/** Port: the catalog of one phase year, already shaped (design 7.4). */
export const FIELD_CATALOG_SOURCE = Symbol('FIELD_CATALOG_SOURCE');

export interface FieldCatalogSource {
  forYear(year: number): Promise<FieldCatalog>;
}

/**
 * Reporting has no catalog for the year (it answered 404). Defined in
 * `admin-config.errors.ts` (409 `FIELD_CONFIG_CATALOG_MISSING`); re-exported so
 * the catalog client keeps importing it from its port.
 */
export { FieldConfigCatalogMissingError as FieldCatalogMissingError } from '../admin-config.errors.js';
