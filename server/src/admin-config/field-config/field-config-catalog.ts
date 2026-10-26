import { Logger } from '@nestjs/common';
import { UpstreamUnavailableError } from '../../users/catalogs/catalogs.errors.js';
import { isObject, type Json } from '../../users/catalogs/catalog-http.js';

export type FieldRequirement = 'required' | 'conditional' | 'optional';

export interface CatalogResultType {
  key: string;
  label: string;
  level: string;
}

export interface CatalogSection {
  key: string;
  label: string;
  order: number;
  /** `"*"` already expanded to every result type key. */
  resultTypes: string[];
}

export interface CatalogField {
  key: string;
  label: string;
  type: string;
  section: string;
  order: number;
  /** `"*"` already expanded to every result type key. */
  resultTypes: string[];
  requirement: FieldRequirement;
  isNew: boolean;
}

export interface FieldCatalog {
  catalogVersion: string;
  resultTypes: CatalogResultType[];
  /** In section order; ties by catalog array position. */
  sections: CatalogSection[];
  /** Top-level fields only, in catalog array order. */
  fields: CatalogField[];
}

const STAR = '*';

/** Malformed Reporting data is never skipped silently: it is a 503 (design 7.1). */
function malformed(what: string): never {
  new Logger('FieldCatalog').warn(
    `upstream_bad_body source=reporting at=${what}`,
  );
  throw new UpstreamUnavailableError();
}

function str(row: Json, key: string, at: string): string {
  const v = row[key];
  if (typeof v !== 'string' || v === '') malformed(`${at}.${key}`);
  return v as string;
}

function rows(body: Json, key: string): Json[] {
  const v = body[key];
  if (!Array.isArray(v)) return malformed(key);
  v.forEach((r, i) => {
    if (!isObject(r)) malformed(`${key}[${i}]`);
  });
  return v as Json[];
}

/** `["*"]` becomes every type key; any other key must be a known type. */
function expandTypes(row: Json, known: string[], at: string): string[] {
  const v = row.result_types;
  if (!Array.isArray(v) || v.length === 0)
    return malformed(`${at}.result_types`);
  if (v.includes(STAR)) return [...known];
  for (const k of v) {
    if (typeof k !== 'string' || !known.includes(k)) {
      malformed(`${at}.result_types`);
    }
  }
  return v as string[];
}

/**
 * Reporting JSON to the field catalog (design 7.1). Top-level fields only
 * (S-1). `"*"` is expanded; section ties keep array position (the sort is
 * stable); the requirement and `isNew` follow the glossary and S-6.
 */
export function shapeCatalog(raw: unknown): FieldCatalog {
  if (!isObject(raw)) return malformed('body');
  const catalogVersion = str(raw, 'catalog_version', 'catalog');

  const resultTypes = rows(raw, 'result_types').map((r, i) => ({
    key: str(r, 'key', `result_types[${i}]`),
    label: str(r, 'label', `result_types[${i}]`),
    level: str(r, 'level', `result_types[${i}]`),
  }));
  const known = resultTypes.map((t) => t.key);

  const sections = rows(raw, 'sections')
    .map((r, i): CatalogSection => {
      const at = `sections[${i}]`;
      if (typeof r.order !== 'number') malformed(`${at}.order`);
      return {
        key: str(r, 'key', at),
        label: str(r, 'label', at),
        order: r.order as number,
        resultTypes: expandTypes(r, known, at),
      };
    })
    .sort((a, b) => a.order - b.order);
  const sectionKeys = new Set(sections.map((s) => s.key));

  const fields = rows(raw, 'fields').map((r, i): CatalogField => {
    const at = `fields[${i}]`;
    const section = str(r, 'section', at);
    if (!sectionKeys.has(section)) malformed(`${at}.section`);
    if (typeof r.order !== 'number') malformed(`${at}.order`);
    if (typeof r.required !== 'boolean') malformed(`${at}.required`);
    if (r.is_new !== undefined && typeof r.is_new !== 'boolean') {
      malformed(`${at}.is_new`);
    }
    return {
      key: str(r, 'key', at),
      label: str(r, 'label', at),
      type: str(r, 'type', at),
      section,
      order: r.order as number,
      resultTypes: expandTypes(r, known, at),
      requirement: r.required
        ? 'required'
        : r.required_when
          ? 'conditional'
          : 'optional',
      isNew: r.is_new === true,
    };
  });

  return { catalogVersion, resultTypes, sections, fields };
}

/**
 * The fields of a result type in section order, then field order (ties by
 * catalog position): the single definition of "applicable" (glossary).
 */
export function applicableFields(
  catalog: FieldCatalog,
  type: string,
): CatalogField[] {
  const out: CatalogField[] = [];
  for (const section of catalog.sections) {
    const inSection = catalog.fields.filter(
      (f) => f.section === section.key && f.resultTypes.includes(type),
    );
    out.push(...inSection.sort((a, b) => a.order - b.order));
  }
  return out;
}
