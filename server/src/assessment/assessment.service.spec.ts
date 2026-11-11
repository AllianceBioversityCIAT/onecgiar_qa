// @akili-spec assessment/step-1-assessment
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FieldConfigCatalogMissingError } from '../admin-config/admin-config.errors.js';
import type { FieldCatalogSource } from '../admin-config/field-config/field-catalog.ports.js';
import {
  applicableFields,
  shapeCatalog,
  type FieldCatalog,
} from '../admin-config/field-config/field-config-catalog.js';
import type { ConfigItem } from '../admin-config/field-config/field-config-diff.js';
import type { FieldVisibility } from '../admin-config/field-config/field-config-rules.js';
import { AuthorizationService } from '../users/authorization.service.js';
import type { AssignmentView } from '../users/authorization.service.js';
import { CatalogService } from '../users/catalogs/catalog.service.js';
import { UpstreamUnavailableError } from '../users/catalogs/catalogs.errors.js';
import type { AuthenticatedUser } from '../users/current-user.cache.js';
import { FakeSnapshotStore } from '../../test/support/fake-snapshot-store.js';
import {
  defaultFakeSteps,
  FakeFieldConfigEffective,
  InMemoryAssessmentStore,
  InMemoryAssessmentUnitOfWork,
  InMemoryAssessmentWorld,
  InMemoryTimelineLoads,
  InMemoryWorklistStore,
  type FakeMembership,
} from '../../test/support/in-memory-assessment.js';
import { runRealLoad } from '../../test/support/real-load-writer.js';
import type { FeedLabels } from '../ingestion/results-feed.port.js';
import {
  AssessmentNoFieldConfigError,
  AssessmentNotFoundError,
} from './assessment.errors.js';
import { AssessmentService } from './assessment.service.js';

// The read use case over the in-memory world (T-9): the 404 that never tells
// "outside your scope" from "does not exist", the 409 and 503 before any
// structure, the snapshot read through the real writer's key, the hidden fields
// that never leave the service, and the statement budget (NFR-2). Expected
// values are written out; the catalog is the real 2026 fixture.

const MARCH = new Date('2026-03-10T10:00:00Z'); // step 1 (assessors) open
const APRIL = new Date('2026-04-10T10:00:00Z'); // step 1 closed

const catalog: FieldCatalog = shapeCatalog(
  JSON.parse(
    readFileSync(
      new URL(
        '../admin-config/field-config/fixtures/reporting-qa-catalog-2026.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ),
);
const applicable = applicableFields(catalog, 'policy_change').map((f) => f.key);

const PROGRAMS = [
  { id: 1, code: 'SP01', name: 'Mango' },
  { id: 2, code: 'SP02', name: 'Zebra' },
];
const RESULT_TYPES = [{ key: 'policy_change', name: 'Policy change' }];

const assignment = (
  roleCode: string,
  resultTypeKey: string | null,
): AssignmentView => ({
  roleCode,
  roleIsActive: true,
  isActive: true,
  revokedAt: null,
  resultTypeKey,
  programId: null,
});
const userOf = (
  id: number,
  assignments: AssignmentView[],
  programScope: number[] = [],
): AuthenticatedUser =>
  ({
    id,
    email: `user${id}@example.org`,
    firstName: 'First',
    lastName: 'Last',
    nickname: null,
    authSource: 'custom',
    isActive: true,
    assignments,
    programScope,
    exclusions: [],
  }) as AuthenticatedUser;
const assessorA = () =>
  userOf(10, [assignment('ASSESSOR', 'policy_change')], [1]);
const admin = () => userOf(99, [assignment('ADMIN', null)]);

function items(
  overrides: Record<string, FieldVisibility | { core: true }> = {},
  fallback: FieldVisibility = 'view_only',
): ConfigItem[] {
  return applicable.map((fieldKey) => {
    const o = overrides[fieldKey];
    const visibility: FieldVisibility =
      o === undefined ? fallback : typeof o === 'string' ? o : 'assessed';
    return {
      resultTypeKey: 'policy_change',
      fieldKey,
      visibility,
      isCore: typeof o === 'object',
      isAiInput: false,
    };
  });
}

let nextId = 1;
function setup(
  now: Date = MARCH,
  snapshots: FakeSnapshotStore = new FakeSnapshotStore(),
) {
  const world = new InMemoryAssessmentWorld();
  world.timelines.push({
    id: 1,
    name: 'Official',
    kind: 'official',
    steps: defaultFakeSteps(),
  });
  world.timelineUsers.push({ timelineId: 1, userId: 10, roleCode: 'ASSESSOR' });
  world.users.push({ id: 10, nickname: 'Ana' }, { id: 99, nickname: 'Ada' });
  world.fieldConfigItems['policy_change'] = items();
  // The version an assessment pinned is a different read: version 1 holds the same items by default.
  world.versionItems[1] = { policy_change: items() };
  const catalogs = {
    forYear: vi.fn(() => Promise.resolve(catalog)),
  } satisfies FieldCatalogSource;
  const service = new AssessmentService(
    new InMemoryAssessmentStore(world),
    new InMemoryWorklistStore(world),
    new InMemoryTimelineLoads(world),
    snapshots,
    catalogs,
    new FakeFieldConfigEffective(world),
    {
      listSciencePrograms: () => Promise.resolve(PROGRAMS),
      listResultTypes: () => Promise.resolve(RESULT_TYPES),
    } as unknown as CatalogService,
    new AuthorizationService(),
    () => now,
    new InMemoryAssessmentUnitOfWork(world),
  );
  /**
   * A membership in timeline 1 whose snapshot was written by the REAL
   * LoadRunner (one run per result, a load id of its own): the `snapshot_sk`
   * kept on the membership is the runner's key, never a hand-built one.
   */
  const add = async (
    resultCode: number,
    values: Record<string, unknown> = {
      'general.title': `Result ${resultCode}`,
    },
    extra: Partial<FakeMembership> = {},
    labels?: FeedLabels,
  ) => {
    const id = nextId++;
    const real = await runRealLoad(
      [
        {
          resultId: resultCode - 4000,
          values,
          resultTypeKey: extra.resultTypeKey ?? 'policy_change',
          ...(labels === undefined ? {} : { labels }),
        },
      ],
      { loadId: id },
    );
    const written = real.memberships[0]!;
    for (const snapshot of await real.snapshots.history(written.resultCode)) {
      await snapshots.put(snapshot);
    }
    const membership: FakeMembership = {
      id,
      timelineId: 1,
      resultCode,
      title: `Title ${resultCode}`,
      programId: 1,
      resultTypeKey: 'policy_change',
      snapshotSk: written.snapshotSk,
      ...extra,
    };
    world.memberships.push(membership);
    return membership;
  };
  return { world, service, snapshots, catalogs, add };
}

const fieldOf = (
  view: { sections: Array<{ fields: Array<{ key: string }> }> },
  key: string,
) => view.sections.flatMap((s) => s.fields).find((f) => f.key === key);

/** What the filter and the interceptor would send: status and body of an HTTP exception. */
async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    const http = error as {
      getStatus?: () => number;
      getResponse?: () => unknown;
    };
    return JSON.stringify({
      name: (error as Error).constructor.name,
      status: http.getStatus?.(),
      body: http.getResponse?.(),
    });
  }
  throw new Error('expected a refusal');
}

describe('FR-8: the view of an assessment', () => {
  it('returns the header, the sections in catalog order and the writable flag for an in-scope result', async () => {
    const { service, add } = setup();
    await add(5001, { 'general.title': 'A title' });

    const view = await service.open(assessorA(), 1, 5001);

    expect(view.header).toEqual({
      resultCode: 5001,
      title: 'Title 5001',
      program: { id: 1, code: 'SP01', name: 'Mango' },
      resultType: { key: 'policy_change', label: 'Policy change' },
      timeline: { id: 1, name: 'Official' },
      step: { position: 1, name: 'Step 1' },
      status: 'pending',
    });
    expect(view.sections.map((s) => s.key)).toEqual([
      'general_information',
      'theory_of_change',
      'contributors_partners',
      'geographic_location',
      'policy_change_info',
      'evidence',
    ]);
    expect(fieldOf(view, 'general.title')).toMatchObject({
      value: 'A title',
      notApplicable: false,
    });
    expect(view.writable).toBe(true);
    expect(view.readOnlyReason).toBeNull();
    expect(view.assessment).toBeNull();
  });

  it('falls back to the snapshot title when the membership has none yet', async () => {
    const { service, add } = setup();
    await add(5001, { 'general.title': 'From the snapshot' }, { title: null });
    expect((await service.open(assessorA(), 1, 5001)).header.title).toBe(
      'From the snapshot',
    );
  });

  it('shows the labels Reporting sent, keyed by control list, to the fields that name that list, and null to the others', async () => {
    const { service, add } = setup();
    // The shape of FR-20: `{ control list: { id: label } }`. `general.primary_program` has `control_list: "initiatives"`.
    await add(
      5001,
      { 'general.primary_program': 1, 'general.title': 'T' },
      {},
      {
        initiatives: { '1': 'SP01 Mango' },
        centers: { '9': 'CIAT' },
      },
    );
    const view = await service.open(assessorA(), 1, 5001);
    expect(fieldOf(view, 'general.primary_program')).toMatchObject({
      labels: { initiatives: { '1': 'SP01 Mango' } },
    });
    expect(fieldOf(view, 'general.title')).toMatchObject({ labels: null });
  });

  it('lists the snapshot keys the catalog lacks under other, and a missing key reads Not applicable', async () => {
    const { service, add } = setup();
    await add(5001, { 'legacy.field': 'x' });
    const view = await service.open(assessorA(), 1, 5001);
    expect(view.other.map((f) => f.key)).toEqual(['legacy.field']);
    expect(fieldOf(view, 'general.title')).toMatchObject({
      notApplicable: true,
      value: null,
    });
  });

  it('carries the validations, the comments, the end and who ended it of an existing assessment', async () => {
    const { world, service, add } = setup();
    // The assessment pinned version 1: that is the configuration the view follows.
    world.versionItems[1] = {
      policy_change: items({ 'general.title': { core: true } }),
    };
    const membership = await add(5001, { 'general.title': 'Old title' });
    world.assessments.push({
      id: 70,
      membershipId: membership.id,
      stepPosition: 1,
      status: 'returned',
      finishedBy: 10,
      finishedAt: new Date('2026-03-09T08:00:00.000Z'),
    });
    world.validations.push({
      assessmentId: 70,
      fieldKey: 'general.title',
      validated: true,
    });
    world.comments.push({
      id: 3,
      assessmentId: 70,
      authorId: 10,
      state: 'open',
      fieldKey: 'general.title',
      body: 'Please check',
      valueCopy: { value: 'Old title' },
    });

    const view = await service.open(assessorA(), 1, 5001);

    expect(fieldOf(view, 'general.title')).toMatchObject({
      mode: 'assessed',
      core: true,
      validated: true,
      comments: [
        {
          id: 3,
          author: { id: 10, nickname: 'Ana' },
          body: 'Please check',
          state: 'open',
          valueCopy: { value: 'Old title' },
        },
      ],
    });
    expect(view.assessment).toEqual({
      status: 'returned',
      assessedBy: { id: 10, nickname: 'Ana' },
      finishedAt: '2026-03-09T08:00:00.000Z',
    });
    expect(view.header.status).toBe('returned_to_program');
    // FR-16: an ended assessment accepts no write.
    expect(view.writable).toBe(false);
    expect(view.readOnlyReason).toBe('finished');
  });

  it('is read only outside the step window, with the reason, and still opens', async () => {
    const { service, add } = setup(APRIL);
    await add(5001);
    const view = await service.open(assessorA(), 1, 5001);
    expect(view.writable).toBe(false);
    expect(view.readOnlyReason).toBe('step_closed');
    expect(view.sections.length).toBeGreaterThan(0);
  });

  it('an ADMIN reads it read only, and the round asked for picks the membership (the latest by default)', async () => {
    const { service, add } = setup();
    await add(5001, { 'general.title': 'Round one' }, { round: 1 });
    await add(5001, { 'general.title': 'Round two' }, { round: 2 });

    const latest = await service.open(admin(), 1, 5001);
    expect(fieldOf(latest, 'general.title')).toMatchObject({
      value: 'Round two',
    });
    expect(latest.writable).toBe(false);
    expect(latest.readOnlyReason).toBe('admin_read_only');

    const first = await service.open(admin(), 1, 5001, 1);
    expect(fieldOf(first, 'general.title')).toMatchObject({
      value: 'Round one',
    });
  });

  it('ignores `round` for a reviewer: their own row decides', async () => {
    const { service, add } = setup();
    await add(5001, { 'general.title': 'Round one' }, { round: 1 });
    await add(5001, { 'general.title': 'Round two' }, { round: 2 });
    const view = await service.open(assessorA(), 1, 5001, 2);
    expect(fieldOf(view, 'general.title')).toMatchObject({
      value: 'Round one',
    });
  });
});

describe('FR-9: hidden fields never leave the service', () => {
  it('drops a Hidden field and its value, and shows a Hidden toc.entries read only with all 3 contributions', async () => {
    const { world, service, add } = setup();
    world.fieldConfigItems['policy_change'] = items({
      'toc.entries': 'hidden',
      'general.description': 'hidden',
    });
    const entries = [{ id: 1 }, { id: 2 }, { id: 3 }];
    await add(5001, {
      'toc.entries': entries,
      'general.description': 'SECRET-HIDDEN-VALUE',
      'general.title': 'T',
    });

    const view = await service.open(assessorA(), 1, 5001);

    expect(fieldOf(view, 'toc.entries')).toMatchObject({
      mode: 'view',
      value: entries,
    });
    expect(fieldOf(view, 'general.description')).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain('SECRET-HIDDEN-VALUE');
  });
});

describe('FR-1: out of scope is the same 404 as a missing code', () => {
  it('answers a byte-equal refusal for every way of not seeing a result', async () => {
    const { world, service, add } = setup();
    await add(5001); // in scope
    await add(5002, undefined, { programId: 2 }); // outside the grant's program
    await add(5003, undefined, { resultTypeKey: 'innovation_use' });
    await add(5004, undefined, { status: 'not_in_qa' });
    await add(5005, undefined, { round: 2 });
    world.timelines.push({
      id: 2,
      name: 'Other',
      kind: 'additional',
      steps: defaultFakeSteps(),
    });
    world.memberships.push({
      id: 900,
      timelineId: 2,
      resultCode: 5006,
      title: null,
      programId: 1,
      resultTypeKey: 'policy_change',
    });

    const missing = await refusal(service.open(assessorA(), 1, 999999));
    expect(JSON.parse(missing)).toMatchObject({
      name: 'AssessmentNotFoundError',
      status: 404,
      body: { code: 'ASSESSMENT_NOT_FOUND' },
    });
    for (const attempt of [
      service.open(assessorA(), 1, 5002), // program outside the scope
      service.open(assessorA(), 1, 5003), // result type outside the grant
      service.open(assessorA(), 1, 5004), // not in QA
      service.open(assessorA(), 1, 5005), // a round the row does not work on
      service.open(assessorA(), 2, 5006), // a timeline they are not assigned to
      service.open(assessorA(), 77, 5001), // a timeline that does not exist
      service.open(userOf(11, []), 1, 5001), // no role at all
      service.open(admin(), 1, 5004), // an admin does not see not_in_qa either
    ]) {
      expect(await refusal(attempt)).toBe(missing);
    }
  });

  it('is never a 403', async () => {
    const { service, add } = setup();
    await add(5002, undefined, { programId: 2 });
    await expect(service.open(assessorA(), 1, 5002)).rejects.toBeInstanceOf(
      AssessmentNotFoundError,
    );
  });

  it('judges a revoked grant out of scope', async () => {
    const { service, add } = setup();
    await add(5001);
    const revoked = userOf(
      10,
      [{ ...assignment('ASSESSOR', 'policy_change'), isActive: false }],
      [1],
    );
    await expect(service.open(revoked, 1, 5001)).rejects.toBeInstanceOf(
      AssessmentNotFoundError,
    );
  });
});

describe('FR-8: no structure is guessed', () => {
  it('answers ASSESSMENT_NO_FIELD_CONFIG (409) when the timeline resolves to no version', async () => {
    const { world, service, add } = setup();
    await add(5001);
    world.noFieldConfigVersion = true;
    const error = await service.open(assessorA(), 1, 5001).catch((e) => e);
    expect(error).toBeInstanceOf(AssessmentNoFieldConfigError);
    expect((error as AssessmentNoFieldConfigError).getStatus()).toBe(409);
    expect((error as AssessmentNoFieldConfigError).getResponse()).toMatchObject(
      { code: 'ASSESSMENT_NO_FIELD_CONFIG' },
    );
  });

  it('answers 503 SERVICE_UNAVAILABLE when the catalog cannot be read', async () => {
    const { service, catalogs, add } = setup();
    await add(5001);
    catalogs.forYear.mockRejectedValueOnce(new UpstreamUnavailableError());
    const error = await service.open(assessorA(), 1, 5001).catch((e) => e);
    expect(error).toBeInstanceOf(UpstreamUnavailableError);
    expect((error as UpstreamUnavailableError).getStatus()).toBe(503);
    expect((error as UpstreamUnavailableError).getResponse()).toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
    });
  });

  it('answers the 409 of no configuration when Reporting has no catalog for the year', async () => {
    const { service, catalogs, add } = setup();
    await add(5001);
    catalogs.forYear.mockRejectedValueOnce(
      new FieldConfigCatalogMissingError(2026),
    );
    await expect(service.open(assessorA(), 1, 5001)).rejects.toBeInstanceOf(
      AssessmentNoFieldConfigError,
    );
  });

  it('asks the catalog of the cycle year of the membership', async () => {
    const { world, service, catalogs, add } = setup();
    world.timelines[0]!.cycleYear = 2027;
    await add(5001);
    await service.open(assessorA(), 1, 5001);
    expect(catalogs.forYear).toHaveBeenCalledWith(2027);
  });
});

describe('DD-7: the snapshot is read through the real writer key (KZ-ingestion--timeline-sync-1)', () => {
  it('opens a membership whose snapshot_sk is the one the real LoadRunner wrote', async () => {
    const real = await runRealLoad([
      {
        resultId: 1001,
        values: { 'general.title': 'Written by the runner' },
        // Reporting's shape: by control list. The runner stores it beside the snapshot.
        labels: { initiatives: { '3': 'SP03 Apple' } },
      },
    ]);
    const written = real.memberships[0]!;
    // The runner's key, as stored: with the prefix. A fixture without it is the disqualified blindness.
    expect(written.snapshotSk.startsWith('SNAP#')).toBe(true);
    // The bare column value is not a key of the store: only the stripped one is.
    expect(
      await real.snapshots.get(written.resultCode, written.snapshotSk),
    ).toBeNull();

    // The service reads the store the runner wrote to.
    const { world, service } = setup(MARCH, real.snapshots);
    world.memberships.push({
      id: 500,
      timelineId: 1,
      resultCode: written.resultCode,
      title: null,
      programId: 1,
      resultTypeKey: 'policy_change',
      snapshotSk: written.snapshotSk,
    });

    const view = await service.open(assessorA(), 1, written.resultCode);

    expect(fieldOf(view, 'general.title')).toMatchObject({
      value: 'Written by the runner',
      notApplicable: false,
    });
    expect(view.header.title).toBe('Written by the runner');
  });

  it('carries the labels the real runner stored, for the fields that name their list', async () => {
    const real = await runRealLoad([
      {
        resultId: 1002,
        values: { 'general.primary_program': 3, 'general.title': 'T' },
        labels: { initiatives: { '3': 'SP03 Apple' }, centers: { '1': 'X' } },
      },
    ]);
    const written = real.memberships[0]!;
    const { world, service } = setup(MARCH, real.snapshots);
    world.memberships.push({
      id: 501,
      timelineId: 1,
      resultCode: written.resultCode,
      title: null,
      programId: 1,
      resultTypeKey: 'policy_change',
      snapshotSk: written.snapshotSk,
    });

    const view = await service.open(assessorA(), 1, written.resultCode);

    expect(fieldOf(view, 'general.primary_program')).toMatchObject({
      value: 3,
      labels: { initiatives: { '3': 'SP03 Apple' } },
    });
    expect(fieldOf(view, 'general.title')).toMatchObject({ labels: null });
  });
});

describe('NFR-2: a bounded number of statements', () => {
  it('reads 8 statements with no assessment row and 6 with one, whatever the number of fields and comments', async () => {
    const { world, service, add } = setup();
    const membership = await add(5001);

    world.resetStatements();
    await service.open(assessorA(), 1, 5001);
    // timelines, load probe, membership, then `effectiveFor`: the 3 of
    // `listTimelineStarts`, `listVersions` and `listVersionItems` (production).
    expect(world.statements).toBe(8);

    world.assessments.push({
      id: 70,
      membershipId: membership.id,
      stepPosition: 1,
      status: 'pending',
    });
    for (let i = 0; i < 60; i++) {
      world.comments.push({ assessmentId: 70, authorId: 10, state: 'open' });
      world.validations.push({
        assessmentId: 70,
        fieldKey: `f${i}`,
        validated: true,
      });
    }
    world.resetStatements();
    await service.open(assessorA(), 1, 5001);
    // timelines, load probe, membership, the items of the PINNED version in one
    // statement (design 7.4), then the validations and the comments.
    expect(world.statements).toBe(6);
  });

  it('reads the configuration the assessment pinned, not the one the timeline resolves to now', async () => {
    const { world, service, add } = setup();
    const membership = await add(5001, {
      'general.description': 'A description',
      'general.title': 'T',
    });
    // Today `general.description` is shown; version 1 (pinned) hid it.
    world.fieldConfigItems['policy_change'] = items();
    world.versionItems[1] = {
      policy_change: items({ 'general.description': 'hidden' }),
    };
    world.assessments.push({
      id: 70,
      membershipId: membership.id,
      stepPosition: 1,
      status: 'pending',
      fieldConfigVersion: 1,
    });

    const pinned = await service.open(assessorA(), 1, 5001);
    expect(fieldOf(pinned, 'general.description')).toBeUndefined();
    expect(fieldOf(pinned, 'general.title')).toBeDefined();

    // With no assessment row the timeline's resolved version is the one.
    world.assessments.length = 0;
    const resolved = await service.open(assessorA(), 1, 5001);
    expect(fieldOf(resolved, 'general.description')).toMatchObject({
      value: 'A description',
    });
  });
});

describe('FR-8: a pinned version that has no row', () => {
  it('answers the 409 of no configuration rather than guess a structure, and reads no other version', async () => {
    const { world, service, add } = setup();
    const membership = await add(5001);
    world.assessments.push({
      id: 70,
      membershipId: membership.id,
      stepPosition: 1,
      status: 'pending',
      fieldConfigVersionId: null,
    });
    await expect(service.open(assessorA(), 1, 5001)).rejects.toBeInstanceOf(
      AssessmentNoFieldConfigError,
    );
  });
});

describe('FR-1: a timeline that vanishes inside the configuration read', () => {
  it('answers the same 404 ASSESSMENT_NOT_FOUND as every other way of not seeing the result', async () => {
    const { world, service, add } = setup();
    await add(5001);
    const missing = await refusal(service.open(assessorA(), 1, 999999));
    world.effectiveTimelineGone = true;
    expect(await refusal(service.open(assessorA(), 1, 5001))).toBe(missing);
  });
});
