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
  /** Reporting's help text; the key is absent when the row has none. */
  description?: string;
  /**
   * The control lists the field names: its own `control_list`, then those of its
   * subfields at any depth, each once, in catalog order. Reporting keys the
   * snapshot labels by these names (FR-20), so a view reads a field's labels by
   * them. Empty for a field that names none.
   */
  controlLists: string[];
  /**
   * Subfield key -> the control list its option ids belong to, at any depth,
   * first occurrence wins. Absent when no subfield names a list. A list field's
   * entries hold ids (e.g. `actor_type: 1`); this is what turns them into names.
   */
  subfieldLists?: Record<string, string>;
  /**
   * Reporting's `visible_when`: the field is shown only when it holds on the
   * result's values (F-015). Absent when the row has none.
   */
  visibleWhen?: VisibleWhen;
}

/**
 * Reporting's condition grammar: a leaf on a field key (or `$result_type`),
 * or `any` / `all` of conditions.
 */
export type VisibleWhen =
  | { field: string; operator: 'eq'; value: unknown }
  | { field: string; operator: 'in'; value: unknown[] }
  | { any: VisibleWhen[] }
  | { all: VisibleWhen[] };

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

/**
 * The control lists a row names: its own, then its subfields' (depth first),
 * each once. A `null` or absent `control_list` means no list. Any other value
 * that is not a text, or `subfields` that is not a list of rows, is malformed
 * Reporting data (503), never skipped.
 */
function controlListsOf(row: Json, at: string, into: string[] = []): string[] {
  const own = row.control_list;
  // `null` or absent: no list. A display-only attribute must not take loads down.
  if (own !== undefined && own !== null) {
    if (typeof own !== 'string' || own === '') {
      return malformed(`${at}.control_list`);
    }
    if (!into.includes(own)) into.push(own);
  }
  const subfields = row.subfields;
  if (subfields !== undefined) {
    if (!Array.isArray(subfields)) return malformed(`${at}.subfields`);
    subfields.forEach((sub, i) => {
      if (!isObject(sub)) malformed(`${at}.subfields[${i}]`);
      controlListsOf(sub as Json, `${at}.subfields[${i}]`, into);
    });
  }
  return into;
}

const withSubfieldLists = (
  lists: Record<string, string>,
): { subfieldLists?: Record<string, string> } =>
  Object.keys(lists).length === 0 ? {} : { subfieldLists: lists };

/**
 * Subfield key -> control list, depth first, first occurrence wins. Only reads
 * rows `controlListsOf` already checked, so it never throws.
 */
function subfieldListsOf(
  row: Json,
  into: Record<string, string> = {},
): Record<string, string> {
  const subfields = row.subfields;
  if (!Array.isArray(subfields)) return into;
  for (const sub of subfields as Json[]) {
    const key = sub.key;
    const list = sub.control_list;
    if (
      typeof key === 'string' &&
      typeof list === 'string' &&
      list !== '' &&
      !Object.hasOwn(into, key)
    ) {
      into[key] = list;
    }
    subfieldListsOf(sub, into);
  }
  return into;
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
 * A `visible_when` as Reporting writes it. A shape this grammar does not know
 * (a new operator, say) reads as no condition: the field stays visible, and the
 * catalog is not refused over a display rule (F-015).
 */
function conditionOf(raw: unknown): VisibleWhen | undefined {
  if (!isObject(raw)) return undefined;
  for (const key of ['any', 'all'] as const) {
    const list = raw[key];
    if (list === undefined) continue;
    if (!Array.isArray(list)) return undefined;
    const conditions = list.map(conditionOf);
    if (conditions.some((c) => c === undefined)) return undefined;
    const known = conditions as VisibleWhen[];
    return key === 'any' ? { any: known } : { all: known };
  }
  const { field, operator, value } = raw;
  if (typeof field !== 'string') return undefined;
  if (operator === 'eq') return { field, operator, value };
  if (operator === 'in' && Array.isArray(value)) {
    return { field, operator, value };
  }
  return undefined;
}

const withVisibleWhen = (
  visibleWhen: VisibleWhen | undefined,
): { visibleWhen?: VisibleWhen } => (visibleWhen ? { visibleWhen } : {});

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
    if (r.description !== undefined && typeof r.description !== 'string') {
      malformed(`${at}.description`);
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
      controlLists: controlListsOf(r, at),
      ...withSubfieldLists(subfieldListsOf(r)),
      ...(r.description === undefined ? {} : { description: r.description }),
      ...withVisibleWhen(conditionOf(r.visible_when)),
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
