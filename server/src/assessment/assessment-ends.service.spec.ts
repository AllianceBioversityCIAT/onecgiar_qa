// @akili-spec assessment/step-1-assessment
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  applicableFields,
  shapeCatalog,
} from '../admin-config/field-config/field-config-catalog.js';
import type { ConfigItem } from '../admin-config/field-config/field-config-diff.js';
import type { FieldCatalogSource } from '../admin-config/field-config/field-catalog.ports.js';
import type { RomeMinute } from '../admin-config/rome-date.js';
import { AuthorizationService } from '../users/authorization.service.js';
import type { AssignmentView } from '../users/authorization.service.js';
import { CatalogService } from '../users/catalogs/catalog.service.js';
import type { AuthenticatedUser } from '../users/current-user.cache.js';
import type {
  ResultSnapshotRecord,
  SnapshotStore,
} from '../ingestion/snapshot-store.port.js';
import {
  FakeFieldConfigEffective,
  InMemoryAssessmentStore,
  InMemoryAssessmentUnitOfWork,
  noReleaseDispatch,
  InMemoryAssessmentWriteStore,
  InMemoryAssessmentWorld,
  InMemoryTimelineLoads,
  InMemoryWorklistStore,
  type FakeComment,
  type FakeMembership,
} from '../../test/support/in-memory-assessment.js';
import type { DrizzleDB } from '../database/drizzle/drizzle.module.js';
import { AssessmentCoreUncommentedError } from './assessment.errors.js';
import { AssessmentService } from './assessment.service.js';
import type { AuditEventWrite } from './assessment.store.js';
import type { ReleaseDispatcher } from './release.service.js';
import {
  DrizzleAssessmentUnitOfWork,
  type AssessmentUnitOfWork,
} from './assessment.unit-of-work.js';
import type { WorklistStep } from './worklist.store.js';

// Only the deadlock test below uses it: the REAL unit of work (with its
// deadlock retry) runs over a fake database whose transaction hands the work
// the in-memory write store, so the store the real class builds from `tx` is
// the fake one. Nothing else in this file touches `DrizzleAssessmentWriteStore`.
vi.mock('./assessment.store.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./assessment.store.js')>()),
  DrizzleAssessmentWriteStore: class {
    constructor(tx: { store: object }) {
      return tx.store;
    }
  },
}));

// The ends of an assessment over the fake unit of work (T-11; FR-12 is in its
// own spec): the automatic Quality Assessed (FR-14, OQ-2), Finish to Returned
// (FR-15, OQ-9), the lock after the end (FR-16), several assessors and one end
// (FR-17), the audit of an end (FR-21). Expected values come from the
// scenarios of requirements.md and are written out. The fake has NO row lock:
// every concurrent writer reads `pending`, so only the conditional end UPDATE
// can decide who ends the assessment, which is what the race tests exercise.

const catalog = shapeCatalog(
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
const ASSESSED = applicable.slice(0, 12);
const VIEW_ONLY = applicable.slice(12, 17);
// Three core fields; the fourth Assessed field is NOT core and stays grey.
const CORE = ASSESSED.slice(0, 3) as [string, string, string];
const NON_CORE = ASSESSED[3]!;

const itemsWith = (core: readonly string[]): ConfigItem[] =>
  applicable.map((fieldKey) => ({
    resultTypeKey: 'policy_change',
    fieldKey,
    visibility: ASSESSED.includes(fieldKey)
      ? 'assessed'
      : VIEW_ONLY.includes(fieldKey)
        ? 'view_only'
        : 'hidden',
    isCore: core.includes(fieldKey),
    isAiInput: false,
  }));

const assignment = (roleCode: string): AssignmentView => ({
  roleCode,
  roleIsActive: true,
  isActive: true,
  revokedAt: null,
  resultTypeKey: roleCode === 'ADMIN' ? null : 'policy_change',
  programId: null,
});
const userOf = (id: number, roleCode = 'ASSESSOR', nickname = `User${id}`) =>
  ({
    id,
    email: `user${id}@example.org`,
    firstName: 'First',
    lastName: 'Last',
    nickname,
    authSource: 'custom',
    isActive: true,
    assignments: [assignment(roleCode)],
    programScope: roleCode === 'ADMIN' ? [] : [1],
    exclusions: [],
  }) as AuthenticatedUser;
const assessorA = () => userOf(10, 'ASSESSOR', 'Ana');
const admin = () => userOf(99, 'ADMIN', 'Ada');

const minute = (value: string) => value as RomeMinute;
const STEPS: WorklistStep[] = [
  {
    position: 1,
    name: 'Step 1',
    audience: 'assessors',
    opensAt: minute('2026-11-12T09:00'),
    closesAt: minute('2026-11-20T17:30'),
  },
  {
    position: 2,
    name: 'Step 2',
    audience: 'programs',
    opensAt: minute('2027-01-01T00:00'),
    closesAt: minute('2027-01-31T23:59'),
  },
  {
    position: 3,
    name: 'Step 3',
    audience: 'lead_assessors',
    opensAt: minute('2027-02-01T00:00'),
    closesAt: minute('2027-02-28T23:59'),
  },
];
const OPEN = new Date('2026-11-13T10:00:00Z');

let nextId = 1;
function setup(
  now: Date = OPEN,
  core: readonly string[] = CORE,
  clockCalls: { count: number } = { count: 0 },
  unitOfWorkOver: (
    world: InMemoryAssessmentWorld,
  ) => AssessmentUnitOfWork = (world) => new InMemoryAssessmentUnitOfWork(world),
  dispatcher: ReleaseDispatcher = noReleaseDispatch,
) {
  const world = new InMemoryAssessmentWorld();
  world.timelines.push({
    id: 1,
    name: 'Official',
    kind: 'official',
    steps: STEPS,
  });
  for (const id of [10, 11, 12, 13, 14]) {
    world.timelineUsers.push({
      timelineId: 1,
      userId: id,
      roleCode: 'ASSESSOR',
    });
  }
  world.users.push(
    { id: 10, nickname: 'Ana' },
    { id: 11, nickname: 'User11' },
    { id: 99, nickname: 'Ada' },
  );
  world.fieldConfigItems['policy_change'] = itemsWith(core);
  world.versionItems[1] = { policy_change: itemsWith(core) };
  const catalogs = {
    forYear: vi.fn(() => Promise.resolve(catalog)),
  } satisfies FieldCatalogSource;
  const service = new AssessmentService(
    new InMemoryAssessmentStore(world),
    new InMemoryWorklistStore(world),
    new InMemoryTimelineLoads(world),
    // A comment copies the field value from the snapshot; every field of this one is empty.
    {
      get: () => Promise.resolve({ values: {} } as ResultSnapshotRecord),
    } as unknown as SnapshotStore,
    catalogs,
    new FakeFieldConfigEffective(world),
    {
      listSciencePrograms: () => Promise.resolve([]),
      listResultTypes: () => Promise.resolve([]),
    } as unknown as CatalogService,
    new AuthorizationService(),
    () => {
      clockCalls.count += 1;
      return now;
    },
    unitOfWorkOver(world),
    dispatcher,
  );
  const add = (
    resultCode: number,
    extra: Partial<FakeMembership> = {},
  ): FakeMembership => {
    const membership: FakeMembership = {
      id: nextId++,
      timelineId: 1,
      resultCode,
      title: `Title ${resultCode}`,
      programId: 1,
      resultTypeKey: 'policy_change',
      ...extra,
    };
    world.memberships.push(membership);
    return membership;
  };
  /** A pending assessment (id 1) with the given green fields and comments. */
  const seed = (
    membership: FakeMembership,
    held: { green?: string[]; comments?: Array<Partial<FakeComment>> } = {},
  ) => {
    world.assessments.push({
      id: 1,
      membershipId: membership.id,
      stepPosition: 1,
      status: 'pending',
      fieldConfigVersion: 1,
    });
    for (const fieldKey of held.green ?? []) {
      world.validations.push({ assessmentId: 1, fieldKey, validated: true });
    }
    for (const [index, comment] of (held.comments ?? []).entries()) {
      world.comments.push({
        id: 100 + index,
        assessmentId: 1,
        authorId: 11,
        state: 'open',
        ...comment,
      });
    }
  };
  return { world, service, add, seed, clockCalls };
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a refusal');
}
async function refusal(promise: Promise<unknown>) {
  const http = (await failure(promise)) as {
    getStatus?: () => number;
    getResponse?: () => unknown;
  };
  return { status: http.getStatus?.(), body: http.getResponse?.() };
}

const check = (fieldKeys: string[], validated = true) => ({
  validated,
  fieldKeys,
});
const RID = 'req-1';
const END_ACTIONS = ['end_quality_assessed', 'end_returned'];
const endAudits = (world: InMemoryAssessmentWorld) =>
  world.audits.filter((a) => END_ACTIONS.includes(a.action));

describe('FR-14: automatic Quality Assessed (OQ-2)', () => {
  it('Last core goes green: ends quality_assessed with Assessed by = the user, queues the qaed release, shows the non-core comment to the program', async () => {
    const { world, service, add, seed } = setup();
    const membership = add(5001, { resultId: 777, phaseYear: 2026 });
    seed(membership, {
      green: [CORE[0], CORE[1]],
      comments: [{ fieldKey: NON_CORE, body: 'A non-core remark' }],
    });

    const summary = await service.validate(
      assessorA(),
      1,
      5001,
      check([CORE[2]]),
      RID,
    );

    expect(summary).toMatchObject({
      status: 'quality_assessed',
      assessedBy: { id: 10, nickname: 'Ana' },
      finishedAt: '2026-11-13T10:00:00.000Z',
    });
    expect(world.assessments[0]).toMatchObject({
      status: 'quality_assessed',
      finishedBy: 10,
      finishedAt: OPEN,
    });
    expect(world.releases).toEqual([
      {
        assessmentId: 1,
        timelineResultId: membership.id,
        resultId: 777,
        phaseYear: 2026,
        outcome: 'qaed',
        at: OPEN,
        status: 'pending',
      },
    ]);
    expect(world.comments[0]!.visibleToProgramAt).toEqual(OPEN);
    expect(world.audits.map((a) => a.action)).toEqual([
      'validate',
      'end_quality_assessed',
    ]);
    expect(endAudits(world)).toEqual([
      {
        assessmentId: 1,
        actorId: 10,
        action: 'end_quality_assessed',
        fieldKeys: null,
        commentId: null,
        requestId: RID,
        at: OPEN,
      },
    ]);
  });

  it('does not end while one core field is still grey, even when every other Assessed field is green', async () => {
    const { world, service, add } = setup();
    add(5001);
    const summary = await service.validate(
      assessorA(),
      1,
      5001,
      check([CORE[0], CORE[1], ASSESSED[4]!, ASSESSED[5]!]),
      RID,
    );
    expect(summary).toMatchObject({
      status: 'pending',
      assessedBy: null,
      finishedAt: null,
    });
    expect(world.releases).toEqual([]);
    expect(endAudits(world)).toEqual([]);
  });

  it('check all ends it when the core fields are among the fields it sets green', async () => {
    const { world, service, add } = setup();
    add(5001);
    const summary = await service.validate(
      assessorA(),
      1,
      5001,
      { validated: true, all: true },
      RID,
    );
    expect(summary.status).toBe('quality_assessed');
    expect(world.releases).toHaveLength(1);
  });

  it('greying a field never ends it', async () => {
    const { world, service, add, seed } = setup();
    seed(add(5001), { green: [...CORE] });
    // An assessment with every core green but still pending cannot exist; this pins that a grey write does not end it either.
    const summary = await service.validate(
      assessorA(),
      1,
      5001,
      check([CORE[0]], false),
      RID,
    );
    expect(summary.status).toBe('pending');
    expect(world.releases).toEqual([]);
  });

  it('an assessment with no core field never ends by itself: every Assessed field green stays pending', async () => {
    const { world, service, add } = setup(OPEN, []);
    add(5001);
    const summary = await service.validate(
      assessorA(),
      1,
      5001,
      { validated: true, all: true },
      RID,
    );
    expect(summary).toMatchObject({ status: 'pending', assessedBy: null });
    expect(world.assessments[0]!.status).toBe('pending');
    expect(world.releases).toEqual([]);
    expect(endAudits(world)).toEqual([]);
  });

  it('a write that changes nothing does not run the end check or write an end', async () => {
    const { world, service, add, seed } = setup();
    seed(add(5001), { green: [CORE[0]] });
    await service.validate(assessorA(), 1, 5001, check([CORE[0]]), RID);
    expect(world.writeLog).not.toContain('endAssessment');
  });

  it('runs 14 statements for an ending validation (4 reads, 10 in the transaction)', async () => {
    const { world, service, add, seed } = setup();
    seed(add(5001), { green: [CORE[0], CORE[1]] });
    world.resetStatements();
    await service.validate(assessorA(), 1, 5001, check([CORE[2]]), RID);
    expect(world.statements).toBe(14);
  });

  it('writes the end in the lock order: the timeline, the assessment row, then the rows under it', async () => {
    const { world, service, add, seed } = setup();
    seed(add(5001), { green: [CORE[0], CORE[1]] });
    await service.validate(assessorA(), 1, 5001, check([CORE[2]]), RID);
    expect(world.writeLog).toEqual([
      'lockTimelineShared',
      'lockAssessment',
      'findValidations',
      'upsertValidations',
      'insertAudit',
      'endAssessment',
      'insertRelease',
      'markCommentsVisible',
      'insertAudit',
    ]);
  });

  it('rolls the whole end back when the release cannot be queued: no end, no validation', async () => {
    const { world, service, add, seed } = setup();
    seed(add(5001), { green: [CORE[0], CORE[1]] });
    world.releases.push({
      assessmentId: 1,
      timelineResultId: 1,
      resultId: 1,
      phaseYear: 2026,
      outcome: 'qaed',
      at: OPEN,
      status: 'pending',
    });
    await failure(
      service.validate(assessorA(), 1, 5001, check([CORE[2]]), RID),
    );
    expect(world.assessments[0]!.status).toBe('pending');
    expect(world.validations.map((v) => v.fieldKey).sort()).toEqual(
      [CORE[0], CORE[1]].sort(),
    );
    expect(world.audits).toEqual([]);
  });

  it('two assessors setting the last core green at once: one ends it, the other gets 409 ASSESSMENT_FINISHED and leaves nothing', async () => {
    const { world, service, add, seed } = setup();
    seed(add(5001), { green: [CORE[0], CORE[1]] });
    world.holdLockUntil = 2;

    const results = await Promise.allSettled([
      service.validate(userOf(10), 1, 5001, check([CORE[2]]), 'req-a'),
      service.validate(userOf(11), 1, 5001, check([CORE[2]]), 'req-b'),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(
      (rejected[0]!.reason as { getResponse(): unknown }).getResponse(),
    ).toMatchObject({ code: 'ASSESSMENT_FINISHED' });
    expect(world.releases).toHaveLength(1);
    expect(endAudits(world)).toHaveLength(1);
    // The loser's audit row went with its rollback: one validate, one end.
    expect(world.audits.map((a) => a.action).sort()).toEqual([
      'end_quality_assessed',
      'validate',
    ]);
    // And its validation rows: the two seeded fields and the winner's one, no duplicate.
    expect(world.validations.map((v) => v.fieldKey).sort()).toEqual(
      [...CORE].sort(),
    );
    expect(world.validations).toHaveLength(3);
  });
});

describe('FR-14 and FR-15: Finish with no core field (OQ-2)', () => {
  it('ends as quality_assessed, Assessed by the caller, and queues the qaed release', async () => {
    const { world, service, add } = setup(OPEN, []);
    add(5001);
    const summary = await service.finish(assessorA(), 1, 5001, RID);
    expect(summary).toMatchObject({
      status: 'quality_assessed',
      assessedBy: { id: 10, nickname: 'Ana' },
      finishedAt: '2026-11-13T10:00:00.000Z',
    });
    expect(world.releases.map((r) => r.outcome)).toEqual(['qaed']);
    expect(world.audits.map((a) => a.action)).toEqual(['end_quality_assessed']);
  });
});

describe('FR-15: Finish assessment, Returned to program (OQ-9)', () => {
  it('Return: a grey and commented core field ends it returned, Assessed by the caller, release not_qaed queued, every comment visible', async () => {
    const { world, service, add, seed } = setup();
    const membership = add(5001, { resultId: 888, phaseYear: 2026 });
    seed(membership, {
      green: [CORE[1], CORE[2]],
      comments: [
        { fieldKey: CORE[0], body: 'The title is vague' },
        { fieldKey: NON_CORE, body: 'A non-core remark' },
        { fieldKey: NON_CORE, body: 'Withdrawn', state: 'withdrawn' },
      ],
    });
    // Until then the status was pending.
    expect(world.assessments[0]!.status).toBe('pending');

    const summary = await service.finish(assessorA(), 1, 5001, RID);

    expect(summary).toMatchObject({
      status: 'returned',
      assessedBy: { id: 10, nickname: 'Ana' },
      finishedAt: '2026-11-13T10:00:00.000Z',
    });
    expect(world.assessments[0]).toMatchObject({
      status: 'returned',
      finishedBy: 10,
      finishedAt: OPEN,
    });
    expect(world.releases).toEqual([
      {
        assessmentId: 1,
        timelineResultId: membership.id,
        resultId: 888,
        phaseYear: 2026,
        outcome: 'not_qaed',
        at: OPEN,
        status: 'pending',
      },
    ]);
    expect(world.comments.map((c) => c.visibleToProgramAt ?? null)).toEqual([
      OPEN,
      OPEN,
      null,
    ]);
    expect(endAudits(world)).toEqual([
      {
        assessmentId: 1,
        actorId: 10,
        action: 'end_returned',
        fieldKeys: null,
        commentId: null,
        requestId: RID,
        at: OPEN,
      },
    ]);
    expect(summary.validations.map((v) => v.fieldKey).sort()).toEqual(
      [CORE[1], CORE[2]].sort(),
    );
  });

  it('refuses 409 ASSESSMENT_CORE_UNCOMMENTED naming the grey core fields with no comment, and stores nothing', async () => {
    const { world, service, add, seed } = setup();
    seed(add(5001), {
      green: [CORE[2]],
      comments: [{ fieldKey: CORE[0], body: 'Commented' }],
    });

    const error = await failure(service.finish(assessorA(), 1, 5001, RID));

    expect(error).toBeInstanceOf(AssessmentCoreUncommentedError);
    expect((error as AssessmentCoreUncommentedError).fields).toEqual([
      CORE[1],
    ]);
    expect(
      (error as AssessmentCoreUncommentedError).getResponse(),
    ).toMatchObject({ code: 'ASSESSMENT_CORE_UNCOMMENTED' });
    expect((error as AssessmentCoreUncommentedError).getStatus()).toBe(409);
    expect(world.assessments[0]!.status).toBe('pending');
    expect(world.releases).toEqual([]);
    expect(world.audits).toEqual([]);
    expect(world.comments[0]!.visibleToProgramAt ?? null).toBeNull();
  });

  it('a withdrawn comment does not count: the field is named again', async () => {
    const { service, add, seed } = setup();
    seed(add(5001), {
      green: [CORE[1], CORE[2]],
      comments: [{ fieldKey: CORE[0], state: 'withdrawn' }],
    });
    const error = await failure(service.finish(assessorA(), 1, 5001, RID));
    expect((error as AssessmentCoreUncommentedError).fields).toEqual([
      CORE[0],
    ]);
  });

  it('names every uncommented grey core field, in the order of the configuration', async () => {
    const { service, add } = setup();
    add(5001);
    const error = await failure(service.finish(assessorA(), 1, 5001, RID));
    expect((error as AssessmentCoreUncommentedError).fields).toEqual([...CORE]);
  });

  it('a Finish refused for its core fields leaves no assessment row behind when none existed', async () => {
    const { world, service, add } = setup();
    add(5001);
    await failure(service.finish(assessorA(), 1, 5001, RID));
    expect(world.assessments).toEqual([]);
    expect(world.audits).toEqual([]);
  });

  it('runs 13 statements for a finish (4 reads, 9 in the transaction), returned or quality_assessed', async () => {
    const { world, service, add, seed } = setup();
    seed(add(5001), {
      green: [CORE[1], CORE[2]],
      comments: [{ fieldKey: CORE[0] }],
    });
    world.resetStatements();
    await service.finish(assessorA(), 1, 5001, RID);
    expect(world.statements).toBe(13);
  });

  it('takes the locks in the order of design 5 and writes the end under them', async () => {
    const { world, service, add, seed } = setup();
    seed(add(5001), {
      green: [CORE[1], CORE[2]],
      comments: [{ fieldKey: CORE[0] }],
    });
    await service.finish(assessorA(), 1, 5001, RID);
    expect(world.writeLog).toEqual([
      'lockTimelineShared',
      'lockAssessment',
      'findValidations',
      'findCommentedFieldKeys',
      'endAssessment',
      'insertRelease',
      'markCommentsVisible',
      'insertAudit',
    ]);
  });

  it('reads the clock once per request', async () => {
    const calls = { count: 0 };
    const { service, add } = setup(OPEN, [], calls);
    add(5001);
    await service.finish(assessorA(), 1, 5001, RID);
    expect(calls.count).toBe(1);
  });
});

describe('FR-16: locked after the end, and who may finish', () => {
  it('409 ASSESSMENT_FINISHED on a finish after the end, and nothing more is written', async () => {
    const { world, service, add, seed } = setup(OPEN, []);
    seed(add(5001));
    await service.finish(assessorA(), 1, 5001, RID);
    const writes = world.writeLog.length;

    expect(
      await refusal(service.finish(userOf(11), 1, 5001, 'req-2')),
    ).toMatchObject({ status: 409, body: { code: 'ASSESSMENT_FINISHED' } });
    expect(world.releases).toHaveLength(1);
    expect(endAudits(world)).toHaveLength(1);
    expect(world.writeLog).toHaveLength(writes);
  });

  it('409 ASSESSMENT_FINISHED on a finish of a membership that already ended', async () => {
    const { service, add, seed } = setup(OPEN, []);
    seed(add(5001, { ended: true, endReason: 'released_qaed' }));
    expect(await refusal(service.finish(assessorA(), 1, 5001, RID))).toMatchObject(
      { status: 409, body: { code: 'ASSESSMENT_FINISHED' } },
    );
  });

  it('409 ASSESSMENT_FINISHED when the membership ended after the first read but before the lock', async () => {
    const { world, service, add, seed } = setup(OPEN, []);
    const membership = add(5001);
    seed(membership);
    world.beforeLockAssessment = () => {
      membership.ended = true;
    };
    expect(await refusal(service.finish(assessorA(), 1, 5001, RID))).toMatchObject(
      { status: 409, body: { code: 'ASSESSMENT_FINISHED' } },
    );
    expect(world.assessments[0]!.status).toBe('pending');
    expect(world.releases).toEqual([]);
  });

  it('409 ASSESSMENT_STEP_CLOSED when the step is not open, whatever the state', async () => {
    const { world, service, add } = setup(new Date('2026-11-21T10:00:00Z'), []);
    add(5001);
    expect(await refusal(service.finish(assessorA(), 1, 5001, RID))).toMatchObject(
      { status: 409, body: { code: 'ASSESSMENT_STEP_CLOSED' } },
    );
    expect(world.assessments).toEqual([]);
  });

  it('403 ASSESSMENT_READ_ONLY for an ADMIN with no reviewer row', async () => {
    const { world, service, add } = setup(OPEN, []);
    add(5001);
    expect(await refusal(service.finish(admin(), 1, 5001, RID))).toMatchObject({
      status: 403,
      body: { code: 'ASSESSMENT_READ_ONLY' },
    });
    expect(world.assessments).toEqual([]);
  });

  it('the same 404 for a result that does not exist and one outside the caller scope', async () => {
    const { service, add } = setup(OPEN, []);
    add(5001, { programId: 2 });
    const missing = await refusal(service.finish(assessorA(), 1, 9999, RID));
    const outside = await refusal(service.finish(assessorA(), 1, 5001, RID));
    expect(missing).toMatchObject({
      status: 404,
      body: { code: 'ASSESSMENT_NOT_FOUND' },
    });
    expect(outside).toEqual(missing);
  });

  it('a step moved to another position by a timeline edit between the read and the lock refuses with ASSESSMENT_STEP_CLOSED', async () => {
    const { world, service, add } = setup(OPEN, []);
    add(5001);
    world.beforeLockTimeline = () => {
      world.timelines[0]!.steps = [
        { ...STEPS[1]!, position: 1, opensAt: STEPS[1]!.opensAt },
        { ...STEPS[0]!, position: 2 },
        STEPS[2]!,
      ];
    };
    expect(await refusal(service.finish(assessorA(), 1, 5001, RID))).toMatchObject(
      { status: 409, body: { code: 'ASSESSMENT_STEP_CLOSED' } },
    );
    expect(world.assessments).toEqual([]);
    expect(world.releases).toEqual([]);
  });
});

describe('FR-17: several assessors, one end', () => {
  const finishers = () => [10, 11, 12, 13, 14].map((id) => userOf(id));
  const reasonCode = (reason: unknown) =>
    (reason as { getResponse(): { code: string } }).getResponse().code;

  it('five concurrent finishes: one gets the end, four get 409 ASSESSMENT_FINISHED, one release row and one end audit row', async () => {
    const { world, service, add, seed } = setup();
    seed(add(5001), {
      green: [CORE[1], CORE[2]],
      comments: [{ fieldKey: CORE[0], body: 'Please fix the title' }],
    });
    // Every transaction reaches the row lock before any of them continues.
    world.holdLockUntil = 5;

    const results = await Promise.allSettled(
      finishers().map((user) =>
        service.finish(user, 1, 5001, `req-${user.id}`),
      ),
    );

    // The finishes really interleaved: all five locks were taken before the first end.
    expect(world.writeLog.filter((w) => w === 'lockAssessment')).toHaveLength(5);
    expect(world.writeLog.indexOf('endAssessment')).toBeGreaterThan(
      world.writeLog.lastIndexOf('lockAssessment'),
    );

    // The database let exactly one end UPDATE through.
    expect(world.endUpdatesMatched).toBe(1);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected.map((r) => reasonCode(r.reason))).toEqual([
      'ASSESSMENT_FINISHED',
      'ASSESSMENT_FINISHED',
      'ASSESSMENT_FINISHED',
      'ASSESSMENT_FINISHED',
    ]);
    expect(world.releases).toHaveLength(1);
    expect(world.releases[0]!.outcome).toBe('not_qaed');
    expect(endAudits(world)).toHaveLength(1);
    // The winner is the one whose answer says so, and the row agrees.
    const winner = results.findIndex((r) => r.status === 'fulfilled');
    expect(world.assessments[0]).toMatchObject({
      status: 'returned',
      finishedBy: finishers()[winner]!.id,
    });
    expect(endAudits(world)[0]).toMatchObject({
      actorId: finishers()[winner]!.id,
    });
  });

  it('five concurrent finishes of an assessment with no core field: still one end, as quality_assessed', async () => {
    const { world, service, add, seed } = setup(OPEN, []);
    seed(add(5001));
    world.holdLockUntil = 5;
    const results = await Promise.allSettled(
      finishers().map((user) =>
        service.finish(user, 1, 5001, `req-${user.id}`),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(world.releases.map((r) => r.outcome)).toEqual(['qaed']);
    expect(endAudits(world)).toHaveLength(1);
  });

  it('a validation that commits before the finish is kept, and one queued after it is refused', async () => {
    const { world, service, add, seed } = setup();
    seed(add(5001), {
      green: [CORE[1], CORE[2]],
      comments: [{ fieldKey: CORE[0] }],
    });

    await service.validate(userOf(11), 1, 5001, check([NON_CORE]), 'req-v1');
    await service.finish(assessorA(), 1, 5001, 'req-f');
    expect(
      await refusal(
        service.validate(userOf(12), 1, 5001, check([ASSESSED[5]!]), 'req-v2'),
      ),
    ).toMatchObject({ status: 409, body: { code: 'ASSESSMENT_FINISHED' } });

    const kept = world.validations.map((v) => v.fieldKey).sort();
    expect(kept).toEqual([CORE[1], CORE[2], NON_CORE].sort());
    expect(world.audits.map((a) => a.requestId)).toEqual(['req-v1', 'req-f']);
  });

  it('a validation in flight while a finish commits is refused under the lock: 409 ASSESSMENT_FINISHED, no validation row and no audit row from it', async () => {
    const { world, service, add, seed } = setup();
    seed(add(5001), {
      green: [CORE[1], CORE[2]],
      comments: [{ fieldKey: CORE[0] }],
    });
    // The validation read `pending` and is on its way to the row lock; behind the lock the finish commits in full.
    let finishing: Promise<unknown> | null = null;
    world.beforeLockAssessment = async () => {
      world.beforeLockAssessment = null;
      finishing = service.finish(assessorA(), 1, 5001, 'req-f');
      await finishing;
    };

    const outcome = await refusal(
      service.validate(userOf(12), 1, 5001, check([NON_CORE]), 'req-v'),
    );

    expect(finishing).not.toBeNull();
    expect(outcome).toMatchObject({
      status: 409,
      body: { code: 'ASSESSMENT_FINISHED' },
    });
    expect(world.assessments[0]!.status).toBe('returned');
    // Only the seeded green fields: the refused validation wrote nothing.
    expect(world.validations.map((v) => v.fieldKey).sort()).toEqual(
      [CORE[1], CORE[2]].sort(),
    );
    expect(world.audits.map((a) => a.requestId)).toEqual(['req-f']);
    expect(world.endUpdatesMatched).toBe(1);
  });

  it('a comment written after the end is refused too, and the finish sees one written before it', async () => {
    const { world, service, add, seed } = setup();
    seed(add(5001), { green: [CORE[1], CORE[2]] });
    await service.comment(
      userOf(11),
      1,
      5001,
      { fieldKey: CORE[0], body: 'Before the finish' },
      'req-c1',
    );
    await service.finish(assessorA(), 1, 5001, 'req-f');
    expect(world.assessments[0]!.status).toBe('returned');
    expect(
      await refusal(
        service.comment(
          userOf(12),
          1,
          5001,
          { fieldKey: CORE[0], body: 'After' },
          'req-c2',
        ),
      ),
    ).toMatchObject({ status: 409, body: { code: 'ASSESSMENT_FINISHED' } });
  });
});

describe('the pinned version under the lock (T-10 pointer 3)', () => {
  /** v1 hides `ASSESSED[0]`; the timeline resolves to v2, which assesses it. */
  function raceSetup() {
    const ctx = setup();
    const v1 = itemsWith(CORE).map((item) =>
      item.fieldKey === ASSESSED[0]
        ? { ...item, visibility: 'hidden' as const }
        : item,
    );
    ctx.world.versionItems[1] = { policy_change: v1 };
    ctx.world.effectiveVersions = [2];
    const membership = ctx.add(5001);
    // Another first writer commits version 1 between this request's reads and its lock.
    ctx.world.beforeLockTimeline = () => {
      ctx.world.beforeLockTimeline = null;
      ctx.world.assessments.push({
        id: 500,
        membershipId: membership.id,
        stepPosition: 1,
        status: 'pending',
        fieldConfigVersion: 1,
        roleCode: 'ASSESSOR',
        createdBy: 11,
      });
    };
    return ctx;
  }

  it('validate: keys judged against another version than the row pinned are judged again against the pinned one, and refused', async () => {
    const { world, service } = raceSetup();
    expect(
      await refusal(
        service.validate(assessorA(), 1, 5001, check([ASSESSED[0]!]), RID),
      ),
    ).toMatchObject({
      status: 400,
      body: { code: 'VALIDATION_FAILED' },
    });
    expect(world.validations).toEqual([]);
    expect(world.audits).toEqual([]);
  });

  it('validate: a key valid in both versions is written against the pinned row, which keeps its version', async () => {
    const { world, service } = raceSetup();
    await service.validate(assessorA(), 1, 5001, check([ASSESSED[5]!]), RID);
    expect(world.assessments).toHaveLength(1);
    expect(world.assessments[0]).toMatchObject({ id: 500, fieldConfigVersion: 1 });
    expect(world.validations).toEqual([
      { assessmentId: 500, fieldKey: ASSESSED[5], validated: true },
    ]);
  });

  it('a second mismatch after the one retry is a typed 503 SERVICE_UNAVAILABLE, not a 500, and leaves nothing written', async () => {
    const { world, service, add, seed } = setup();
    seed(add(5001));
    for (const version of [2, 3]) {
      world.versionItems[version] = { policy_change: itemsWith(CORE) };
    }
    // The pin moves under every lock, so the request never settles on the version it judged by.
    world.beforeLockAssessment = () => {
      world.assessments[0]!.fieldConfigVersion! += 1;
    };
    expect(
      await refusal(
        service.validate(assessorA(), 1, 5001, check([NON_CORE]), RID),
      ),
    ).toMatchObject({ status: 503, body: { code: 'SERVICE_UNAVAILABLE' } });
    // One retry, no more: the lock was reached twice.
    expect(world.writeLog.filter((w) => w === 'lockAssessment')).toHaveLength(2);
    expect(world.validations).toEqual([]);
    expect(world.audits).toEqual([]);
  });

  it('comment: a field assessed in the request version but not in the pinned one is refused', async () => {
    const { world, service } = raceSetup();
    expect(
      await refusal(
        service.comment(
          assessorA(),
          1,
          5001,
          { fieldKey: ASSESSED[0]!, body: 'A comment' },
          RID,
        ),
      ),
    ).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } });
    expect(world.comments).toEqual([]);
  });

  it('finish: the core fields are those of the pinned version, not the one the request read', async () => {
    const { world, service } = raceSetup();
    // v1 has ASSESSED[0] hidden, so it is not a core field of the pinned assessment: only CORE[1], CORE[2] are.
    const error = await failure(service.finish(assessorA(), 1, 5001, RID));
    expect((error as AssessmentCoreUncommentedError).fields).toEqual([
      CORE[1],
      CORE[2],
    ]);
    expect(world.assessments[0]!.status).toBe('pending');
  });
});

describe('the end of a re-judged write (T-10 pointer 4)', () => {
  it('validate: a membership that ended between the first read and the lock refuses with ASSESSMENT_FINISHED', async () => {
    const { world, service, add, seed } = setup();
    const membership = add(5001);
    seed(membership);
    world.beforeLockAssessment = () => {
      membership.ended = true;
    };
    expect(
      await refusal(
        service.validate(assessorA(), 1, 5001, check([CORE[0]]), RID),
      ),
    ).toMatchObject({ status: 409, body: { code: 'ASSESSMENT_FINISHED' } });
    expect(world.validations).toEqual([]);
  });

  it('comment: a membership that ended between the first read and the lock refuses with ASSESSMENT_FINISHED', async () => {
    const { world, service, add, seed } = setup();
    const membership = add(5001);
    seed(membership);
    world.beforeLockAssessment = () => {
      membership.ended = true;
    };
    expect(
      await refusal(
        service.comment(
          assessorA(),
          1,
          5001,
          { fieldKey: CORE[0], body: 'A comment' },
          RID,
        ),
      ),
    ).toMatchObject({ status: 409, body: { code: 'ASSESSMENT_FINISHED' } });
    expect(world.comments).toEqual([]);
  });

  it('validate and comment: the step position judged under the share lock must be the one judged first', async () => {
    const { world, service, add } = setup();
    add(5001);
    const moved = () => {
      world.timelines[0]!.steps = [
        { ...STEPS[1]!, position: 1 },
        { ...STEPS[0]!, position: 2 },
        STEPS[2]!,
      ];
    };
    world.beforeLockTimeline = moved;
    expect(
      await refusal(
        service.validate(assessorA(), 1, 5001, check([CORE[0]]), RID),
      ),
    ).toMatchObject({ status: 409, body: { code: 'ASSESSMENT_STEP_CLOSED' } });
    world.timelines[0]!.steps = STEPS;
    world.beforeLockTimeline = moved;
    expect(
      await refusal(
        service.comment(
          assessorA(),
          1,
          5001,
          { fieldKey: CORE[0], body: 'A comment' },
          RID,
        ),
      ),
    ).toMatchObject({ status: 409, body: { code: 'ASSESSMENT_STEP_CLOSED' } });
    expect(world.assessments).toEqual([]);
  });
});

/** An in-memory write store whose first audit row is followed by a deadlock (1213), as when a concurrent end takes the locks in the other order. */
class DeadlockAfterAuditStore extends InMemoryAssessmentWriteStore {
  constructor(
    world: InMemoryAssessmentWorld,
    undo: Array<() => void>,
    private readonly trip: { thrown: number },
  ) {
    super(world, undo);
  }

  override async insertAudit(event: AuditEventWrite): Promise<void> {
    await super.insertAudit(event);
    if (this.trip.thrown === 0) {
      this.trip.thrown += 1;
      throw Object.assign(new Error('Deadlock found when trying to get lock'), {
        code: 'ER_LOCK_DEADLOCK',
        errno: 1213,
      });
    }
  }
}

describe('a deadlock in the middle of a real validation (T-11, design 5)', () => {
  it('reruns the transaction: one clock read, one audit row and one set of validation rows after the retry', async () => {
    const clockCalls = { count: 0 };
    const trip = { thrown: 0 };
    const { world, service, add } = setup(
      OPEN,
      CORE,
      clockCalls,
      (over) =>
        new DrizzleAssessmentUnitOfWork(
          {
            // The driver rolls the victim back whole, then rethrows.
            transaction: async (
              callback: (tx: { store: object }) => Promise<unknown>,
            ) => {
              const undo: Array<() => void> = [];
              try {
                return await callback({
                  store: new DeadlockAfterAuditStore(over, undo, trip),
                });
              } catch (error) {
                for (const revert of undo.reverse()) revert();
                throw error;
              }
            },
          } as unknown as DrizzleDB,
          () => OPEN,
        ),
    );
    add(5001);

    const summary = await service.validate(
      assessorA(),
      1,
      5001,
      check([CORE[0], NON_CORE]),
      RID,
    );

    expect(trip.thrown).toBe(1);
    expect(summary.status).toBe('pending');
    // The clock is read once, outside the retry: both runs write the same instant.
    expect(clockCalls.count).toBe(1);
    expect(world.writeLog.filter((w) => w === 'insertAudit')).toHaveLength(2);
    expect(world.audits).toEqual([
      {
        assessmentId: world.assessments[0]!.id,
        actorId: 10,
        action: 'validate',
        fieldKeys: [CORE[0], NON_CORE],
        commentId: null,
        requestId: RID,
        at: OPEN,
      },
    ]);
    expect(world.assessments).toHaveLength(1);
    expect(world.validations).toEqual([
      { assessmentId: world.assessments[0]!.id, fieldKey: CORE[0], validated: true },
      { assessmentId: world.assessments[0]!.id, fieldKey: NON_CORE, validated: true },
    ]);
  });
});

describe('FR-18: the release is dispatched after the end commits (DD-5, NFR-6)', () => {
  // One core field green, the two grey ones commented: Finish ends it `returned` (OQ-9).
  const GREY_COMMENTED = {
    green: [CORE[0]],
    comments: [{ fieldKey: CORE[1] }, { fieldKey: CORE[2] }],
  };
  const counting = () => {
    const dispatch = vi.fn(() =>
      Promise.resolve({ attempted: 0, sent: 0, refused: 0, stillPending: 0 }),
    );
    return { dispatch, dispatcher: { dispatch } satisfies ReleaseDispatcher };
  };

  it('a finish dispatches once, after the transaction committed', async () => {
    const { dispatch, dispatcher } = counting();
    const { world, service, add, seed } = setup(
      OPEN,
      CORE,
      { count: 0 },
      (w) => new InMemoryAssessmentUnitOfWork(w),
      dispatcher,
    );
    seed(add(5001), GREY_COMMENTED);
    dispatch.mockImplementation(() => {
      // The release row is committed when the dispatch starts.
      expect(world.releases).toHaveLength(1);
      return Promise.resolve({
        attempted: 1,
        sent: 1,
        refused: 0,
        stillPending: 0,
      });
    });

    await service.finish(assessorA(), 1, 5001, RID);

    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('the write that completes the core dispatches once; a write that ends nothing, and a refused finish, dispatch nothing', async () => {
    const { dispatch, dispatcher } = counting();
    const { service, add, seed } = setup(
      OPEN,
      CORE,
      { count: 0 },
      (w) => new InMemoryAssessmentUnitOfWork(w),
      dispatcher,
    );
    seed(add(5001), { green: [CORE[0], CORE[1]] });

    await service.validate(assessorA(), 1, 5001, check([NON_CORE]), RID);
    expect(dispatch).not.toHaveBeenCalled();

    await service.validate(assessorA(), 1, 5001, check([CORE[2]]), RID);
    expect(dispatch).toHaveBeenCalledTimes(1);

    await failure(service.finish(assessorA(), 1, 5001, RID));
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('answers the end before the feed resolves: a dispatch that never settles does not hold the request (NFR-6)', async () => {
    const dispatch = vi.fn(() => new Promise<never>(() => undefined));
    const { world, service, add, seed } = setup(
      OPEN,
      CORE,
      { count: 0 },
      (w) => new InMemoryAssessmentUnitOfWork(w),
      { dispatch },
    );
    seed(add(5001), GREY_COMMENTED);

    const answered = await Promise.race([
      service.finish(assessorA(), 1, 5001, RID),
      new Promise<'hung'>((resolve) => setTimeout(() => resolve('hung'), 200)),
    ]);

    expect(answered).toMatchObject({ status: 'returned' });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(world.releases).toHaveLength(1);
  });

  it('a dispatch that rejects is caught and logged: the end is still answered, and nothing is unhandled', async () => {
    const dispatch = vi.fn(() => Promise.reject(new Error('boom')));
    const { service, add, seed } = setup(
      OPEN,
      CORE,
      { count: 0 },
      (w) => new InMemoryAssessmentUnitOfWork(w),
      { dispatch },
    );
    seed(add(5001), GREY_COMMENTED);
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);

    const summary = await service.finish(assessorA(), 1, 5001, RID);
    await new Promise((resolve) => setTimeout(resolve, 20));
    process.off('unhandledRejection', unhandled);

    expect(summary.status).toBe('returned');
    expect(unhandled).not.toHaveBeenCalled();
  });
});
