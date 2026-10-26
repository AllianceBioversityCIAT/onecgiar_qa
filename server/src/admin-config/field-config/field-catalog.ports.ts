import type { FieldCatalog } from './field-config-catalog.js';

/** Port: the catalog of one phase year, already shaped (design 7.4). */
export const FIELD_CATALOG_SOURCE = Symbol('FIELD_CATALOG_SOURCE');

export interface FieldCatalogSource {
  forYear(year: number): Promise<FieldCatalog>;
}

/**
 * Reporting has no catalog for the year (it answered 404). Plain typed error:
 * the HTTP binding (409 `FIELD_CONFIG_CATALOG_MISSING`) belongs to T-3. The
 * year is for logs only.
 */
export class FieldCatalogMissingError extends Error {
  constructor(readonly year: number) {
    super(`No Reporting catalog exists for phase_year ${year}`);
    this.name = 'FieldCatalogMissingError';
  }
}
