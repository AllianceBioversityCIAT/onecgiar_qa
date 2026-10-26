// @akili-spec admin-config/field-configuration
import { readFileSync } from 'node:fs';
import { HttpException, Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  InMemoryFieldConfigDatabase,
  InMemoryFieldConfigUnitOfWork,
} from '../../../test/support/in-memory-field-config.js';
import { FakeClock } from '../../../test/support/in-memory-idempotency.js';
import type { Reservation } from '../../common/idempotency/idempotency.store.js';
import type { AdminConfigContext } from '../admin-config.context.js';
import type { DraftEditItem } from './field-config-rules.js';
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
import type { FieldConfigStore } from './field-config.store.js';
import type { FieldConfigUnitOfWork } from './field-config.unit-of-work.js';

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
  /** Wraps the in-memory unit of work, to override one store method inside a transaction. */
  wrapUow?: (base: InMemoryFieldConfigUnitOfWork) => FieldConfigUnitOfWork;
}

function world(options: WorldOptions = {}) {
  const db = new InMemoryFieldConfigDatabase();
  const catalog = shapeCatalog(options.raw ?? RAW_CATALOG());
  const forYear = vi.fn(
    options.forYear ?? (async (): Promise<unknown> => catalog),
  );
  let now = options.now ?? NOW;
  let clockReads = 0;
  const uow = new InMemoryFieldConfigUnitOfWork(db);
  const service = new FieldConfigService(
    db.store,
    { forYear } as never,
    () => {
      clockReads++;
      return now;
    },
    options.wrapUow?.(uow) ?? uow,
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
    uow,
    clockReads: () => clockReads,
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

// --- write flows (field-configuration T-7) ----------------------------------
// Expected values are the FR-4, FR-5, FR-6, FR-8, FR-11, FR-12, FR-13 scenarios,
// S-14 and design 6 (answer order), 7.2 and 7.3 written out as literals. Every
// refusal case ends with a no-write assertion (`expectNothingWritten` or
// `expectRolledBack`): draft, draft items, versions, version items, audit rows,
// the key rows and the revision are the snapshot taken before the request.

const CTX: AdminConfigContext = { actorId: 9, requestId: 'req-1' };
const OTHER_ADMIN: AdminConfigContext = { actorId: 10, requestId: 'req-2' };

const snapshot = (w: World) =>
  structuredClone({
    drafts: w.db.drafts,
    draftItems: w.db.draftItems,
    versions: w.db.versions,
    versionItems: w.db.versionItems,
    audit: w.db.auditEvents,
    idempotency: w.db.base.idempotency,
  });

/** A refusal before any transaction: nothing changed, no write ran, nothing committed. */
function expectNothingWritten(w: World, before: ReturnType<typeof snapshot>) {
  expect(snapshot(w)).toEqual(before);
  expect(w.db.writeLog).toEqual([]);
  expect(w.uow.begun).toBe(0);
  expect(w.uow.committed).toBe(0);
}

/** A refusal inside the transaction: it rolled back, so the committed rows are the snapshot. */
function expectRolledBack(w: World, before: ReturnType<typeof snapshot>) {
  expect(snapshot(w)).toEqual(before);
  expect(w.uow.committed).toBe(0);
  expect(w.uow.rolledBack).toBe(1);
}

async function refusal(run: Promise<unknown>) {
  try {
    await run;
    return { resolved: true };
  } catch (error) {
    if (!(error instanceof HttpException)) {
      return { thrown: error instanceof Error ? error.message : String(error) };
    }
    const body = error.getResponse() as {
      code?: string;
      fields?: Array<{ field: string; code: string }>;
    };
    return {
      status: error.getStatus(),
      code: body.code,
      ...(body.fields === undefined
        ? {}
        : { fields: body.fields.map(({ field, code }) => ({ field, code })) }),
    };
  }
}

const driverError = (code: string, errno: number) =>
  Object.assign(new Error(`driver ${errno}`), { code, errno });

/** Wraps the in-memory unit of work: inside each transaction the store answers `overrides(real)` where it names a method. */
const overriding =
  (overrides: (real: FieldConfigStore) => Partial<FieldConfigStore>) =>
  (base: InMemoryFieldConfigUnitOfWork): FieldConfigUnitOfWork => ({
    run: (work) =>
      base.run((repositories) => {
        const own = overrides(repositories.fieldConfig);
        const fieldConfig = new Proxy(repositories.fieldConfig, {
          get(target, property) {
            if (Object.hasOwn(own, property)) return Reflect.get(own, property);
            const value: unknown = Reflect.get(target, property);
            return typeof value === 'function'
              ? (value as (...args: unknown[]) => unknown).bind(target)
              : value;
          },
        });
        return work({ ...repositories, fieldConfig });
      }),
  });

const BAD_ITEMS: DraftEditItem[] = [
  { resultTypeKey: 'nope', fieldKey: 'general.title', visibility: 'hidden' },
  {
    resultTypeKey: 'innovation_package',
    fieldKey: 'general.primary_program',
    visibility: 'assessed',
  },
  {
    resultTypeKey: 'policy_change',
    fieldKey: 'general.title',
    visibility: 'view_only',
    isCore: true,
  },
];

/** Every cycle gets one version and a draft at revision 2, so each refusal has something it must leave alone. */
function seedAllCycles(w: World) {
  for (const cycleId of [1, 2, 3]) {
    addVersion(
      w,
      1,
      '2026-01-01T09:00:00Z',
      [item('policy_change', 'general.title', VIEW_ONLY)],
      cycleId,
    );
    addDraft(w, 2, [item('policy_change', 'general.title', ASSESSED)], cycleId);
  }
}

const flows = [
  [
    'edit',
    (w: World, cycleId: number) =>
      w.service.updateDraft(CTX, cycleId, BAD_ITEMS),
  ],
  [
    'discard',
    (w: World, cycleId: number) => w.service.discardDraft(CTX, cycleId),
  ],
  // Revision 5 is not the draft's 2: the request would also be stale.
  [
    'publish',
    (w: World, cycleId: number) => w.service.publish(CTX, cycleId, 5),
  ],
] as const;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('write flows: the answer order of design 6, one case per step', () => {
  for (const [name, run] of flows) {
    it(`${name}: an unknown cycle is 404 before the catalog is read, with a request that also breaks every later step`, async () => {
      const w = world({
        forYear: async () => {
          throw new UpstreamUnavailableError();
        },
      });
      seedAllCycles(w);
      const before = snapshot(w);

      expect(await refusal(run(w, 99))).toEqual({
        status: 404,
        code: 'CYCLES_NOT_FOUND',
      });
      expect(w.forYear).not.toHaveBeenCalled();
      expectNothingWritten(w, before);
    });

    it(`${name}: a closed cycle is 409 CYCLES_CLOSED before the catalog is read`, async () => {
      const w = world({
        forYear: async (year) => {
          throw new FieldConfigCatalogMissingError(year);
        },
      });
      seedAllCycles(w);
      const before = snapshot(w);

      expect(await refusal(run(w, 3))).toEqual({
        status: 409,
        code: 'CYCLES_CLOSED',
      });
      expect(w.forYear).not.toHaveBeenCalled();
      expectNothingWritten(w, before);
    });

    it(`${name}: a catalog Reporting does not have is 409 FIELD_CONFIG_CATALOG_MISSING, before the rules and the revision`, async () => {
      const w = world({
        forYear: async (year) => {
          throw new FieldConfigCatalogMissingError(year);
        },
      });
      seedAllCycles(w);
      const before = snapshot(w);

      expect(await refusal(run(w, 2))).toEqual({
        status: 409,
        code: 'FIELD_CONFIG_CATALOG_MISSING',
      });
      expectNothingWritten(w, before);
    });

    it(`${name}: Reporting down is 503, before the rules and the revision`, async () => {
      const w = world({
        forYear: async () => {
          throw new UpstreamUnavailableError();
        },
      });
      seedAllCycles(w);
      const before = snapshot(w);

      expect(await refusal(run(w, 1))).toEqual({
        status: 503,
        code: 'SERVICE_UNAVAILABLE',
      });
      expectNothingWritten(w, before);
    });
  }

  it('edit: every rule problem is one 400 with its item path and a catalog code, never only the first (FR-4, FR-5)', async () => {
    const w = world();
    seedAllCycles(w);
    const before = snapshot(w);

    expect(await refusal(w.service.updateDraft(CTX, 1, BAD_ITEMS))).toEqual({
      status: 400,
      code: 'VALIDATION_FAILED',
      fields: [
        { field: 'items[0].resultTypeKey', code: 'INVALID' },
        { field: 'items[1].fieldKey', code: 'INVALID' },
        { field: 'items[2].isCore', code: 'NOT_ASSESSED' },
      ],
    });
    expectNothingWritten(w, before);
  });

  it('edit: a request equal to the stored draft that is also invalid is still the 400, not a no-op 200', async () => {
    const w = world();
    addDraft(w, 4, [item('policy_change', 'general.title', VIEW_ONLY)]);
    const before = snapshot(w);

    const run = w.service.updateDraft(CTX, 1, [
      {
        resultTypeKey: 'policy_change',
        fieldKey: 'general.title',
        visibility: 'view_only',
      },
      {
        resultTypeKey: 'policy_change',
        fieldKey: 'general.title',
        visibility: 'view_only',
      },
    ]);

    expect(await refusal(run)).toEqual({
      status: 400,
      code: 'VALIDATION_FAILED',
      fields: [{ field: 'items[1].fieldKey', code: 'INVALID' }],
    });
    expectNothingWritten(w, before);
  });

  it('publish: a stale revision is 409 stale BEFORE "nothing to publish", with a draft equal to the latest version', async () => {
    const w = world();
    addVersion(w, 1, '2026-01-01T09:00:00Z', [
      item('policy_change', 'general.title', ASSESSED),
    ]);
    addDraft(w, 10, [item('policy_change', 'general.title', ASSESSED)]);
    const before = snapshot(w);

    expect(await refusal(w.service.publish(CTX, 1, 9))).toEqual({
      status: 409,
      code: 'FIELD_CONFIG_REVISION_STALE',
    });
    expectNothingWritten(w, before);
  });

  it('publish: the draft equal to the latest version is 409 FIELD_CONFIG_NOTHING_TO_PUBLISH, an unclassified field reading as hidden on both sides (S-9)', async () => {
    const w = world();
    addVersion(w, 1, '2026-01-01T09:00:00Z', [
      item('policy_change', 'general.title', ASSESSED),
    ]);
    addDraft(w, 5, [
      item('policy_change', 'general.title', ASSESSED),
      item('policy_change', 'general.result_level', HIDDEN),
    ]);
    const before = snapshot(w);

    expect(await refusal(w.service.publish(CTX, 1, 5))).toEqual({
      status: 409,
      code: 'FIELD_CONFIG_NOTHING_TO_PUBLISH',
    });
    expectNothingWritten(w, before);
  });

  it('publish: a cycle never edited reads as an empty draft at revision 0, so revision 0 is "nothing to publish", never stale (DD-10)', async () => {
    const w = world();
    const before = snapshot(w);

    expect(await refusal(w.service.publish(CTX, 1, 0))).toEqual({
      status: 409,
      code: 'FIELD_CONFIG_NOTHING_TO_PUBLISH',
    });
    expectNothingWritten(w, before);
    expect(w.db.drafts).toEqual([]);

    // Any other revision of a draft that does not exist is stale.
    expect(await refusal(w.service.publish(CTX, 1, 3))).toEqual({
      status: 409,
      code: 'FIELD_CONFIG_REVISION_STALE',
    });
    expectNothingWritten(w, before);
  });

  it('the cycle closing between the first read and the lock is 409 CYCLES_CLOSED from the transaction, with nothing written', async () => {
    const closing = (base: InMemoryFieldConfigUnitOfWork) => ({
      run: <T>(work: Parameters<typeof base.run<T>>[0]) => {
        w.db.world.cycles[0]!.status = 'closed';
        return base.run(work);
      },
    });
    const w = world({ wrapUow: closing });
    addVersion(w, 1, '2026-01-01T09:00:00Z', [
      item('policy_change', 'general.title', VIEW_ONLY),
    ]);
    addDraft(w, 3, [item('policy_change', 'general.title', ASSESSED)]);
    const before = snapshot(w);

    const edit = [
      {
        resultTypeKey: 'policy_change',
        fieldKey: 'general.title',
        visibility: 'hidden' as const,
      },
    ];
    expect(await refusal(w.service.updateDraft(CTX, 1, edit))).toEqual({
      status: 409,
      code: 'CYCLES_CLOSED',
    });
    expectRolledBack(w, before);
    expect(w.db.writeLog).toEqual([]);
  });
});

describe('FieldConfigService.updateDraft (FR-4, FR-5, FR-12, S-10, S-14)', () => {
  const edit = (
    fieldKey: string,
    visibility: 'hidden' | 'view_only' | 'assessed',
    flags: { isCore?: boolean; isAiInput?: boolean } = {},
    resultTypeKey = 'policy_change',
  ): DraftEditItem => ({ resultTypeKey, fieldKey, visibility, ...flags });

  it('stores three items, raises revision 7 to 8, keeps the items not sent and stamps the writer and the clock', async () => {
    const w = world();
    addDraft(w, 7, [
      item('policy_change', 'general.description', VIEW_ONLY),
      item('knowledge_product', 'general.title', VIEW_ONLY),
    ]);

    const view = await w.service.updateDraft(CTX, 1, [
      edit('general.title', 'assessed', { isCore: true, isAiInput: false }),
      edit('general.result_level', 'view_only'),
      edit('general.description', 'assessed', { isAiInput: true }),
    ]);

    expect(w.db.draftItems).toEqual([
      {
        cycleId: 1,
        ...item('policy_change', 'general.description', {
          visibility: 'assessed',
          isCore: false,
          isAiInput: true,
        }),
      },
      { cycleId: 1, ...item('knowledge_product', 'general.title', VIEW_ONLY) },
      { cycleId: 1, ...item('policy_change', 'general.title', ASSESSED) },
      {
        cycleId: 1,
        ...item('policy_change', 'general.result_level', VIEW_ONLY),
      },
    ]);
    expect(w.db.drafts).toEqual([
      { cycleId: 1, revision: 8, updatedAt: NOW, updatedBy: 9 },
    ]);
    expect(view.revision).toBe(8);
    const title = fieldsOf(view, 'policy_change').find(
      (f) => f.key === 'general.title',
    )!;
    expect(title.draft).toEqual(ASSESSED);
    expect(title.unclassified).toBe(false);
    expect([w.uow.begun, w.uow.committed, w.uow.rolledBack]).toEqual([1, 1, 0]);
  });

  it('runs the statements of design 7.2 in order: unlocked reads, the cycle share lock, the draft row created and locked, one upsert, one bump', async () => {
    const w = world();
    await w.service.updateDraft(CTX, 1, [edit('general.title', 'view_only')]);

    expect(w.db.statementLog.slice(0, 7)).toEqual([
      'cycle:1',
      'draft-items:1',
      'cycle:share:1',
      'draft:ensure:1',
      'draft:lock:1',
      'draft-items:upsert:1',
      'draft:bump:1',
    ]);
  });

  it('creates the draft row on the first write: a cycle with none goes from revision 0 to 1 (DD-10)', async () => {
    const w = world();

    const view = await w.service.updateDraft(CTX, 2, [
      edit('general.title', 'view_only'),
    ]);

    expect(w.db.drafts).toEqual([
      { cycleId: 2, revision: 1, updatedAt: NOW, updatedBy: 9 },
    ]);
    expect(view.revision).toBe(1);
    expect(view.year).toBe(2027);
  });

  it('switching off: hidden with the flags omitted over a stored assessed core + AI item is stored hidden with both flags false (FR-4)', async () => {
    const w = world();
    addDraft(w, 3, [
      item('policy_change', 'general.title', {
        visibility: 'assessed',
        isCore: true,
        isAiInput: true,
      }),
    ]);

    await w.service.updateDraft(CTX, 1, [edit('general.title', 'hidden')]);

    expect(w.db.draftItems).toEqual([
      { cycleId: 1, ...item('policy_change', 'general.title', HIDDEN) },
    ]);
    expect(w.db.drafts[0]!.revision).toBe(4);
  });

  it('an omitted flag is false also on an assessed item: assessed with no flags over a stored core item is a CHANGE, not a no-op (S-14)', async () => {
    const w = world();
    addDraft(w, 3, [item('policy_change', 'general.title', ASSESSED)]);

    const view = await w.service.updateDraft(CTX, 1, [
      edit('general.title', 'assessed'),
    ]);

    expect(w.db.draftItems).toEqual([
      {
        cycleId: 1,
        ...item('policy_change', 'general.title', {
          visibility: 'assessed',
          isCore: false,
          isAiInput: false,
        }),
      },
    ]);
    expect(w.db.drafts[0]!.revision).toBe(4);
    expect(view.revision).toBe(4);
  });

  it('same values: items equal to the stored draft answer 200 with no write and no revision change, flags omitted or explicit (FR-5)', async () => {
    const w = world();
    addDraft(w, 7, [
      item('policy_change', 'general.title', {
        visibility: 'assessed',
        isCore: false,
        isAiInput: false,
      }),
      item('policy_change', 'general.result_level', VIEW_ONLY),
    ]);
    const before = snapshot(w);

    const view = await w.service.updateDraft(CTX, 1, [
      edit('general.title', 'assessed'),
      edit('general.result_level', 'view_only', {
        isCore: false,
        isAiInput: false,
      }),
    ]);

    expect(view.revision).toBe(7);
    expect(snapshot(w)).toEqual(before);
    expect(w.db.writeLog).toEqual([]);
    expect(w.uow.begun).toBe(0);
    expect(w.db.statementLog.some((s) => s.startsWith('cycle:share'))).toBe(
      false,
    );
  });

  it('an item for a field with no stored row is a write even when it says hidden: the field stops being unclassified', async () => {
    const w = world();
    addDraft(w, 7, [item('policy_change', 'general.title', VIEW_ONLY)]);

    const view = await w.service.updateDraft(CTX, 1, [
      edit('general.result_level', 'hidden'),
    ]);

    expect(view.revision).toBe(8);
    const field = fieldsOf(view, 'policy_change').find(
      (f) => f.key === 'general.result_level',
    )!;
    expect(field.unclassified).toBe(false);
  });

  it('two admins edit the same field one after the other: the later value is stored and the revision moves on each write (FR-5, S-10)', async () => {
    const w = world();

    await w.service.updateDraft(CTX, 1, [
      edit('general.title', 'assessed', { isCore: true }),
    ]);
    expect(w.db.drafts[0]).toMatchObject({ revision: 1, updatedBy: 9 });

    const view = await w.service.updateDraft(OTHER_ADMIN, 1, [
      edit('general.title', 'view_only'),
    ]);

    expect(w.db.draftItems).toEqual([
      { cycleId: 1, ...item('policy_change', 'general.title', VIEW_ONLY) },
    ]);
    expect(w.db.drafts).toEqual([
      { cycleId: 1, revision: 2, updatedAt: NOW, updatedBy: 10 },
    ]);
    expect(view.revision).toBe(2);
  });

  it('two edits at the same time both land and the revision counts both (the draft row lock serialises them)', async () => {
    const w = world();
    addDraft(w, 0, []);

    await Promise.all([
      w.service.updateDraft(CTX, 1, [edit('general.title', 'view_only')]),
      w.service.updateDraft(OTHER_ADMIN, 1, [
        edit('general.result_level', 'view_only'),
      ]),
    ]);

    expect(w.db.drafts[0]!.revision).toBe(2);
    expect(w.db.draftItems).toHaveLength(2);
    expect([w.uow.committed, w.uow.rolledBack]).toEqual([2, 0]);
  });

  it('a later draft edit leaves version 2 unchanged: rows, instant, publisher (FR-12)', async () => {
    const w = world();
    addVersion(w, 1, '2026-01-01T09:00:00Z', [
      item('policy_change', 'general.title', VIEW_ONLY),
    ]);
    addVersion(w, 2, '2026-02-01T09:00:00Z', [
      item('policy_change', 'general.title', ASSESSED),
    ]);
    const versions = structuredClone(w.db.versions);
    const versionItems = structuredClone(w.db.versionItems);

    await w.service.updateDraft(CTX, 1, [edit('general.title', 'hidden')]);

    expect(w.db.versions).toEqual(versions);
    expect(w.db.versionItems).toEqual(versionItems);
    expect(w.db.auditEvents).toEqual([]);
  });

  it('a 0-row revision bump is an internal error, never a 409 stale: a draft edit always wins; it rolls back', async () => {
    const w = world({
      wrapUow: overriding(() => ({
        bumpRevision: async () => ({ kind: 'stale' }),
      })),
    });
    addDraft(w, 3, [item('policy_change', 'general.title', VIEW_ONLY)]);
    const before = snapshot(w);

    const result = await refusal(
      w.service.updateDraft(CTX, 1, [edit('general.title', 'assessed')]),
    );

    expect(result).not.toHaveProperty('status');
    expect(result).toHaveProperty('thrown');
    expectRolledBack(w, before);
  });

  it('a deadlock (1213) or a lock wait timeout (1205), also wrapped by the query builder, is 503 SERVICE_UNAVAILABLE, rethrown once and not retried', async () => {
    for (const [code, errno, wrapped] of [
      ['ER_LOCK_DEADLOCK', 1213, false],
      ['ER_LOCK_WAIT_TIMEOUT', 1205, false],
      ['ER_LOCK_DEADLOCK', 1213, true],
    ] as const) {
      const upsert = vi.fn(async () => {
        const driver = driverError(code, errno);
        throw wrapped ? new Error('Failed query', { cause: driver }) : driver;
      });
      const w = world({
        wrapUow: overriding(() => ({ upsertDraftItems: upsert })),
      });
      addDraft(w, 3, []);
      const before = snapshot(w);

      expect(
        await refusal(
          w.service.updateDraft(CTX, 1, [edit('general.title', 'view_only')]),
        ),
      ).toEqual({ status: 503, code: 'SERVICE_UNAVAILABLE' });
      expect(upsert).toHaveBeenCalledTimes(1);
      expect(w.uow.begun).toBe(1);
      expectRolledBack(w, before);
    }
  });

  it('any other database error stays an unmapped error: a 1062 on another key is not "busy"', async () => {
    const w = world({
      wrapUow: overriding(() => ({
        upsertDraftItems: async () => {
          throw driverError('ER_DUP_ENTRY', 1062);
        },
      })),
    });
    addDraft(w, 3, []);
    const before = snapshot(w);

    const result = await refusal(
      w.service.updateDraft(CTX, 1, [edit('general.title', 'view_only')]),
    );

    expect(result).toEqual({ thrown: 'driver 1062' });
    expectRolledBack(w, before);
  });
});

describe('FieldConfigService.discardDraft (FR-6, FR-12)', () => {
  const seedThreeVersions = (w: World) => {
    addVersion(w, 1, '2026-01-01T09:00:00Z', [
      item('policy_change', 'general.title', VIEW_ONLY),
    ]);
    addVersion(w, 2, '2026-02-01T09:00:00Z', [
      item('policy_change', 'general.title', ASSESSED),
      item('policy_change', 'general.description', VIEW_ONLY),
    ]);
    addVersion(w, 3, '2026-03-01T09:00:00Z', [
      item('policy_change', 'general.title', VIEW_ONLY),
      item('policy_change', 'general.result_level', ASSESSED),
      item('knowledge_product', 'general.title', HIDDEN),
    ]);
  };

  it("discard to version 3: the draft items become version 3's option sets, the revision moves, the version rows stay (FR-6, FR-12)", async () => {
    const w = world();
    seedThreeVersions(w);
    addDraft(w, 5, [
      item('policy_change', 'general.title', ASSESSED),
      item('policy_change', 'general.description', ASSESSED),
      item('capacity_sharing', 'general.title', VIEW_ONLY),
    ]);
    const versions = structuredClone(w.db.versions);
    const versionItems = structuredClone(w.db.versionItems);

    const view = await w.service.discardDraft(OTHER_ADMIN, 1);

    expect(w.db.draftItems.map(({ cycleId: _cycle, ...row }) => row)).toEqual([
      item('policy_change', 'general.title', VIEW_ONLY),
      item('policy_change', 'general.result_level', ASSESSED),
      item('knowledge_product', 'general.title', HIDDEN),
    ]);
    // `change` passes: a discard is a draft write (design 7.2 step 4).
    expect(w.db.drafts).toEqual([
      { cycleId: 1, revision: 6, updatedAt: NOW, updatedBy: 10 },
    ]);
    expect(view.revision).toBe(6);
    expect(
      fieldsOf(view, 'policy_change').find(
        (f) => f.key === 'general.result_level',
      )!.draft,
    ).toEqual(ASSESSED);
    expect(w.db.versions).toEqual(versions);
    expect(w.db.versionItems).toEqual(versionItems);
    expect(w.db.auditEvents).toEqual([]);
  });

  it('discard to empty: with no version the draft items are gone, every field unclassified, and the revision still moves', async () => {
    const w = world();
    addDraft(w, 4, [item('policy_change', 'general.title', ASSESSED)]);

    const view = await w.service.discardDraft(CTX, 1);

    expect(w.db.draftItems).toEqual([]);
    expect(w.db.drafts).toEqual([
      { cycleId: 1, revision: 5, updatedAt: NOW, updatedBy: 9 },
    ]);
    expect(view.revision).toBe(5);
    expect(
      view.resultTypes.every((type) =>
        type.sections.every((s) => s.fields.every((f) => f.unclassified)),
      ),
    ).toBe(true);
  });

  it('a cycle never edited creates the draft row on its first discard: revision 0 to 1, empty', async () => {
    const w = world();

    const view = await w.service.discardDraft(CTX, 2);

    expect(w.db.drafts).toEqual([
      { cycleId: 2, revision: 1, updatedAt: NOW, updatedBy: 9 },
    ]);
    expect(view.revision).toBe(1);
  });

  it('deletes the draft items before it copies the version, on the statements of design 7.2: copying first would hit the primary key', async () => {
    const w = world();
    seedThreeVersions(w);
    addDraft(w, 5, [item('policy_change', 'general.title', ASSESSED)]);

    await w.service.discardDraft(CTX, 1);

    expect(w.db.statementLog.slice(0, 8)).toEqual([
      'cycle:1',
      'cycle:share:1',
      'draft:ensure:1',
      'draft:lock:1',
      'version:latest:1',
      'draft-items:delete:1',
      'draft-items:copy:1',
      'draft:bump:1',
    ]);
  });

  it('a 0-row revision bump is an internal error, never a 409 stale, and rolls the delete and the copy back', async () => {
    const w = world({
      wrapUow: overriding(() => ({
        bumpRevision: async () => ({ kind: 'stale' }),
      })),
    });
    seedThreeVersions(w);
    addDraft(w, 5, [item('policy_change', 'general.title', ASSESSED)]);
    const before = snapshot(w);

    const result = await refusal(w.service.discardDraft(CTX, 1));

    expect(result).not.toHaveProperty('status');
    expect(result).toHaveProperty('thrown');
    expectRolledBack(w, before);
  });
});

describe('FieldConfigService.publish (FR-8, FR-11, FR-12, NFR-3, DD-6, DD-7)', () => {
  /** Version 2 and draft revision 9: the draft changes `policy_change.general.title` and adds `general.result_level`; A started, B not started, C another type, D finished. */
  function publishable(options: WorldOptions = {}) {
    const w = world(options);
    addVersion(w, 1, '2026-08-01T09:00:00Z', [
      item('policy_change', 'general.title', VIEW_ONLY),
    ]);
    addVersion(w, 2, '2026-09-20T09:00:00Z', [
      item('policy_change', 'general.title', VIEW_ONLY),
      item('knowledge_product', 'general.title', ASSESSED),
    ]);
    addDraft(w, 9, [
      item('policy_change', 'general.title', ASSESSED),
      item('knowledge_product', 'general.title', ASSESSED),
      item('policy_change', 'general.result_level', VIEW_ONLY),
    ]);
    addTimeline(w, { id: 1, name: 'A', opensOn: '2026-10-01' });
    addTimeline(w, {
      id: 2,
      name: 'B',
      opensOn: '2026-11-01',
      types: ['policy_change'],
    });
    addTimeline(w, {
      id: 3,
      name: 'C',
      opensOn: '2026-11-01',
      types: ['capacity_sharing'],
    });
    addTimeline(w, {
      id: 4,
      name: 'D',
      opensOn: '2026-05-01',
      closesOn: '2026-06-01',
    });
    return w;
  }

  const reserve = async (w: World) => {
    const outcome = await w.db.base
      .idempotencyStore(new FakeClock().now)
      .reserve({
        actorId: 9,
        key: 'k-1',
        fingerprint: 'f'.repeat(64),
        routeStatus: 201,
      });
    if (outcome.kind !== 'reserved') throw new Error(outcome.kind);
    return outcome.reservation;
  };

  it('writes version 3 with the publish instant, publisher and catalog version, every applicable field (504 rows, unclassified as hidden), one audit row and the key mark, in one transaction', async () => {
    const w = publishable();
    const reservation: Reservation = await reserve(w);
    const versions = structuredClone(w.db.versions);
    const versionItems = structuredClone(w.db.versionItems);

    const answer = await w.service.publish(
      {
        ...CTX,
        idempotency: { reservation, outcome: 'none' },
      },
      1,
      9,
    );

    expect(answer).toEqual({
      version: {
        number: 3,
        publishedAt: NOW,
        catalogVersion: '2026.30',
      },
      timelines: {
        receive: [{ id: 2, name: 'B', opensOn: '2026-11-01' }],
        keep: [{ id: 1, name: 'A', opensOn: '2026-10-01', version: 2 }],
      },
    });
    expect(w.db.versions.find((v) => v.number === 3)).toEqual({
      id: 3,
      cycleId: 1,
      number: 3,
      catalogVersion: '2026.30',
      publishedAt: NOW,
      publishedBy: 9,
      requestId: 'req-1',
    });
    const rows = w.db.versionItems.filter((i) => i.versionId === 3);
    expect(rows).toHaveLength(504);
    expect(rows.filter((i) => i.visibility !== 'hidden')).toHaveLength(3);
    expect(
      rows.find(
        (i) =>
          i.resultTypeKey === 'policy_change' && i.fieldKey === 'general.title',
      ),
    ).toMatchObject({ visibility: 'assessed', isCore: true });
    expect(
      rows.find(
        (i) =>
          i.resultTypeKey === 'capacity_sharing' &&
          i.fieldKey === 'general.title',
      ),
    ).toMatchObject({ visibility: 'hidden', isCore: false, isAiInput: false });
    // One audit row: only the two CHANGED items, and the lists as computed before the transaction.
    expect(w.db.auditEvents).toEqual([
      {
        id: 1,
        cycleId: 1,
        versionId: 3,
        actorId: 9,
        action: 'publish',
        changes: {
          'policy_change.general.title': {
            before: VIEW_ONLY,
            after: ASSESSED,
          },
          'policy_change.general.result_level': {
            before: null,
            after: VIEW_ONLY,
          },
        },
        timelines: { receive: [2], keep: [{ id: 1, version: 2 }] },
        requestId: 'req-1',
        createdAt: NOW,
      },
    ]);
    // The revision moves; `updated_*` stay as the last draft write set them (design 7.3).
    expect(w.db.drafts).toEqual([
      { cycleId: 1, revision: 10, updatedAt: CREATED, updatedBy: 1 },
    ]);
    expect(w.db.base.idempotency[0]).toMatchObject({
      state: 'executed',
      targetUserId: 3,
    });
    // FR-12: versions 1 and 2 are exactly what they were.
    expect(w.db.versions.slice(0, 2)).toEqual(versions);
    expect(w.db.versionItems.slice(0, versionItems.length)).toEqual(
      versionItems,
    );
    expect([w.uow.begun, w.uow.committed, w.uow.rolledBack]).toEqual([1, 1, 0]);
  });

  it('without a key it marks nothing; a field the catalog no longer lists is left out of the version and of the audit (S-7, DD-12)', async () => {
    const w = publishable();
    w.db.draftItems.push({
      cycleId: 1,
      ...item('policy_change', 'retired.field', ASSESSED),
    });

    await w.service.publish(CTX, 1, 9);

    const rows = w.db.versionItems.filter((i) => i.versionId === 3);
    expect(rows).toHaveLength(504);
    expect(rows.some((i) => i.fieldKey === 'retired.field')).toBe(false);
    expect(Object.keys(w.db.auditEvents[0]!.changes).sort()).toEqual([
      'policy_change.general.result_level',
      'policy_change.general.title',
    ]);
    expect(w.db.base.idempotency).toEqual([]);
  });

  it('the first publication with no version records before as null and keeps nothing for a not-started timeline', async () => {
    const w = world();
    addDraft(w, 1, [item('knowledge_product', 'general.title', VIEW_ONLY)]);
    addTimeline(w, { id: 1, name: 'B', opensOn: '2026-11-01' });

    const answer = await w.service.publish(CTX, 1, 1);

    expect(answer.version.number).toBe(1);
    expect(w.db.auditEvents[0]).toMatchObject({
      changes: {
        'knowledge_product.general.title': { before: null, after: VIEW_ONLY },
      },
      timelines: { receive: [1], keep: [] },
    });
  });

  it('a started timeline that resolves to no version is kept with version null in the answer and the audit row, as the preview shows it', async () => {
    const w = world();
    addDraft(w, 1, [item('knowledge_product', 'general.title', VIEW_ONLY)]);
    addTimeline(w, { id: 1, name: 'Started', opensOn: '2026-10-01' });

    const answer = await w.service.publish(CTX, 1, 1);

    expect(answer.timelines.keep).toEqual([
      { id: 1, name: 'Started', opensOn: '2026-10-01', version: null },
    ]);
    expect(w.db.auditEvents[0]!.timelines).toEqual({
      receive: [],
      keep: [{ id: 1, version: null }],
    });
  });

  it('a stale revision is refused BEFORE the transaction opens: nothing written and the key left in progress', async () => {
    const w = publishable();
    const reservation = await reserve(w);
    const before = snapshot(w);

    expect(
      await refusal(
        w.service.publish(
          { ...CTX, idempotency: { reservation, outcome: 'none' } },
          1,
          8,
        ),
      ),
    ).toEqual({ status: 409, code: 'FIELD_CONFIG_REVISION_STALE' });
    expectNothingWritten(w, before);
    expect(w.db.base.idempotency[0]).toMatchObject({ state: 'in_progress' });
  });

  it('two admins publish revision 9 at once: exactly one version and one audit row, the other answers 409 stale from inside its transaction, with no second version', async () => {
    const w = publishable();
    const before = snapshot(w);

    const results = await Promise.allSettled([
      w.service.publish(CTX, 1, 9),
      w.service.publish(OTHER_ADMIN, 1, 9),
    ]);

    const rejected = results.filter((r) => r.status === 'rejected');
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await refusal(Promise.reject(rejected[0]!.reason))).toEqual({
      status: 409,
      code: 'FIELD_CONFIG_REVISION_STALE',
    });
    expect(w.db.versions.map((v) => v.number)).toEqual([1, 2, 3]);
    expect(w.db.versionItems.filter((i) => i.versionId === 3)).toHaveLength(
      504,
    );
    expect(w.db.auditEvents).toHaveLength(1);
    expect(w.db.drafts[0]!.revision).toBe(10);
    expect([w.uow.committed, w.uow.rolledBack]).toEqual([1, 1]);
    // The loser wrote nothing: its rows are exactly the before-state plus the winner's.
    expect(w.db.versions.slice(0, before.versions.length)).toEqual(
      before.versions,
    );
    expect(w.db.writeLog.filter((l) => l.startsWith('version:insert'))).toEqual(
      ['version:insert:1:3'],
    );
  });

  it('the conditional UPDATE alone refuses the second publisher: even when the locked read of the draft still says revision 9, no second version is written', async () => {
    const w = publishable({
      wrapUow: overriding((real) => ({
        lockDraft: async (cycleId: number) => {
          const row = await real.lockDraft(cycleId);
          return row && { ...row, revision: 9 };
        },
      })),
    });

    const results = await Promise.allSettled([
      w.service.publish(CTX, 1, 9),
      w.service.publish(OTHER_ADMIN, 1, 9),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    expect(w.db.versions.map((v) => v.number)).toEqual([1, 2, 3]);
    expect(w.db.auditEvents).toHaveLength(1);
    expect(w.db.drafts[0]!.revision).toBe(10);
  });

  it('a duplicate version number from the insert is 409 stale, not retried, and rolls the bump back', async () => {
    const insert = vi.fn();
    const w = publishable({
      wrapUow: overriding(() => ({
        insertVersion: async (...args) => {
          insert(...args);
          return { kind: 'duplicate' };
        },
      })),
    });
    const before = snapshot(w);

    expect(await refusal(w.service.publish(CTX, 1, 9))).toEqual({
      status: 409,
      code: 'FIELD_CONFIG_REVISION_STALE',
    });
    expect(insert).toHaveBeenCalledTimes(1);
    expectRolledBack(w, before);
  });

  it('a deadlock (1213) or a lock wait timeout (1205) inside the publication is 503 SERVICE_UNAVAILABLE, not retried, with nothing committed', async () => {
    for (const [code, errno] of [
      ['ER_LOCK_DEADLOCK', 1213],
      ['ER_LOCK_WAIT_TIMEOUT', 1205],
    ] as const) {
      const insertItems = vi.fn(async () => {
        throw driverError(code, errno);
      });
      const w = publishable({
        wrapUow: overriding(() => ({ insertVersionItems: insertItems })),
      });
      const before = snapshot(w);

      expect(await refusal(w.service.publish(CTX, 1, 9))).toEqual({
        status: 503,
        code: 'SERVICE_UNAVAILABLE',
      });
      expect(insertItems).toHaveBeenCalledTimes(1);
      expectRolledBack(w, before);
    }
  });

  it('a cycle that closes between the first read and the lock refuses the publication from the transaction, writing nothing', async () => {
    const w = publishable({
      wrapUow: (base) => ({
        run: (work) => {
          w.db.world.cycles[0]!.status = 'closed';
          return base.run(work);
        },
      }),
    });
    const before = snapshot(w);

    expect(await refusal(w.service.publish(CTX, 1, 9))).toEqual({
      status: 409,
      code: 'CYCLES_CLOSED',
    });
    expectRolledBack(w, before);
    expect(w.db.writeLog).toEqual([]);
  });

  it('23:59:59.6 Rome the day before a timeline opens still receives: one clock read, cut to the whole second, is both the instant the lists judge and the one stored (DD-5)', async () => {
    // 2026-10-31 is CET (UTC+1): 23:59:59.6 Rome is 22:59:59.6 UTC. A datetime
    // column would round that to 23:00:00 UTC, the opening day in Rome.
    const instant = new Date('2026-10-31T22:59:59.600Z');
    const cut = new Date('2026-10-31T22:59:59.000Z');
    const w = world({ now: instant });
    addDraft(w, 1, [item('policy_change', 'general.title', VIEW_ONLY)]);
    addTimeline(w, {
      id: 1,
      name: 'Opens next day',
      opensOn: '2026-11-01',
      types: ['policy_change'],
    });

    const answer = await w.service.publish(CTX, 1, 1);

    expect(answer.timelines.receive).toEqual([
      { id: 1, name: 'Opens next day', opensOn: '2026-11-01' },
    ]);
    expect(answer.version.publishedAt).toEqual(cut);
    expect(w.db.versions[0]!.publishedAt).toEqual(cut);
    expect(w.db.auditEvents[0]!.createdAt).toEqual(cut);
    expect(w.db.auditEvents[0]!.timelines).toEqual({ receive: [1], keep: [] });

    // On the opening day the stored instant still counts for that timeline.
    w.setNow(new Date('2026-11-01T10:00:00.000Z'));
    const effective = await w.service.effectiveFor(1, 1, 'policy_change');
    expect(effective.version).toBe(1);
    expect(effective.provisional).toBe(false);
  });
});

describe('write flows: closed cycle, clock and decision line', () => {
  it('a closed cycle refuses an edit, a discard and a publication, even for a request equal to the stored draft, writing nothing (FR-13)', async () => {
    const w = world();
    seedAllCycles(w);
    const before = snapshot(w);

    expect(
      await refusal(
        w.service.updateDraft(CTX, 3, [
          {
            resultTypeKey: 'policy_change',
            fieldKey: 'general.title',
            visibility: 'assessed',
            isCore: true,
          },
        ]),
      ),
    ).toEqual({ status: 409, code: 'CYCLES_CLOSED' });
    expect(await refusal(w.service.discardDraft(CTX, 3))).toEqual({
      status: 409,
      code: 'CYCLES_CLOSED',
    });
    expect(await refusal(w.service.publish(CTX, 3, 2))).toEqual({
      status: 409,
      code: 'CYCLES_CLOSED',
    });
    expectNothingWritten(w, before);

    // The view still answers a closed cycle.
    expect((await w.service.view(3)).revision).toBe(2);
  });

  it('reads the clock once per request in every write flow', async () => {
    const w = world();
    addVersion(w, 1, '2026-01-01T09:00:00Z', [
      item('policy_change', 'general.title', VIEW_ONLY),
    ]);

    await w.service.updateDraft(CTX, 1, [
      {
        resultTypeKey: 'policy_change',
        fieldKey: 'general.title',
        visibility: 'assessed',
      },
    ]);
    expect(w.clockReads()).toBe(1);

    await w.service.publish(CTX, 1, 1);
    expect(w.clockReads()).toBe(2);

    await w.service.discardDraft(CTX, 1);
    expect(w.clockReads()).toBe(3);
  });

  it('logs one decision line per request with ids and outcome only: ok, refused and error, no body field', async () => {
    const lines: string[] = [];
    for (const level of ['log', 'warn', 'error'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation(
        (...args: unknown[]) => {
          lines.push(String(args[0]));
        },
      );
    }
    const line = (
      action: string,
      outcome: string,
      reason?: string,
      targetId = 1,
    ) =>
      JSON.stringify({
        event: 'admin_config',
        action,
        targetId,
        actorId: 9,
        outcome,
        ...(reason === undefined ? {} : { reason }),
        requestId: 'req-1',
        idempotency: 'none',
      });
    const w = world();
    addVersion(w, 1, '2026-01-01T09:00:00Z', [
      item('policy_change', 'general.title', VIEW_ONLY),
    ]);
    addVersion(w, 1, '2026-01-01T09:00:00Z', [], 3);
    addDraft(w, 2, [], 3);
    const sent = [
      {
        resultTypeKey: 'policy_change',
        fieldKey: 'general.title',
        visibility: 'assessed' as const,
        isCore: true,
      },
    ];

    await w.service.updateDraft(CTX, 1, sent);
    expect(lines).toEqual([line('field_config_update', 'ok')]);

    lines.length = 0;
    await w.service.publish(CTX, 1, 1);
    expect(lines).toEqual([line('field_config_publish', 'ok')]);

    lines.length = 0;
    await w.service.discardDraft(CTX, 1);
    expect(lines).toEqual([line('field_config_discard', 'ok')]);

    lines.length = 0;
    await refusal(w.service.updateDraft(CTX, 3, sent));
    await refusal(w.service.discardDraft(CTX, 3));
    await refusal(w.service.publish(CTX, 1, 99));
    expect(lines).toEqual([
      line('field_config_update', 'refused', 'CYCLES_CLOSED', 3),
      line('field_config_discard', 'refused', 'CYCLES_CLOSED', 3),
      line('field_config_publish', 'refused', 'FIELD_CONFIG_REVISION_STALE'),
    ]);

    lines.length = 0;
    const broken = world({
      wrapUow: overriding(() => ({
        bumpRevision: async () => ({ kind: 'stale' }),
      })),
    });
    await refusal(broken.service.discardDraft(CTX, 1));
    expect(lines).toEqual([
      line('field_config_discard', 'error', 'internal_error'),
    ]);
    for (const text of lines) {
      expect(text).not.toContain('general.title');
      expect(text).not.toContain('visibility');
    }
  });
});
