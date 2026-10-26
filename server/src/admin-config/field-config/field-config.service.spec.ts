// @akili-spec admin-config/field-configuration
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryFieldConfigDatabase } from '../../../test/support/in-memory-field-config.js';
import { UpstreamUnavailableError } from '../../users/catalogs/catalogs.errors.js';
import {
  CycleNotFoundError,
  FieldConfigCatalogMissingError,
  FieldConfigNoVersionError,
  FieldConfigTypeNotInTimelineError,
  TimelineNotFoundError,
} from '../admin-config.errors.js';
import { applicableFields, shapeCatalog } from './field-config-catalog.js';
import type { ConfigItem, OptionSet } from './field-config-diff.js';
import { FieldConfigService } from './field-config.service.js';

// Expected values are the FR-2, FR-3, FR-7, FR-10 and FR-13 scenarios and NFR-5
// written out as literals, over the real Reporting TEST catalog (phase_year
// 2026, catalog_version 2026.30: 9 types, 161 fields, 30 with "*"), the
// in-memory field-config world (a round trip and a `statementLog` entry per
// statement, never bypassed) and an injected clock. Rome is UTC+2 on the
// 2026-10-20 clock (CEST).

const NOW = new Date('2026-10-20T10:00:00.000Z');
const HIDDEN: OptionSet = {
  visibility: 'hidden',
  isCore: false,
  isAiInput: false,
};
const ASSESSED: OptionSet = {
  visibility: 'assessed',
  isCore: true,
  isAiInput: false,
};
const VIEW_ONLY: OptionSet = {
  visibility: 'view_only',
  isCore: false,
  isAiInput: false,
};
const CREATED = new Date('2026-09-01T09:00:00.000Z');

const item = (
  resultTypeKey: string,
  fieldKey: string,
  option: Omit<ConfigItem, 'resultTypeKey' | 'fieldKey'> = HIDDEN,
): ConfigItem => ({ resultTypeKey, fieldKey, ...option });

interface WorldOptions {
  raw?: unknown;
  forYear?: (year: number) => Promise<unknown>;
  now?: Date;
}

function world(options: WorldOptions = {}) {
  const db = new InMemoryFieldConfigDatabase();
  const catalog = shapeCatalog(options.raw ?? RAW_CATALOG());
  const forYear = vi.fn(
    options.forYear ?? (async (): Promise<unknown> => catalog),
  );
  let now = options.now ?? NOW;
  const service = new FieldConfigService(
    db.store,
    { forYear } as never,
    () => now,
  );
  for (const [id, year, status] of [
    [1, 2026, 'active'],
    [2, 2027, 'draft'],
    [3, 2025, 'closed'],
  ] as const) {
    db.world.cycles.push({
      id,
      year,
      status,
      activeKey: status === 'active' ? 1 : null,
      createdAt: CREATED,
      createdBy: 1,
      activatedAt: null,
      activatedBy: null,
      closedAt: null,
      closedBy: null,
    });
  }
  return {
    db,
    service,
    catalog,
    forYear,
    setNow: (value: Date) => {
      now = value;
    },
  };
}

function RAW_CATALOG() {
  return structuredClone(
    JSON.parse(
      readFileSync(
        new URL('./fixtures/reporting-qa-catalog-2026.json', import.meta.url),
        'utf8',
      ),
    ),
  );
}

type World = ReturnType<typeof world>;

function addVersion(
  w: World,
  number: number,
  publishedAt: string,
  items: ConfigItem[],
  cycleId = 1,
) {
  const id = w.db.versions.length + 1;
  w.db.versions.push({
    id,
    cycleId,
    number,
    catalogVersion: '2026.29',
    publishedAt: new Date(publishedAt),
    publishedBy: 1,
    requestId: null,
  });
  w.db.versionItems.push(...items.map((row) => ({ versionId: id, ...row })));
}

function addDraft(
  w: World,
  revision: number,
  items: ConfigItem[],
  cycleId = 1,
) {
  w.db.drafts.push({
    cycleId,
    revision,
    updatedAt: CREATED,
    updatedBy: 1,
  });
  w.db.draftItems.push(...items.map((row) => ({ cycleId, ...row })));
}

function addTimeline(
  w: World,
  t: {
    id: number;
    name: string;
    opensOn: string | null;
    closesOn?: string;
    types?: string[];
    cycleId?: number;
  },
) {
  w.db.world.timelines.push({
    id: t.id,
    cycleId: t.cycleId ?? 1,
    name: t.name,
    kind: t.id === 1 ? 'official' : 'additional',
    officialKey: t.id === 1 ? 1 : null,
    allPrograms: true,
    allResultTypes: t.types === undefined,
    createdAt: CREATED,
    createdBy: 1,
    version: 1,
    updatedAt: null,
    updatedBy: null,
  });
  if (t.opensOn !== null) {
    w.db.world.steps.push({
      id: t.id * 10 + 1,
      timelineId: t.id,
      position: 1,
      name: 'First',
      audience: 'assessors',
      opensOn: t.opensOn,
      closesOn: t.closesOn ?? '2026-12-01',
      round: 1,
      requiresLoad: false,
    });
  }
  for (const key of t.types ?? []) {
    w.db.world.resultTypes.push({ timelineId: t.id, resultTypeKey: key });
  }
}

const sectionKeys = (
  view: Awaited<ReturnType<FieldConfigService['view']>>,
  type: string,
) => view.resultTypes.find((rt) => rt.key === type)!.sections.map((s) => s.key);

const fieldsOf = (
  view: Awaited<ReturnType<FieldConfigService['view']>>,
  type: string,
) =>
  view.resultTypes
    .find((rt) => rt.key === type)!
    .sections.flatMap((s) => s.fields);

describe('FieldConfigService.view (FR-2, FR-3, FR-13)', () => {
  it('groups by result type, then section, in catalog order; a "*" field is under every type; subfields are not listed', async () => {
    const w = world();
    const view = await w.service.view(1);

    expect(view.resultTypes.map((rt) => rt.key)).toEqual([
      'policy_change',
      'innovation_use',
      'other_outcome',
      'capacity_sharing',
      'knowledge_product',
      'innovation_development',
      'other_output',
      'impact_contribution',
      'innovation_package',
    ]);
    expect(view.resultTypes[0]).toMatchObject({
      key: 'policy_change',
      label: 'Policy change',
      level: 'outcome',
    });
    // Section order is the catalog's `order`; the "*" sections come first.
    expect(sectionKeys(view, 'policy_change').slice(0, 3)).toEqual([
      'general_information',
      'contributors_partners',
      'geographic_location',
    ]);
    // Field order inside the first section.
    expect(
      view.resultTypes[0]!.sections[0]!.fields.slice(0, 4).map((f) => f.key),
    ).toEqual([
      'general.result_level',
      'general.result_type',
      'general.primary_program',
      'general.title',
    ]);
    expect(view.resultTypes[0]!.sections[0]).toMatchObject({
      key: 'general_information',
      label: 'General information',
    });
    // 50 applicable fields for policy_change, "*" included.
    expect(fieldsOf(view, 'policy_change')).toHaveLength(50);
    expect(fieldsOf(view, 'knowledge_product')).toHaveLength(69);
    for (const type of view.resultTypes) {
      expect(fieldsOf(view, type.key).map((f) => f.key)).toContain(
        'general.title',
      );
    }
    // A subfield ("link", under ipsr_step_4.reference_materials) is never an entry.
    const all = view.resultTypes.flatMap((rt) =>
      rt.sections.flatMap((s) => s.fields.map((f) => f.key)),
    );
    expect(all).not.toContain('link');
    expect(fieldsOf(view, 'innovation_package').map((f) => f.key)).toContain(
      'ipsr_step_4.reference_materials',
    );
    expect(fieldsOf(view, 'policy_change').map((f) => f.key)).not.toContain(
      'ipsr_step_4.reference_materials',
    );
  });

  it('emits the description only when the catalog row has one', async () => {
    const fields = fieldsOf(await world().service.view(1), 'policy_change');
    const by = (key: string) => fields.find((f) => f.key === key)!;

    expect(by('general.title').description).toMatch(
      /^Provide a clear, informative name of the output/,
    );
    expect('description' in by('general.result_level')).toBe(false);
    expect(fields.filter((f) => 'description' in f).length).toBeGreaterThan(0);
  });

  it('shows each requirement and the "new" flag: required, conditional, optional; isNew only when the catalog sends it', async () => {
    const raw = RAW_CATALOG() as { fields: Record<string, unknown>[] };
    raw.fields.find((f) => f.key === 'general.title')!.is_new = true;
    const w = world({ raw });
    const fields = fieldsOf(await w.service.view(1), 'policy_change');
    const by = (key: string) => fields.find((f) => f.key === key)!;

    expect(by('general.title')).toMatchObject({
      label: 'Title of Result',
      requirement: 'required',
      isNew: true,
    });
    expect(by('general.description')).toMatchObject({
      requirement: 'conditional',
      isNew: false,
    });
    expect(
      fields.filter((f) => f.requirement === 'optional').length,
    ).toBeGreaterThan(0);
    expect(fields.filter((f) => f.isNew).map((f) => f.key)).toEqual([
      'general.title',
    ]);
  });

  it("reads the catalog for the cycle's year, not the clock's: cycle 2027 on a 2026 clock", async () => {
    const w = world();
    const view = await w.service.view(2);

    expect(w.forYear).toHaveBeenCalledTimes(1);
    expect(w.forYear).toHaveBeenCalledWith(2027);
    expect(view.year).toBe(2027);
    expect(view.cycleId).toBe(2);
  });

  it('refuses with the typed 409 when Reporting has no catalog for the year, never an empty list', async () => {
    const w = world({
      forYear: async (year) => {
        throw new FieldConfigCatalogMissingError(year);
      },
    });
    const error = await w.service.view(2).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(FieldConfigCatalogMissingError);
    expect((error as FieldConfigCatalogMissingError).getStatus()).toBe(409);
  });

  it('answers 503 when Reporting is down, never an empty list', async () => {
    const w = world({
      forYear: async () => {
        throw new UpstreamUnavailableError();
      },
    });
    const error = await w.service.view(1).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UpstreamUnavailableError);
    expect((error as UpstreamUnavailableError).getStatus()).toBe(503);
  });

  it('reads an unclassified field as hidden with both flags off and marks it; a classified one shows its draft', async () => {
    const w = world();
    addDraft(w, 3, [item('policy_change', 'general.title', ASSESSED)]);
    const fields = fieldsOf(await w.service.view(1), 'policy_change');
    const by = (key: string) => fields.find((f) => f.key === key)!;

    expect(by('general.title')).toMatchObject({
      unclassified: false,
      draft: { visibility: 'assessed', isCore: true, isAiInput: false },
    });
    expect(by('general.description')).toMatchObject({
      unclassified: true,
      draft: { visibility: 'hidden', isCore: false, isAiInput: false },
      published: null,
    });
    expect(fields.filter((f) => f.unclassified)).toHaveLength(49);
  });

  it('returns a draft option set of a field the catalog no longer lists for the type apart, as not in catalog', async () => {
    const w = world();
    addDraft(w, 1, [
      item('policy_change', 'general.title', VIEW_ONLY),
      // Exists in the catalog, but only for innovation_package.
      item('policy_change', 'ipsr_step_4.reference_materials', ASSESSED),
      // A field that left the catalog, and a type that did.
      item('policy_change', 'gone.field', VIEW_ONLY),
      item('old_type', 'general.title', VIEW_ONLY),
    ]);
    const view = await w.service.view(1);

    expect(view.notInCatalog).toEqual([
      {
        resultTypeKey: 'old_type',
        fieldKey: 'general.title',
        draft: VIEW_ONLY,
      },
      {
        resultTypeKey: 'policy_change',
        fieldKey: 'gone.field',
        draft: VIEW_ONLY,
      },
      {
        resultTypeKey: 'policy_change',
        fieldKey: 'ipsr_step_4.reference_materials',
        draft: ASSESSED,
      },
    ]);
    expect(fieldsOf(view, 'policy_change').map((f) => f.key)).not.toContain(
      'gone.field',
    );
    expect(
      fieldsOf(view, 'policy_change').find((f) => f.key === 'general.title')!
        .draft,
    ).toEqual(VIEW_ONLY);
  });

  it('carries the revision, the latest version (number and instant, or none) and the catalog version', async () => {
    const w = world();
    addDraft(w, 7, []);
    addVersion(w, 1, '2026-09-01T09:00:00Z', []);
    addVersion(w, 2, '2026-10-05T09:00:00Z', [
      item('policy_change', 'general.title', ASSESSED),
    ]);
    const view = await w.service.view(1);

    expect(view.revision).toBe(7);
    expect(view.catalogVersion).toBe('2026.30');
    expect(view.latestVersion).toEqual({
      number: 2,
      publishedAt: new Date('2026-10-05T09:00:00Z'),
    });
    const title = fieldsOf(view, 'policy_change').find(
      (f) => f.key === 'general.title',
    )!;
    // Published values are the LATEST version's; a field it has no row for is null.
    expect(title.published).toEqual(ASSESSED);
    expect(
      fieldsOf(view, 'policy_change').find(
        (f) => f.key === 'general.description',
      )!.published,
    ).toBeNull();

    const empty = world();
    expect(await empty.service.view(1)).toMatchObject({
      revision: 0,
      latestVersion: null,
      notInCatalog: [],
    });
  });

  it('still reads a closed cycle; an unknown cycle is 404 and the catalog is not read', async () => {
    const w = world();
    const closed = await w.service.view(3);
    expect(closed.year).toBe(2025);
    expect(w.forYear).toHaveBeenCalledWith(2025);

    w.forYear.mockClear();
    const error = await w.service.view(99).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CycleNotFoundError);
    expect((error as CycleNotFoundError).getStatus()).toBe(404);
    expect(w.forYear).not.toHaveBeenCalled();
  });

  it('runs a fixed number of statements whatever the number of draft and version items (NFR-5), one catalog read', async () => {
    const small = world();
    addDraft(small, 1, [item('policy_change', 'general.title', ASSESSED)]);
    addVersion(small, 1, '2026-09-01T09:00:00Z', [
      item('policy_change', 'general.title', ASSESSED),
    ]);
    await small.service.view(1);

    const big = world();
    const fields = applicableFields(big.catalog, 'policy_change');
    addDraft(
      big,
      1,
      fields.map((f) => item('policy_change', f.key, VIEW_ONLY)),
    );
    addVersion(
      big,
      1,
      '2026-09-01T09:00:00Z',
      fields.map((f) => item('policy_change', f.key, VIEW_ONLY)),
    );
    await big.service.view(1);

    // cycle, draft, draft items, latest version, its items.
    expect(small.db.statementLog).toHaveLength(5);
    expect(big.db.statementLog).toHaveLength(5);
    expect(small.forYear).toHaveBeenCalledTimes(1);
    expect(big.db.writeLog).toEqual([]);
  });
});

describe('FieldConfigService.preview (FR-7, FR-13, NFR-5)', () => {
  /** Version 2 and a draft that changes `general.title` for `policy_change`; timelines A, B, C (FR-7) plus D (finished). */
  function scenario() {
    const w = world();
    addVersion(w, 1, '2026-09-01T09:00:00Z', [
      item('policy_change', 'general.title', HIDDEN),
    ]);
    addVersion(w, 2, '2026-10-10T09:00:00Z', [
      item('policy_change', 'general.title', VIEW_ONLY),
      item('policy_change', 'general.description', VIEW_ONLY),
    ]);
    addDraft(w, 4, [
      item('policy_change', 'general.title', ASSESSED),
      item('policy_change', 'general.description', VIEW_ONLY),
    ]);
    // A started and still running, covers policy_change.
    addTimeline(w, {
      id: 1,
      name: 'Timeline A',
      opensOn: '2026-10-01',
      types: ['policy_change'],
    });
    // B has not started, covers policy_change.
    addTimeline(w, {
      id: 2,
      name: 'Timeline B',
      opensOn: '2026-11-02',
      types: ['policy_change'],
    });
    // C has not started and covers only knowledge_product.
    addTimeline(w, {
      id: 3,
      name: 'Timeline C',
      opensOn: '2026-11-02',
      types: ['knowledge_product'],
    });
    // D finished, for every type: in neither list (DD-8).
    addTimeline(w, {
      id: 4,
      name: 'Timeline D',
      opensOn: '2026-08-01',
      closesOn: '2026-09-15',
    });
    return w;
  }

  it('lists the changed field with before and after, B under receive, A under keep its version, C and the finished one under neither', async () => {
    const w = scenario();
    const preview = await w.service.preview(1);

    expect(preview.revision).toBe(4);
    expect(preview.basedOn).toBe(2);
    expect(preview.changes).toEqual([
      {
        resultTypeKey: 'policy_change',
        fieldKey: 'general.title',
        before: VIEW_ONLY,
        after: ASSESSED,
      },
    ]);
    expect(preview.timelines.receive).toEqual([
      { id: 2, name: 'Timeline B', opensOn: '2026-11-02' },
    ]);
    // A opened 2026-10-01, before version 2 (2026-10-10): it keeps version 1.
    expect(preview.timelines.keep).toEqual([
      { id: 1, name: 'Timeline A', opensOn: '2026-10-01', version: 1 },
    ]);
  });

  it('writes nothing: no write statement, no transaction', async () => {
    const w = scenario();
    await w.service.preview(1);

    expect(w.db.writeLog).toEqual([]);
    expect(w.db.statementLog.every((s) => !s.startsWith('draft:bump'))).toBe(
      true,
    );
  });

  it('uses the clock it is given: after B opens it keeps a version instead of receiving it', async () => {
    const w = scenario();
    w.setNow(new Date('2026-11-03T10:00:00Z'));
    const preview = await w.service.preview(1);

    expect(preview.timelines.receive).toEqual([]);
    expect(preview.timelines.keep).toEqual([
      { id: 1, name: 'Timeline A', opensOn: '2026-10-01', version: 1 },
      // B opened 2026-11-02, after version 2: it keeps version 2.
      { id: 2, name: 'Timeline B', opensOn: '2026-11-02', version: 2 },
    ]);
  });

  it('reports no changes, and no receive or keep, when the draft equals the latest version', async () => {
    const w = scenario();
    w.db.draftItems.length = 0;
    w.db.draftItems.push(
      { cycleId: 1, ...item('policy_change', 'general.title', VIEW_ONLY) },
      {
        cycleId: 1,
        ...item('policy_change', 'general.description', VIEW_ONLY),
      },
    );
    const preview = await w.service.preview(1);

    expect(preview.changes).toEqual([]);
    expect(preview.timelines).toEqual({ receive: [], keep: [] });
    expect(preview.basedOn).toBe(2);
  });

  it('with no version yet, "before" is null and basedOn is null', async () => {
    const w = world();
    addDraft(w, 1, [item('policy_change', 'general.title', ASSESSED)]);
    addTimeline(w, { id: 1, name: 'Only', opensOn: '2026-11-02' });
    const preview = await w.service.preview(1);

    expect(preview.basedOn).toBeNull();
    expect(preview.changes).toEqual([
      {
        resultTypeKey: 'policy_change',
        fieldKey: 'general.title',
        before: null,
        after: ASSESSED,
      },
    ]);
    expect(preview.timelines.receive).toEqual([
      { id: 1, name: 'Only', opensOn: '2026-11-02' },
    ]);
  });

  it('reads the catalog for the cycle year; the catalog errors and the 404 are the view answers; a closed cycle still answers', async () => {
    const w = scenario();
    await w.service.preview(2);
    expect(w.forYear).toHaveBeenCalledWith(2027);
    await w.service.preview(3);
    expect(w.forYear).toHaveBeenLastCalledWith(2025);

    const error = await w.service.preview(99).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CycleNotFoundError);

    const missing = world({
      forYear: async (year) => {
        throw new FieldConfigCatalogMissingError(year);
      },
    });
    await expect(missing.service.preview(1)).rejects.toBeInstanceOf(
      FieldConfigCatalogMissingError,
    );
    const down = world({
      forYear: async () => {
        throw new UpstreamUnavailableError();
      },
    });
    await expect(down.service.preview(1)).rejects.toBeInstanceOf(
      UpstreamUnavailableError,
    );
  });

  it('runs the same number of statements for 1 and for 50 timelines (NFR-5)', async () => {
    const run = async (count: number) => {
      const w = world();
      addVersion(w, 1, '2026-09-01T09:00:00Z', []);
      addDraft(w, 1, [item('policy_change', 'general.title', ASSESSED)]);
      for (let id = 1; id <= count; id++) {
        addTimeline(w, {
          id,
          name: `Timeline ${id}`,
          opensOn: '2026-11-02',
          // Half cover the changed type, half do not: the scope filter is exercised.
          types: id % 2 === 0 ? ['knowledge_product'] : ['policy_change'],
        });
      }
      const preview = await w.service.preview(1);
      return { w, preview };
    };
    const one = await run(1);
    const fifty = await run(50);

    // cycle, draft, draft items, versions, 3 timeline reads, the latest version's items.
    expect(one.w.db.statementLog).toHaveLength(8);
    expect(fifty.w.db.statementLog).toHaveLength(8);
    expect(one.preview.timelines.receive.map((t) => t.id)).toEqual([1]);
    expect(fifty.preview.timelines.receive).toHaveLength(25);
    expect(fifty.preview.timelines.receive.every((t) => t.id % 2 === 1)).toBe(
      true,
    );
    expect(fifty.w.db.writeLog).toEqual([]);
  });
});

describe('FieldConfigService.effectiveFor (FR-10)', () => {
  function scenario() {
    const w = world();
    const catalog = w.catalog;
    const all = (
      type: string,
      option: Omit<ConfigItem, 'resultTypeKey' | 'fieldKey'>,
    ) => applicableFields(catalog, type).map((f) => item(type, f.key, option));
    // Version 1 stores every applicable field (DD-2): title assessed, the rest hidden, knowledge_product view-only.
    addVersion(w, 1, '2026-09-01T09:00:00Z', [
      ...applicableFields(catalog, 'policy_change').map((f) =>
        f.key === 'general.title'
          ? item('policy_change', f.key, ASSESSED)
          : item('policy_change', f.key, HIDDEN),
      ),
      ...all('knowledge_product', VIEW_ONLY),
    ]);
    addVersion(w, 2, '2026-10-10T09:00:00Z', [
      item('policy_change', 'general.title', VIEW_ONLY),
    ]);
    // A: started 2026-10-01, before version 2 -> version 1. B: not started -> latest, provisional.
    addTimeline(w, {
      id: 1,
      name: 'Timeline A',
      opensOn: '2026-10-01',
      types: ['policy_change', 'knowledge_product'],
    });
    addTimeline(w, {
      id: 2,
      name: 'Timeline B',
      opensOn: '2026-11-02',
      types: ['policy_change'],
    });
    addTimeline(w, {
      id: 3,
      name: 'Timeline C',
      opensOn: '2026-11-02',
      types: ['knowledge_product'],
    });
    return w;
  }

  it("returns the resolved version's option sets for the type only: A resolves to version 1, every applicable field present, unclassified ones hidden", async () => {
    const w = scenario();
    const effective = await w.service.effectiveFor(1, 1, 'policy_change');

    expect(effective).toMatchObject({
      timelineId: 1,
      resultTypeKey: 'policy_change',
      version: 1,
      provisional: false,
    });
    expect(effective.items).toHaveLength(50);
    expect(
      effective.items.every((i) => i.resultTypeKey === 'policy_change'),
    ).toBe(true);
    expect(effective.items.find((i) => i.fieldKey === 'general.title')).toEqual(
      item('policy_change', 'general.title', ASSESSED),
    );
    expect(
      effective.items.find((i) => i.fieldKey === 'general.description'),
    ).toEqual(item('policy_change', 'general.description', HIDDEN));
    // Subfields are not entries: they follow their field (S-1).
    expect(effective.items.map((i) => i.fieldKey)).not.toContain('link');
  });

  it('a timeline that has not started resolves to the latest version, provisionally', async () => {
    const w = scenario();
    const effective = await w.service.effectiveFor(1, 2, 'policy_change');

    expect(effective.version).toBe(2);
    expect(effective.provisional).toBe(true);
    expect(effective.items).toEqual([
      item('policy_change', 'general.title', VIEW_ONLY),
    ]);
  });

  it('answers an explicit "type not in this timeline" error: C covers only knowledge_product', async () => {
    const w = scenario();
    const error = await w.service
      .effectiveFor(1, 3, 'policy_change')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(FieldConfigTypeNotInTimelineError);
    expect(error).toMatchObject({
      timelineId: 3,
      resultTypeKey: 'policy_change',
    });
  });

  it('a timeline for every type covers any type', async () => {
    const w = scenario();
    addTimeline(w, { id: 4, name: 'Everything', opensOn: '2026-11-09' });
    const effective = await w.service.effectiveFor(1, 4, 'policy_change');
    expect(effective.version).toBe(2);
  });

  it('a started timeline with no counting version, and a not-started one with no version at all, answer the no-version error', async () => {
    const started = world();
    // Published on the opening day: it does not reach the timeline (S-5).
    addVersion(started, 1, '2026-10-05T09:00:00Z', []);
    addTimeline(started, { id: 1, name: 'T', opensOn: '2026-10-05' });
    await expect(
      started.service.effectiveFor(1, 1, 'policy_change'),
    ).rejects.toMatchObject({
      name: 'FieldConfigNoVersionError',
      timelineId: 1,
    });

    const none = world();
    addTimeline(none, { id: 1, name: 'T', opensOn: '2026-11-02' });
    await expect(
      none.service.effectiveFor(1, 1, 'policy_change'),
    ).rejects.toBeInstanceOf(FieldConfigNoVersionError);
  });

  it('an unknown timeline, or one of another cycle, is not found', async () => {
    const w = scenario();
    addTimeline(w, {
      id: 9,
      name: 'Other cycle',
      opensOn: '2026-11-02',
      cycleId: 2,
    });

    await expect(
      w.service.effectiveFor(1, 99, 'policy_change'),
    ).rejects.toBeInstanceOf(TimelineNotFoundError);
    await expect(
      w.service.effectiveFor(1, 9, 'policy_change'),
    ).rejects.toBeInstanceOf(TimelineNotFoundError);
  });

  it('runs the same number of statements for 1 and for 50 timelines, with no catalog call (NFR-5, DD-2)', async () => {
    const count = async (extra: number) => {
      const w = scenario();
      for (let id = 100; id < 100 + extra; id++) {
        addTimeline(w, { id, name: `T${id}`, opensOn: '2026-11-09' });
      }
      w.db.statementLog.length = 0;
      await w.service.effectiveFor(1, 1, 'policy_change');
      return {
        statements: w.db.statementLog.length,
        catalogReads: w.forYear.mock.calls.length,
      };
    };

    // 3 timeline reads, the versions, the resolved version's items.
    expect(await count(0)).toEqual({ statements: 5, catalogReads: 0 });
    expect(await count(47)).toEqual({ statements: 5, catalogReads: 0 });
  });

  it('answers on a closed cycle too', async () => {
    const w = world();
    addVersion(
      w,
      1,
      '2026-01-01T09:00:00Z',
      [item('policy_change', 'general.title', ASSESSED)],
      3,
    );
    addTimeline(w, {
      id: 1,
      name: 'Old',
      opensOn: '2026-03-01',
      closesOn: '2026-04-01',
      cycleId: 3,
    });
    const effective = await w.service.effectiveFor(3, 1, 'policy_change');
    expect(effective.version).toBe(1);
  });
});
