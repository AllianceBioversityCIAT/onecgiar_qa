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
import type { IdempotencyHandle } from '../common/idempotency/idempotency.context.js';
import type { FeedLabels } from '../ingestion/results-feed.port.js';
import { AuthorizationService } from '../users/authorization.service.js';
import type { AssignmentView } from '../users/authorization.service.js';
import { CatalogService } from '../users/catalogs/catalog.service.js';
import type { AuthenticatedUser } from '../users/current-user.cache.js';
import { FakeSnapshotStore } from '../../test/support/fake-snapshot-store.js';
import {
  FakeFieldConfigEffective,
  InMemoryAssessmentStore,
  InMemoryAssessmentUnitOfWork,
  InMemoryAssessmentWorld,
  InMemoryTimelineLoads,
  InMemoryWorklistStore,
  type FakeMembership,
} from '../../test/support/in-memory-assessment.js';
import { runRealLoad } from '../../test/support/real-load-writer.js';
import { AssessmentService } from './assessment.service.js';
import { storedLength, VALUE_COPY_MAX_BYTES } from './comment-value-copy.js';
import type { WorklistStep } from './worklist.store.js';

// Comment create and withdraw over the fake unit of work (T-10 part B; FR-2,
// FR-11, FR-13, FR-16, FR-19, FR-21, NFR-4, NFR-7; design 5, 6, 7.5, 7.7, DD-8,
// P-17). Expected values come from the scenarios of requirements.md and are
// written out. The snapshots are written by the REAL load runner, so every
// `snapshot_sk` is the writer's own key. The clock of every test is pinned.

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
const TITLE = 'general.title'; // Assessed, no control list
const PROGRAM = 'general.primary_program'; // Assessed, control list `initiatives`
const OTHER = applicable.find((k) => ![TITLE, PROGRAM].includes(k))!;
const VIEW_ONLY = 'general.description';
const HIDDEN = applicable[applicable.length - 1]!;

const items = (): ConfigItem[] =>
  applicable.map((fieldKey) => ({
    resultTypeKey: 'policy_change',
    fieldKey,
    visibility: [TITLE, PROGRAM, OTHER].includes(fieldKey)
      ? 'assessed'
      : fieldKey === HIDDEN
        ? 'hidden'
        : 'view_only',
    isCore: false,
    isAiInput: false,
  }));

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
  nickname: string | null = null,
): AuthenticatedUser =>
  ({
    id,
    email: `user${id}@example.org`,
    firstName: 'First',
    lastName: 'Last',
    nickname,
    authSource: 'custom',
    isActive: true,
    assignments,
    programScope,
    exclusions: [],
  }) as AuthenticatedUser;
const assessor = (id: number, nickname: string, programs = [1]) =>
  userOf(id, [assignment('ASSESSOR', 'policy_change')], programs, nickname);
const assessorA = () => assessor(10, 'Ana');
const assessorB = () => assessor(11, 'Beto');
// Granted like A, but assigned to no timeline of the world.
const outsider = () => assessor(12, 'Olga');
const admin = () => userOf(99, [assignment('ADMIN', null)], [], 'Ada');

const minute = (value: string) => value as RomeMinute;
const step = (
  position: number,
  audience: WorklistStep['audience'],
  opensAt: string,
  closesAt: string,
): WorklistStep => ({
  position,
  name: `Step ${position}`,
  audience,
  opensAt: minute(opensAt),
  closesAt: minute(closesAt),
});
// Step 1 09:00 to 17:30 Rome (CET, UTC+1), then a day with no step open, then step 2.
const STEPS: WorklistStep[] = [
  step(1, 'assessors', '2026-11-12T09:00', '2026-11-20T17:30'),
  step(2, 'programs', '2026-11-23T09:00', '2026-11-27T17:30'),
  step(3, 'lead_assessors', '2026-12-01T00:00', '2026-12-05T23:59'),
];
const IN_STEP_1 = new Date('2026-11-13T10:00:00Z');
const IN_STEP_2 = new Date('2026-11-24T10:00:00Z');
const BETWEEN = new Date('2026-11-21T10:00:00Z');
const BEFORE_ALL = new Date('2026-11-10T10:00:00Z');
const AFTER_ALL = new Date('2026-12-20T10:00:00Z');

let nextId = 1;
function setup(
  now: Date = IN_STEP_1,
  clockCalls: { count: number } = { count: 0 },
) {
  const world = new InMemoryAssessmentWorld();
  const snapshots = new FakeSnapshotStore();
  world.timelines.push({
    id: 1,
    name: 'Official',
    kind: 'official',
    steps: STEPS,
  });
  world.timelineUsers.push(
    { timelineId: 1, userId: 10, roleCode: 'ASSESSOR' },
    { timelineId: 1, userId: 11, roleCode: 'ASSESSOR' },
  );
  world.users.push(
    { id: 10, nickname: 'Ana' },
    { id: 11, nickname: 'Beto' },
    { id: 99, nickname: 'Ada' },
  );
  world.fieldConfigItems['policy_change'] = items();
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
      listSciencePrograms: () => Promise.resolve([]),
      listResultTypes: () => Promise.resolve([]),
    } as unknown as CatalogService,
    new AuthorizationService(),
    () => {
      clockCalls.count += 1;
      return now;
    },
    new InMemoryAssessmentUnitOfWork(world),
  );
  /**
   * A membership of timeline 1 whose snapshot the REAL LoadRunner wrote (a load
   * id of its own per call, so two memberships of one result hold two snapshots
   * with two keys). The key kept on the membership is the runner's.
   */
  const add = async (
    resultCode: number,
    values: Record<string, unknown>,
    extra: Partial<FakeMembership> = {},
    labels?: FeedLabels,
  ): Promise<FakeMembership> => {
    const id = nextId++;
    const real = await runRealLoad(
      [
        {
          resultId: resultCode - 4000,
          values,
          resultTypeKey: 'policy_change',
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
      title: null,
      programId: 1,
      resultTypeKey: 'policy_change',
      snapshotSk: written.snapshotSk,
      ...extra,
    };
    world.memberships.push(membership);
    return membership;
  };
  return { world, service, snapshots, add, clockCalls };
}

/** What the filter and the interceptor would send: status and body of an HTTP exception. */
async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    const http = error as {
      getStatus?: () => number;
      getResponse?: () => unknown;
    };
    return { status: http.getStatus?.(), body: http.getResponse?.() };
  }
  throw new Error('expected a refusal');
}

const RID = 'req-1';
const say = (fieldKey: string, body = 'Please add the evidence link') => ({
  fieldKey,
  body,
});
const handle = (key: string): IdempotencyHandle => ({
  reservation: { actorId: 10, key, ownerToken: 'owner-1' },
  outcome: 'none',
});

/** Nothing was stored by a refusal: no comment, event, audit row, mark or assessment. */
function expectNothingStored(world: InMemoryAssessmentWorld) {
  expect(world.comments).toEqual([]);
  expect(world.commentEvents).toEqual([]);
  expect(world.audits).toEqual([]);
  expect(world.marks).toEqual([]);
  expect(world.assessments).toEqual([]);
}

describe('FR-11 Value at the time of writing: the membership snapshot, never the result latest', () => {
  // The Disqualifier of T-10: two memberships of ONE result with DIFFERENT titles.
  async function twoRounds() {
    const ctx = setup();
    const round1 = await ctx.add(5001, { [TITLE]: 'Old title' }, { round: 1 });
    const round2 = await ctx.add(5001, { [TITLE]: 'New title' }, { round: 2 });
    return { ...ctx, round1, round2 };
  }

  it('the fixture holds two memberships of one result, two snapshot keys and two titles', async () => {
    const { round1, round2, snapshots } = await twoRounds();
    expect(round1.resultCode).toBe(round2.resultCode);
    expect(round1.snapshotSk).not.toBe(round2.snapshotSk);
    const history = await snapshots.history(5001);
    expect(history).toHaveLength(2);
    expect(
      history.map((s) => String(s.values[TITLE])).sort((x, y) => x.localeCompare(y)),
    ).toEqual([
      'New title',
      'Old title',
    ]);
    // The latest snapshot of the result is the round-2 one: the wrong source.
    expect(history[history.length - 1]!.values[TITLE]).toBe('New title');
  });

  it('A comments on a round-1 title and the comment keeps "Old title", after the round-2 membership exists', async () => {
    const { service, world } = await twoRounds();

    const comment = await service.comment(
      assessorA(),
      1,
      5001,
      say(TITLE),
      RID,
    );

    expect(comment.valueCopy).toEqual({ value: 'Old title' });
    expect(world.comments).toHaveLength(1);
    expect(world.comments[0]!.valueCopy).toEqual({ value: 'Old title' });
    expect(world.comments[0]!.round).toBe(1);
  });

  it('shows the labels the snapshot had, only those of the lists the field names', async () => {
    const { service, add } = setup();
    await add(
      5002,
      { [PROGRAM]: 3, [TITLE]: 'T' },
      {},
      { initiatives: { '3': 'SP03 Apple' }, centers: { '1': 'X' } },
    );

    const comment = await service.comment(
      assessorA(),
      1,
      5002,
      say(PROGRAM),
      RID,
    );

    expect(comment.valueCopy).toEqual({
      value: 3,
      labels: { initiatives: { '3': 'SP03 Apple' } },
    });
  });

  it('keeps the ids when the snapshot had no labels (no labels key)', async () => {
    const { service, add } = setup();
    await add(5003, { [PROGRAM]: 3 });

    const comment = await service.comment(
      assessorA(),
      1,
      5003,
      say(PROGRAM),
      RID,
    );

    expect(comment.valueCopy).toEqual({ value: 3 });
    expect(comment.valueTruncated).toBe(false);
  });

  it('copies null for an Assessed field the snapshot lacks', async () => {
    const { service, add } = setup();
    await add(5004, { [TITLE]: 'T' });
    const comment = await service.comment(
      assessorA(),
      1,
      5004,
      say(OTHER),
      RID,
    );
    expect(comment.valueCopy).toEqual({ value: null });
  });
});

describe('NFR-7: a value over 64 KiB is stored cut, with the flag', () => {
  it('stores a prefix that fits and sets value_truncated, in the row and in the answer', async () => {
    const { service, add, world } = setup();
    const huge = 'x'.repeat(200_000);
    await add(5001, { [TITLE]: huge });

    const comment = await service.comment(
      assessorA(),
      1,
      5001,
      say(TITLE),
      RID,
    );

    expect(comment.valueTruncated).toBe(true);
    expect(world.comments[0]!.valueTruncated).toBe(true);
    const stored = world.comments[0]!.valueCopy!;
    expect(storedLength(stored)).toBeLessThanOrEqual(VALUE_COPY_MAX_BYTES);
    expect(huge.startsWith(stored.value as string)).toBe(true);
  });

  it('a small value is stored whole with the flag off', async () => {
    const { service, add, world } = setup();
    await add(5001, { [TITLE]: 'short' });
    const comment = await service.comment(assessorA(), 1, 5001, say(TITLE), RID);
    expect(comment.valueTruncated).toBe(false);
    expect(world.comments[0]!.valueTruncated).toBe(false);
  });
});

describe('FR-11: what is stored, and FR-21: one audit row, no body', () => {
  it('stores an open comment with the author, step, round and time, and answers it', async () => {
    const { service, add, world } = setup(new Date('2026-11-13T10:00:00.789Z'));
    await add(5001, { [TITLE]: 'A title' });

    const comment = await service.comment(
      assessorA(),
      1,
      5001,
      say(TITLE, 'Check the wording'),
      RID,
    );

    expect(comment).toEqual({
      id: 7000,
      fieldKey: TITLE,
      author: { id: 10, nickname: 'Ana' },
      body: 'Check the wording',
      state: 'open',
      stepPosition: 1,
      round: 1,
      valueCopy: { value: 'A title' },
      valueTruncated: false,
      // Whole seconds: the column keeps seconds, so the answer is what a re-read gives.
      createdAt: '2026-11-13T10:00:00.000Z',
      withdrawnAt: null,
    });
    expect(world.comments[0]).toMatchObject({
      id: 7000,
      assessmentId: 1000,
      authorId: 10,
      state: 'open',
      fieldKey: TITLE,
      body: 'Check the wording',
      stepPosition: 1,
      round: 1,
    });
  });

  it('writes one comment event (null to open, the author role) and one comment_add audit row with ids and keys only', async () => {
    const { service, add, world } = setup();
    await add(5001, { [TITLE]: 'Secret value' });

    await service.comment(assessorA(), 1, 5001, say(TITLE, 'Secret body'), RID);

    expect(world.commentEvents).toEqual([
      {
        commentId: 7000,
        actorId: 10,
        actorRole: 'ASSESSOR',
        fromState: null,
        toState: 'open',
        at: IN_STEP_1,
      },
    ]);
    expect(world.audits).toEqual([
      {
        assessmentId: 1000,
        actorId: 10,
        action: 'comment_add',
        fieldKeys: [TITLE],
        commentId: 7000,
        requestId: RID,
        at: IN_STEP_1,
      },
    ]);
    const stored = JSON.stringify([world.audits, world.commentEvents]);
    expect(stored).not.toContain('Secret');
  });

  it('creates the assessment row on the first comment, pinning the version and the creator; a second comment reuses it', async () => {
    const { service, add, world } = setup();
    const membership = await add(5001, { [TITLE]: 'T' });
    world.effectiveVersions = [4];
    // Version 4 is what the first comment pins; the second reads ITS items.
    world.versionItems[4] = { policy_change: items() };

    await service.comment(assessorA(), 1, 5001, say(TITLE), RID);
    await service.comment(assessorB(), 1, 5001, say(OTHER), 'req-2');

    expect(world.assessments).toHaveLength(1);
    expect(world.assessments[0]).toMatchObject({
      id: 1000,
      membershipId: membership.id,
      stepPosition: 1,
      status: 'pending',
      fieldConfigVersion: 4,
      createdBy: 10,
      roleCode: 'ASSESSOR',
    });
    expect(world.comments.map((c) => [c.authorId, c.assessmentId])).toEqual([
      [10, 1000],
      [11, 1000],
    ]);
  });

  it('a comment does not touch the validations', async () => {
    const { service, add, world } = setup();
    await add(5001, { [TITLE]: 'T' });
    await service.comment(assessorA(), 1, 5001, say(TITLE), RID);
    expect(world.validations).toEqual([]);
  });
});

describe('FR-11 Comment on a non-assessed field', () => {
  it.each([
    ['a View only field', VIEW_ONLY],
    ['a Hidden field', HIDDEN],
    ['a key that is not in the catalog', 'no.such_field'],
  ])('400 VALIDATION_FAILED on fieldKey for %s, and nothing is stored', async (_label, key) => {
    const { service, add, world } = setup();
    await add(5001, { [TITLE]: 'T' });

    const refused = await refusal(
      service.comment(assessorA(), 1, 5001, say(key), RID),
    );

    expect(refused).toEqual({
      status: 400,
      body: {
        code: 'VALIDATION_FAILED',
        message: expect.any(String),
        fields: [
          {
            field: 'fieldKey',
            code: 'INVALID',
            message: 'This value is not valid.',
          },
        ],
      },
    });
    // The key the caller sent is not echoed back.
    expect(JSON.stringify(refused.body)).not.toContain(key);
    expectNothingStored(world);
    expect(world.transactions).toBe(0);
  });

  it('judges the key by the PINNED version, not the one the timeline resolves to now', async () => {
    const { service, add, world } = setup();
    const membership = await add(5001, { [TITLE]: 'T' });
    // Pinned version 1 hides the title; today's configuration shows it as Assessed.
    world.versionItems[1] = {
      policy_change: items().map((i) =>
        i.fieldKey === TITLE ? { ...i, visibility: 'hidden' as const } : i,
      ),
    };
    world.assessments.push({
      id: 70,
      membershipId: membership.id,
      stepPosition: 1,
      status: 'pending',
      fieldConfigVersion: 1,
    });

    const refused = await refusal(
      service.comment(assessorA(), 1, 5001, say(TITLE), RID),
    );
    expect(refused.status).toBe(400);
    expect(world.comments).toEqual([]);
  });
});

describe('FR-2: the step window, judged by the injected clock', () => {
  // Step 1 is 09:00 to 17:30 Rome (CET): 08:59 and 17:31 are refused, 09:00 and 17:30 accepted.
  it.each([
    ['08:59 on the opening day', '2026-11-12T07:59:00Z', false],
    ['09:00 on the opening day', '2026-11-12T08:00:00Z', true],
    ['17:30 on the closing day', '2026-11-20T16:30:00Z', true],
    ['17:31 on the closing day', '2026-11-20T16:31:00Z', false],
  ])('a comment at %s', async (_name, instant, accepted) => {
    const { service, add, world } = setup(new Date(instant));
    await add(5001, { [TITLE]: 'T' });
    const run = service.comment(assessorA(), 1, 5001, say(TITLE), RID);
    if (accepted) {
      await run;
      expect(world.comments).toHaveLength(1);
    } else {
      expect(await refusal(run)).toMatchObject({
        status: 409,
        body: { code: 'ASSESSMENT_STEP_CLOSED' },
      });
      expectNothingStored(world);
    }
  });

  it.each([
    ['before every step', BEFORE_ALL],
    ['between step 1 and step 2', BETWEEN],
    ['while step 2 (the programs) is open: an assessor writes in step 1 only', IN_STEP_2],
    ['after every step', AFTER_ALL],
  ])('409 ASSESSMENT_STEP_CLOSED %s', async (_name, at) => {
    const { service, add, world } = setup(at);
    await add(5001, { [TITLE]: 'T' });
    expect(
      await refusal(service.comment(assessorA(), 1, 5001, say(TITLE), RID)),
    ).toMatchObject({ status: 409, body: { code: 'ASSESSMENT_STEP_CLOSED' } });
    expectNothingStored(world);
  });

  it('409 ASSESSMENT_STEP_CLOSED when the timeline has no assessors step at all', async () => {
    const { service, add, world } = setup();
    world.timelines[0]!.steps = STEPS.filter((s) => s.audience !== 'assessors');
    await add(5001, { [TITLE]: 'T' });
    expect(
      await refusal(service.comment(assessorA(), 1, 5001, say(TITLE), RID)),
    ).toMatchObject({ status: 409, body: { code: 'ASSESSMENT_STEP_CLOSED' } });
    expectNothingStored(world);
  });

  it('re-judges the step under the timeline lock with the same minute: a step edited in between refuses and rolls back', async () => {
    const { service, add, world } = setup();
    await add(5001, { [TITLE]: 'T' });
    world.beforeLockTimeline = () => {
      // A timeline edit commits first and closes step 1.
      world.timelines[0]!.steps = STEPS.map((s) =>
        s.position === 1 ? { ...s, closesAt: minute('2026-11-13T09:00') } : s,
      );
    };
    expect(
      await refusal(service.comment(assessorA(), 1, 5001, say(TITLE), RID)),
    ).toMatchObject({ status: 409, body: { code: 'ASSESSMENT_STEP_CLOSED' } });
    expectNothingStored(world);
  });

  it('reads the clock once per comment and once per withdraw', async () => {
    const calls = { count: 0 };
    const { service, add } = setup(IN_STEP_1, calls);
    await add(5001, { [TITLE]: 'T' });
    await service.comment(assessorA(), 1, 5001, say(TITLE), RID);
    expect(calls.count).toBe(1);
    await service.withdraw(assessorA(), 7000, RID);
    expect(calls.count).toBe(2);
  });
});

describe('FR-16 and FR-1: after the end, and who may write', () => {
  it('409 ASSESSMENT_FINISHED once the assessment ended, and nothing is written', async () => {
    const { service, add, world } = setup();
    const membership = await add(5001, { [TITLE]: 'T' });
    world.assessments.push({
      id: 7,
      membershipId: membership.id,
      stepPosition: 1,
      status: 'returned',
    });
    expect(
      await refusal(service.comment(assessorA(), 1, 5001, say(TITLE), RID)),
    ).toMatchObject({ status: 409, body: { code: 'ASSESSMENT_FINISHED' } });
    expect(world.comments).toEqual([]);
    expect(world.commentEvents).toEqual([]);
    expect(world.audits).toEqual([]);
  });

  it('409 ASSESSMENT_FINISHED for an ended membership', async () => {
    const { service, add, world } = setup();
    await add(5001, { [TITLE]: 'T' }, { ended: true, endReason: 'returned' });
    expect(
      await refusal(service.comment(assessorA(), 1, 5001, say(TITLE), RID)),
    ).toMatchObject({ status: 409, body: { code: 'ASSESSMENT_FINISHED' } });
    expect(world.comments).toEqual([]);
  });

  it('reads the status again UNDER the assessment lock: an end that committed after the first read refuses and rolls the comment back', async () => {
    const { service, add, world } = setup();
    const membership = await add(5001, { [TITLE]: 'T' });
    world.assessments.push({
      id: 7,
      membershipId: membership.id,
      stepPosition: 1,
      status: 'pending',
    });
    world.beforeLockAssessment = () => {
      world.assessments[0]!.status = 'quality_assessed';
    };
    expect(
      await refusal(service.comment(assessorA(), 1, 5001, say(TITLE), RID)),
    ).toMatchObject({ status: 409, body: { code: 'ASSESSMENT_FINISHED' } });
    expect(world.comments).toEqual([]);
    expect(world.commentEvents).toEqual([]);
    expect(world.audits).toEqual([]);
  });

  it('403 ASSESSMENT_READ_ONLY for an ADMIN with no reviewer row', async () => {
    const { service, add, world } = setup();
    await add(5001, { [TITLE]: 'T' });
    expect(
      await refusal(service.comment(admin(), 1, 5001, say(TITLE), RID)),
    ).toMatchObject({ status: 403, body: { code: 'ASSESSMENT_READ_ONLY' } });
    expectNothingStored(world);
  });

  it('the same 404 for a missing code, a result outside the scope and a caller with no row', async () => {
    const { service, add, world } = setup();
    await add(5001, { [TITLE]: 'T' });
    const missing = await refusal(
      service.comment(assessorA(), 1, 9999, say(TITLE), RID),
    );
    const outOfProgram = await refusal(
      service.comment(assessor(10, 'Ana', [2]), 1, 5001, say(TITLE), RID),
    );
    const noRow = await refusal(
      service.comment(outsider(), 1, 5001, say(TITLE), RID),
    );
    expect(missing).toMatchObject({
      status: 404,
      body: { code: 'ASSESSMENT_NOT_FOUND' },
    });
    expect(outOfProgram).toEqual(missing);
    expect(noRow).toEqual(missing);
    expectNothingStored(world);
  });

  it('an out-of-scope caller on a FINISHED assessment gets the same 404 as a missing code, not the 409', async () => {
    const { service, add, world } = setup();
    const membership = await add(5001, { [TITLE]: 'T' });
    world.assessments.push({
      id: 7,
      membershipId: membership.id,
      stepPosition: 1,
      status: 'returned',
    });
    const missing = await refusal(
      service.comment(assessorA(), 1, 9999, say(TITLE), RID),
    );
    const outOfScope = await refusal(
      service.comment(assessor(10, 'Ana', [2]), 1, 5001, say(TITLE), RID),
    );
    expect(outOfScope).toEqual(missing);
    expect(outOfScope.status).toBe(404);
  });
});

describe('design 5: the lock order, and P-17: the idempotency mark inside the transaction', () => {
  it('first comment: timeline FOR SHARE, create the assessment, lock it, then comment, event, audit', async () => {
    const { service, add, world } = setup();
    await add(5001, { [TITLE]: 'T' });
    await service.comment(assessorA(), 1, 5001, say(TITLE), RID);
    expect(world.writeLog).toEqual([
      'lockTimelineShared',
      'ensureAssessment',
      'lockAssessment',
      'insertComment',
      'insertCommentEvent',
      'insertAudit',
    ]);
    expect(world.transactions).toBe(1);
  });

  it('a later comment does not create the assessment again', async () => {
    const { service, add, world } = setup();
    await add(5001, { [TITLE]: 'T' });
    await service.comment(assessorA(), 1, 5001, say(TITLE), RID);
    world.writeLog = [];
    await service.comment(assessorA(), 1, 5001, say(OTHER), 'req-2');
    expect(world.writeLog).toEqual([
      'lockTimelineShared',
      'lockAssessment',
      'insertComment',
      'insertCommentEvent',
      'insertAudit',
    ]);
  });

  it('a keyed create marks the key executed with the comment id, in the same transaction and last', async () => {
    const { service, add, world } = setup();
    await add(5001, { [TITLE]: 'T' });
    await service.comment(
      assessorA(),
      1,
      5001,
      say(TITLE),
      RID,
      handle('key-1'),
    );
    expect(world.marks).toEqual([{ key: 'key-1', targetId: 7000 }]);
    expect(world.writeLog[world.writeLog.length - 1]).toBe('markExecuted');
    expect(world.transactions).toBe(1);
  });

  it('a create without an Idempotency-Key marks nothing', async () => {
    const { service, add, world } = setup();
    await add(5001, { [TITLE]: 'T' });
    await service.comment(assessorA(), 1, 5001, say(TITLE), RID);
    expect(world.marks).toEqual([]);
    expect(world.writeLog).not.toContain('markExecuted');
  });

  it('a refusal under the lock rolls the mark back with the comment', async () => {
    const { service, add, world } = setup();
    const membership = await add(5001, { [TITLE]: 'T' });
    world.assessments.push({
      id: 7,
      membershipId: membership.id,
      stepPosition: 1,
      status: 'pending',
    });
    world.beforeLockAssessment = () => {
      world.assessments[0]!.status = 'returned';
    };
    await refusal(
      service.comment(assessorA(), 1, 5001, say(TITLE), RID, handle('key-2')),
    );
    expect(world.marks).toEqual([]);
    expect(world.comments).toEqual([]);
  });

  it('replayComment answers the stored comment exactly as the create answered it', async () => {
    const { service, add } = setup(new Date('2026-11-13T10:00:00.789Z'));
    await add(5001, { [TITLE]: 'A title' });
    const created = await service.comment(
      assessorA(),
      1,
      5001,
      say(TITLE),
      RID,
      handle('key-3'),
    );
    expect(await service.replayComment(created.id)).toEqual(created);
  });

  it('replayComment of an id with no comment is a defect (the interceptor answers 503)', async () => {
    const { service } = setup();
    await expect(service.replayComment(424242)).rejects.toThrow(
      /no comment/,
    );
  });
});

describe('NFR-2: statements per comment and per withdraw', () => {
  it('a first comment runs 15 statements, a later one 10, and the key mark adds one', async () => {
    const { service, add, world } = setup();
    await add(5001, { [TITLE]: 'T' });

    world.resetStatements();
    await service.comment(assessorA(), 1, 5001, say(TITLE), RID);
    // timelines, membership, load probe (3) + `effectiveFor` (5) + in the
    // transaction: timeline lock and steps (2), ensure, lock, comment, event, audit (5).
    expect(world.statements).toBe(15);

    world.resetStatements();
    await service.comment(assessorA(), 1, 5001, say(OTHER), 'req-2');
    // 3 reads + the pinned items (1) + lock and steps (2), lock, comment, event, audit (4).
    expect(world.statements).toBe(10);

    world.resetStatements();
    await service.comment(
      assessorA(),
      1,
      5001,
      say(PROGRAM),
      'req-3',
      handle('key-4'),
    );
    expect(world.statements).toBe(11);
  });

  it('a withdraw runs 10 statements', async () => {
    const { service, add, world } = setup();
    await add(5001, { [TITLE]: 'T' });
    await service.comment(assessorA(), 1, 5001, say(TITLE), RID);

    world.resetStatements();
    await service.withdraw(assessorA(), 7000, 'req-2');
    // the comment with its assessment and membership (1), timelines (1),
    // membership (1), load probe (1); timeline lock and steps (2), assessment
    // lock (1), conditional update (1), event (1), audit (1).
    expect(world.statements).toBe(10);
  });
});

describe('FR-13: withdraw your own comment', () => {
  async function withComment(at: Date = IN_STEP_1) {
    const ctx = setup(at);
    const membership = await ctx.add(5001, { [TITLE]: 'T' });
    // A comment of A written earlier, whatever the clock of the withdraw.
    ctx.world.assessments.push({
      id: 70,
      membershipId: membership.id,
      stepPosition: 1,
      status: 'pending',
    });
    ctx.world.comments.push({
      id: 700,
      assessmentId: 70,
      authorId: 10,
      state: 'open',
      fieldKey: TITLE,
      body: 'Secret body',
      createdAt: new Date('2026-11-13T09:00:00.000Z'),
      valueCopy: { value: 'Secret value' },
    });
    return ctx;
  }

  it('the author withdraws an open comment: it answers withdrawn, with the time, and the row is updated', async () => {
    const { service, world } = await withComment();

    const comment = await service.withdraw(assessorA(), 700, RID);

    expect(comment).toEqual({
      id: 700,
      fieldKey: TITLE,
      author: { id: 10, nickname: 'Ana' },
      body: 'Secret body',
      state: 'withdrawn',
      stepPosition: 1,
      round: 1,
      valueCopy: { value: 'Secret value' },
      valueTruncated: false,
      createdAt: '2026-11-13T09:00:00.000Z',
      withdrawnAt: '2026-11-13T10:00:00.000Z',
    });
    expect(world.comments[0]).toMatchObject({ state: 'withdrawn' });
  });

  it('writes one comment event (open to withdrawn, the actor role) and one comment_withdraw audit row with no body or value', async () => {
    const { service, world } = await withComment();
    await service.withdraw(assessorA(), 700, RID);
    expect(world.commentEvents).toEqual([
      {
        commentId: 700,
        actorId: 10,
        actorRole: 'ASSESSOR',
        fromState: 'open',
        toState: 'withdrawn',
        at: IN_STEP_1,
      },
    ]);
    expect(world.audits).toEqual([
      {
        assessmentId: 70,
        actorId: 10,
        action: 'comment_withdraw',
        fieldKeys: [TITLE],
        commentId: 700,
        requestId: RID,
        at: IN_STEP_1,
      },
    ]);
    expect(JSON.stringify([world.audits, world.commentEvents])).not.toContain(
      'Secret',
    );
  });

  it('Not someone else comment: B gets 403 ASSESSMENT_NOT_COMMENT_AUTHOR and nothing changes', async () => {
    const { service, world } = await withComment();
    expect(await refusal(service.withdraw(assessorB(), 700, RID))).toMatchObject({
      status: 403,
      body: { code: 'ASSESSMENT_NOT_COMMENT_AUTHOR' },
    });
    expect(world.comments[0]!.state).toBe('open');
    expect(world.commentEvents).toEqual([]);
    expect(world.audits).toEqual([]);
    expect(world.transactions).toBe(0);
  });

  it('a second withdraw by A answers 409 ASSESSMENT_COMMENT_NOT_OPEN and adds no event or audit row', async () => {
    const { service, world } = await withComment();
    await service.withdraw(assessorA(), 700, RID);
    expect(
      await refusal(service.withdraw(assessorA(), 700, 'req-2')),
    ).toMatchObject({
      status: 409,
      body: { code: 'ASSESSMENT_COMMENT_NOT_OPEN' },
    });
    expect(world.commentEvents).toHaveLength(1);
    expect(world.audits).toHaveLength(1);
  });

  it('an ADMIN who did not write it gets 403 ASSESSMENT_NOT_COMMENT_AUTHOR', async () => {
    const { service, world } = await withComment();
    expect(await refusal(service.withdraw(admin(), 700, RID))).toMatchObject({
      status: 403,
      body: { code: 'ASSESSMENT_NOT_COMMENT_AUTHOR' },
    });
    expect(world.comments[0]!.state).toBe('open');
  });

  it('the same 404 for a comment that does not exist and one outside the caller scope', async () => {
    const { service, world } = await withComment();
    const missing = await refusal(service.withdraw(assessorA(), 424242, RID));
    const outOfProgram = await refusal(
      service.withdraw(assessor(10, 'Ana', [2]), 700, RID),
    );
    const noRow = await refusal(service.withdraw(outsider(), 700, RID));
    expect(missing).toMatchObject({
      status: 404,
      body: { code: 'ASSESSMENT_NOT_FOUND' },
    });
    expect(outOfProgram).toEqual(missing);
    expect(noRow).toEqual(missing);
    expect(world.comments[0]!.state).toBe('open');
  });

  describe('OQ-8: while the program has not answered and step 1 or step 2 is open', () => {
    it.each([
      ['step 1 is open', IN_STEP_1, true],
      ['step 2 is open', IN_STEP_2, true],
      ['before every step', BEFORE_ALL, false],
      ['between the steps', BETWEEN, false],
      ['after every step', AFTER_ALL, false],
    ])('%s', async (_name, at, allowed) => {
      const { service, world } = await withComment(at);
      const run = service.withdraw(assessorA(), 700, RID);
      if (allowed) {
        expect((await run).state).toBe('withdrawn');
      } else {
        expect(await refusal(run)).toMatchObject({
          status: 409,
          body: { code: 'ASSESSMENT_STEP_CLOSED' },
        });
        expect(world.comments[0]!.state).toBe('open');
        expect(world.commentEvents).toEqual([]);
        expect(world.audits).toEqual([]);
      }
    });

    it.each([
      'clarification_requested',
      'accepted',
      'accepted_with_comment',
      'disagreed',
    ] as const)('409 ASSESSMENT_COMMENT_NOT_OPEN once the program answered (%s)', async (state) => {
      const { service, world } = await withComment();
      world.comments[0]!.state = state;
      expect(await refusal(service.withdraw(assessorA(), 700, RID))).toMatchObject(
        { status: 409, body: { code: 'ASSESSMENT_COMMENT_NOT_OPEN' } },
      );
      expect(world.comments[0]!.state).toBe(state);
      expect(world.commentEvents).toEqual([]);
      expect(world.audits).toEqual([]);
    });

    it('a program answer that commits between the read and the lock refuses and rolls back', async () => {
      const { service, world } = await withComment();
      world.beforeLockAssessment = () => {
        world.comments[0]!.state = 'accepted';
      };
      expect(await refusal(service.withdraw(assessorA(), 700, RID))).toMatchObject(
        { status: 409, body: { code: 'ASSESSMENT_COMMENT_NOT_OPEN' } },
      );
      expect(world.comments[0]!.state).toBe('accepted');
      expect(world.commentEvents).toEqual([]);
      expect(world.audits).toEqual([]);
    });

    it('re-judges the window under the timeline lock with the same minute', async () => {
      const { service, world } = await withComment();
      world.beforeLockTimeline = () => {
        world.timelines[0]!.steps = STEPS.map((s) =>
          s.position === 1 ? { ...s, closesAt: minute('2026-11-13T09:00') } : s,
        );
      };
      expect(await refusal(service.withdraw(assessorA(), 700, RID))).toMatchObject(
        { status: 409, body: { code: 'ASSESSMENT_STEP_CLOSED' } },
      );
      expect(world.comments[0]!.state).toBe('open');
    });
  });

  it('a withdraw AFTER the assessment ended is allowed, and does not move the status', async () => {
    const { service, world } = await withComment();
    world.assessments[0]!.status = 'quality_assessed';

    const comment = await service.withdraw(assessorA(), 700, RID);

    expect(comment.state).toBe('withdrawn');
    expect(world.assessments[0]!.status).toBe('quality_assessed');
    expect(world.audits.map((a) => a.action)).toEqual(['comment_withdraw']);
  });

  it('keeps the lock order: timeline FOR SHARE, the assessment row, then the comment, its event and the audit row', async () => {
    const { service, world } = await withComment();
    await service.withdraw(assessorA(), 700, RID);
    expect(world.writeLog).toEqual([
      'lockTimelineShared',
      'lockAssessment',
      'withdrawComment',
      'insertCommentEvent',
      'insertAudit',
    ]);
  });

  it('two withdraws at once: one wins, the other gets 409, and there is one event and one audit row', async () => {
    const { service, world } = await withComment();
    const results = await Promise.allSettled([
      service.withdraw(assessorA(), 700, 'req-a'),
      service.withdraw(assessorA(), 700, 'req-b'),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    const rejected = results.find(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    )!;
    expect(
      (rejected.reason as { getResponse: () => unknown }).getResponse(),
    ).toMatchObject({ code: 'ASSESSMENT_COMMENT_NOT_OPEN' });
    expect(world.commentEvents).toHaveLength(1);
    expect(world.audits).toHaveLength(1);
    expect(world.comments[0]!.state).toBe('withdrawn');
  });
});
