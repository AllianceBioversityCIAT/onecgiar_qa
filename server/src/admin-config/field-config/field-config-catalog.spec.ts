import { readFileSync } from 'node:fs';
import { Logger } from '@nestjs/common';
import { UpstreamUnavailableError } from '../../users/catalogs/catalogs.errors.js';
import { applicableFields, shapeCatalog } from './field-config-catalog.js';

// Real Reporting TEST catalog, phase_year=2026, catalog_version 2026.30
// (body only): 9 types, 25 sections, 161 fields, 30 with "*".
const RAW = JSON.parse(
  readFileSync(
    new URL('./fixtures/reporting-qa-catalog-2026.json', import.meta.url),
    'utf8',
  ),
) as {
  result_types: { key: string }[];
  sections: { key: string; order: number }[];
  fields: Record<string, unknown>[];
};
const clone = () => structuredClone(RAW);

// Applicable fields per type, "*" included (spec amended 2026-10-26).
const COUNTS: Record<string, number> = {
  policy_change: 50,
  innovation_use: 70,
  other_outcome: 43,
  capacity_sharing: 51,
  knowledge_product: 69,
  innovation_development: 70,
  other_output: 43,
  impact_contribution: 43,
  innovation_package: 65,
};

describe('shapeCatalog over the TEST catalog 2026.30', () => {
  const catalog = shapeCatalog(RAW);

  it('keeps the version, the 9 types, the 25 sections and the 161 top-level fields', () => {
    expect(catalog.catalogVersion).toBe('2026.30');
    expect(catalog.resultTypes).toHaveLength(9);
    expect(catalog.sections).toHaveLength(25);
    expect(catalog.fields).toHaveLength(161);
  });

  it.each(Object.entries(COUNTS))(
    '%s has %i applicable fields, "*" included',
    (type, count) => {
      expect(applicableFields(catalog, type)).toHaveLength(count);
    },
  );

  it('expands "*" on sections and fields to the 9 type keys', () => {
    const all = RAW.result_types.map((t) => t.key);
    expect(
      catalog.sections.find((s) => s.key === 'general_information')
        ?.resultTypes,
    ).toEqual(all);
    const star = RAW.fields.filter((f) =>
      (f.result_types as string[]).includes('*'),
    );
    expect(star).toHaveLength(30);
    for (const f of star) {
      expect(catalog.fields.find((x) => x.key === f.key)?.resultTypes).toEqual(
        all,
      );
    }
    expect(JSON.stringify(catalog)).not.toContain('"*"');
  });

  it('breaks the ties of the five order-50 sections by array position, not by key', () => {
    const tied = catalog.sections
      .filter((s) => s.order === 50)
      .map((s) => s.key);
    expect(tied).toEqual([
      'knowledge_product',
      'capacity_sharing',
      'innovation_development',
      'policy_change_info',
      'iu_current_use',
    ]);
    const orders = catalog.sections.map((s) => s.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it('groups fields by section although the payload interleaves them', () => {
    const runs = (keys: string[]) =>
      keys.filter((k, i) => i === 0 || k !== keys[i - 1]).length;
    // The payload really is interleaved: 75 runs for 25 sections (catalog doc § 3).
    expect(runs(RAW.fields.map((f) => f.section as string))).toBeGreaterThan(
      25,
    );

    for (const type of Object.keys(COUNTS)) {
      const fields = applicableFields(catalog, type);
      const sectionKeys = fields.map((f) => f.section);
      expect(runs(sectionKeys)).toBe(new Set(sectionKeys).size);
      const position = (key: string) =>
        catalog.sections.findIndex((s) => s.key === key);
      const positions = sectionKeys.map(position);
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
      fields.forEach((f, i) => {
        if (i > 0 && f.section === fields[i - 1].section) {
          expect(f.order).toBeGreaterThanOrEqual(fields[i - 1].order);
        }
      });
    }
  });

  it('derives the requirement: required, else conditional with required_when, else optional', () => {
    const req = (key: string) =>
      catalog.fields.find((f) => f.key === key)?.requirement;
    expect(req('general.result_level')).toBe('required');
    expect(req('general.description')).toBe('conditional');
    expect(req('general.is_replicated')).toBe('optional');
    const count = (r: string) =>
      catalog.fields.filter((f) => f.requirement === r).length;
    expect([
      count('required'),
      count('conditional'),
      count('optional'),
    ]).toEqual([54, 47, 60]);
  });

  it('isNew is false when no row carries a flag', () => {
    expect(catalog.fields.every((f) => f.isNew === false)).toBe(true);
  });

  it('isNew is true only for the row that carries the flag', () => {
    const raw = clone();
    raw.fields[7].is_new = true;
    const shaped = shapeCatalog(raw);
    expect(shaped.fields.filter((f) => f.isNew).map((f) => f.key)).toEqual([
      raw.fields[7].key,
    ]);
  });

  it('passes the description through when the row has one and leaves the key out otherwise', () => {
    const withText = catalog.fields.find((f) => f.key === 'general.title')!;
    expect(withText.description).toMatch(
      /^Provide a clear, informative name of the output/,
    );
    const without = catalog.fields.find(
      (f) => f.key === 'general.result_level',
    )!;
    expect('description' in without).toBe(false);
    expect(catalog.fields.filter((f) => 'description' in f)).toHaveLength(55);
  });

  it('lists no subfield', () => {
    const sub: string[] = [];
    const walk = (rows: unknown): void => {
      if (!Array.isArray(rows)) return;
      for (const r of rows as Record<string, unknown>[]) {
        sub.push(r.key as string);
        walk(r.subfields);
      }
    };
    for (const f of RAW.fields) walk(f.subfields);
    // 217 direct children, 249 counting nested subfields.
    expect(sub.length).toBe(249);
    const keys = new Set(catalog.fields.map((f) => f.key));
    expect(sub.filter((k) => keys.has(k))).toEqual([]);
    expect(JSON.stringify(catalog)).not.toContain('subfields');
  });
});

describe('shapeCatalog on a malformed catalog', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const broken: [string, (raw: ReturnType<typeof clone>) => unknown][] = [
    ['a body that is not an object', () => []],
    ['no catalog_version', (r) => ({ ...r, catalog_version: undefined })],
    [
      'a field with a description that is not a string',
      (r) => {
        r.fields[3].description = 7;
        return r;
      },
    ],
    ['no sections array', (r) => ({ ...r, sections: 'x' })],
    [
      'a field without a key',
      (r) => {
        delete r.fields[3].key;
        return r;
      },
    ],
    [
      'a field with a non-boolean required',
      (r) => {
        r.fields[3].required = 'yes';
        return r;
      },
    ],
    [
      'a field with a non-numeric order',
      (r) => {
        r.fields[3].order = '5';
        return r;
      },
    ],
    [
      'a field in an unknown section',
      (r) => {
        r.fields[3].section = 'nope';
        return r;
      },
    ],
    [
      'a field whose result_types is not a list',
      (r) => {
        r.fields[3].result_types = '*';
        return r;
      },
    ],
    [
      'a field naming an unknown result type',
      (r) => {
        r.fields[3].result_types = ['bogus'];
        return r;
      },
    ],
    [
      'a field with a non-boolean is_new',
      (r) => {
        r.fields[3].is_new = 'true';
        return r;
      },
    ],
    [
      'a section without an order',
      (r) => {
        delete (r.sections[2] as Record<string, unknown>).order;
        return r;
      },
    ],
  ];
  it.each(broken)(
    '%s is an UpstreamUnavailableError, never a silent skip',
    (_n, mutate) => {
      expect(() => shapeCatalog(mutate(clone()))).toThrow(
        UpstreamUnavailableError,
      );
    },
  );
});
