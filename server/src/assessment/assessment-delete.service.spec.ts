// @akili-spec escalation/round-2
import { readFileSync } from 'node:fs';
import { Logger } from '@nestjs/common';
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
import { FakeSnapshotStore } from '../../test/support/fake-snapshot-store.js';
import {
  FakeFieldConfigEffective,
  InMemoryAssessmentStore,
  InMemoryAssessmentUnitOfWork,
  noReleaseDispatch,
  InMemoryAssessmentWorld,
  InMemoryTimelineLoads,
  InMemoryWorklistStore,
  type FakeComment,
} from '../../test/support/in-memory-assessment.js';
import { AssessmentService } from './assessment.service.js';
import type { WorklistStep } from './worklist.store.js';

// Delete another reviewer's comment (P2-3912 T-10; requirements FR-10, FR-11,
// OQ-8): the Lead hides a round-1 comment of THIS result, or another Lead's
// round-2 comment, never its own and never one the program answered. The row
// stays (soft delete), the history says who and when, and a decision on it goes
// with it. Expected values are written out from the scenarios.

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
const CORE = ASSESSED.slice(0, 4);

const items = (): ConfigItem[] =>
  applicable.map((fieldKey) => ({
    resultTypeKey: 'policy_change',
    fieldKey,
    visibility: ASSESSED.includes(fieldKey) ? 'assessed' : 'hidden',
    isCore: CORE.includes(fieldKey),
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
const userOf = (id: number, roleCode: string): AuthenticatedUser =>
  ({
    id,
    email: `user${id}@example.org`,
    firstName: 'First',
    lastName: 'Last',
    nickname: null,
    authSource: 'custom',
    isActive: true,
    assignments: [assignment(roleCode)],
    programScope: [1],
    exclusions: [],
  }) as AuthenticatedUser;
const lead = () => userOf(20, 'LEAD_ASSESSOR');
const assessor = () => userOf(10, 'ASSESSOR');
const admin = () => userOf(99, 'ADMIN');

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
    opensAt: minute('2026-12-01T00:00'),
    closesAt: minute('2026-12-31T23:59'),
  },
  {
    position: 3,
    name: 'Step 3',
    audience: 'lead_assessors',
    opensAt: minute('2027-02-01T00:00'),
    closesAt: minute('2027-02-28T23:59'),
  },
];
const STEP_THREE_OPEN = new Date('2027-02-10T10:00:00Z');
const AFTER_STEP_THREE = new Date('2027-03-05T10:00:00Z');
const RID = 'req-1';
const WHY = "The program's figure matches the evidence";

const comment = (
  id: number,
  fieldKey: string,
  state: FakeComment['state'] = 'disagreed',
  over: Partial<FakeComment> = {},
): FakeComment => ({
  id,
  assessmentId: 1,
  authorId: 10,
  state,
  fieldKey,
  body: `Round-1 comment ${id}`,
  ...over,
});

/**
 * Result 5001 in two rounds: the round-1 membership (1) ended `returned` with
 * its step-1 assessment (id 1), the round-2 membership (2) of the Lead with no
 * assessment yet; and result 5002 with its own round-1 assessment (id 3) and
 * comment 7100. By default CORE[0] and CORE[1] carry a `disagreed` comment and
 * CORE[2] and CORE[3] were green and uncommented: carried greens.
 */
function setup(
  options: {
    now?: Date;
    comments?: FakeComment[];
    greens?: string[];
    changedFields?: string[] | null;
  } = {},
) {
  const world = new InMemoryAssessmentWorld();
  world.timelines.push({
    id: 1,
    name: 'Official',
    kind: 'official',
    steps: STEPS,
  });
  world.timelineUsers.push(
    { timelineId: 1, userId: 10, roleCode: 'ASSESSOR' },
    { timelineId: 1, userId: 20, roleCode: 'LEAD_ASSESSOR' },
  );
  world.users.push({ id: 10, nickname: 'Ana' }, { id: 20, nickname: 'Lia' });
  world.fieldConfigItems['policy_change'] = items();
  world.versionItems[1] = { policy_change: items() };
  const base = { timelineId: 1, programId: 1, resultTypeKey: 'policy_change' };
  world.memberships.push(
    {
      ...base,
      id: 1,
      resultCode: 5001,
      title: 'First',
      round: 1,
      ended: true,
      endReason: 'returned',
    },
    {
      ...base,
      id: 2,
      resultCode: 5001,
      title: 'Second',
      round: 2,
      previousMembershipId: 1,
      changedFields: options.changedFields ?? null,
    },
    {
      ...base,
      id: 3,
      resultCode: 5002,
      title: 'Another result',
      round: 1,
      ended: true,
      endReason: 'returned',
    },
  );
  world.assessments.push(
    { id: 1, membershipId: 1, stepPosition: 1, status: 'returned' },
    { id: 3, membershipId: 3, stepPosition: 1, status: 'returned' },
  );
  world.comments.push(
    ...(options.comments ?? [comment(7001, CORE[0]!), comment(7002, CORE[1]!)]),
    comment(7100, CORE[0]!, 'disagreed', { assessmentId: 3 }),
  );
  world.validations.push(
    ...(options.greens ?? [CORE[2]!, CORE[3]!]).map((fieldKey) => ({
      assessmentId: 1,
      fieldKey,
      validated: true,
    })),
  );
  const service = new AssessmentService(
    new InMemoryAssessmentStore(world),
    new InMemoryWorklistStore(world),
    new InMemoryTimelineLoads(world),
    new FakeSnapshotStore(),
    {
      forYear: vi.fn(() => Promise.resolve(catalog)),
    } satisfies FieldCatalogSource,
    new FakeFieldConfigEffective(world),
    {
      listSciencePrograms: () => Promise.resolve([]),
      listResultTypes: () => Promise.resolve([]),
    } as unknown as CatalogService,
    new AuthorizationService(),
    () => options.now ?? STEP_THREE_OPEN,
    new InMemoryAssessmentUnitOfWork(world),
    noReleaseDispatch,
  );
  const decide = (
    commentId: number,
    decision: 'agree_program' | 'escalate',
    body = WHY,
    user = lead(),
  ) => service.decide(user, 1, 5001, commentId, { decision, body }, RID);
  const clear = (commentId: number, user = lead()) =>
    service.clearDecision(user, 1, 5001, commentId, RID);
  const validate = (validated: boolean, fieldKeys: string[]) =>
    service.validate(lead(), 1, 5001, { validated, fieldKeys }, RID);
  const remove = (commentId: number, user = lead()) =>
    service.deleteComment(user, commentId, RID);
  return { world, service, decide, clear, validate, remove };
}

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

const DELETED_AT = '2027-02-10T10:00:00.000Z';
const roundTwoAssessment = (world: InMemoryAssessmentWorld) =>
  world.assessments.find((a) => a.membershipId === 2);
const auditActions = (world: InMemoryAssessmentWorld) =>
  world.audits.map((a) => a.action);
const programAnswer = (world: InMemoryAssessmentWorld, commentId: number) =>
  world.spResponses.push({
    id: 1,
    commentId,
    kind: 'disagree',
    body: 'We disagree',
    responderName: 'Pat Program',
    responderEmail: 'pat.program@example.org',
    programId: 1,
    createdAt: new Date('2026-12-02T09:00:00Z'),
  });
/** The Lead's round-2 assessment, as the first write creates it. */
const addRoundTwoAssessment = (world: InMemoryAssessmentWorld) => {
  if (roundTwoAssessment(world) === undefined) {
    world.assessments.push({
      id: 1000,
      membershipId: 2,
      stepPosition: 3,
      status: 'pending',
    });
  }
};
const written = (world: InMemoryAssessmentWorld) =>
  JSON.stringify([
    world.comments,
    world.commentEvents,
    world.audits,
    world.commentDecisions,
    world.validations,
  ]);

describe('FR-10 Delete', () => {
  it('soft-deletes a round-1 comment of another reviewer: who and when are stored, the state stays, the history and the audit say so', async () => {
    const { world, remove } = setup({
      comments: [comment(7001, CORE[0]!, 'open'), comment(7002, CORE[1]!)],
    });

    const result = await remove(7001);

    const row = world.comments.find((c) => c.id === 7001)!;
    expect(row.deletedAt).toEqual(new Date(DELETED_AT));
    expect(row.deletedBy).toBe(20);
    expect(row.state).toBe('open');
    expect(world.comments.find((c) => c.id === 7002)!.deletedAt ?? null).toBe(
      null,
    );
    expect(result).toMatchObject({
      id: 7001,
      state: 'open',
      deletedAt: DELETED_AT,
      deletedBy: 20,
      withdrawnAt: null,
    });
    expect(world.commentEvents).toEqual([
      {
        commentId: 7001,
        actorId: 20,
        actorRole: 'LEAD_ASSESSOR',
        fromState: 'open',
        toState: 'open',
        at: new Date(DELETED_AT),
      },
    ]);
    expect(auditActions(world)).toEqual(['comment_delete']);
    expect(world.audits[0]).toMatchObject({
      assessmentId: 1000,
      actorId: 20,
      fieldKeys: [CORE[0]],
      commentId: 7001,
    });
  });

  it('keeps the lock order: timeline share, the round-2 assessment, the comment row, then the conditional UPDATE', async () => {
    const { world, remove } = setup();
    await remove(7001);
    expect(world.writeLog.slice(0, 5)).toEqual([
      'lockTimelineShared',
      'ensureAssessment',
      'lockAssessment',
      'lockDecisionTarget',
      'deleteComment',
    ]);
  });

  it("deletes another Lead's round-2 comment on this assessment", async () => {
    const { world, remove } = setup();
    addRoundTwoAssessment(world);
    world.comments.push(
      comment(8001, CORE[0]!, 'open', {
        assessmentId: 1000,
        authorId: 21,
        round: 2,
        stepPosition: 3,
      }),
    );

    const result = await remove(8001);

    expect(result).toMatchObject({ id: 8001, deletedBy: 20 });
    expect(auditActions(world)).toEqual(['comment_delete']);
  });

  it('a deleted comment leaves the thread read; the other comments stay', async () => {
    const { world, remove } = setup();
    await remove(7001);
    const thread = await new InMemoryAssessmentStore(world).findRoundOneThread(
      1,
      'LEAD_ASSESSOR',
    );
    expect(thread.map((row) => row.commentId)).toEqual([7002]);
  });

  it('writes one `delete` log line with ids and fixed words only', async () => {
    const lines: string[] = [];
    vi.spyOn(Logger.prototype, 'log').mockImplementation((line) => {
      lines.push(String(line));
    });
    const { remove } = setup();
    await remove(7001);
    vi.restoreAllMocks();
    expect(lines.map((l) => JSON.parse(l) as unknown)).toEqual([
      expect.objectContaining({
        event: 'assessment',
        action: 'delete',
        outcome: 'ok',
        timelineId: 1,
        membershipId: 2,
        actorId: 20,
      }),
    ]);
    expect(lines.join('\n')).not.toContain('Round-1 comment');
  });
});

describe('FR-10 BUT the comment is not deletable (409 ASSESSMENT_COMMENT_NOT_DELETABLE)', () => {
  const notDeletable = {
    status: 409,
    body: { code: 'ASSESSMENT_COMMENT_NOT_DELETABLE' },
  };

  it('the Lead own comment', async () => {
    const { world, remove } = setup();
    addRoundTwoAssessment(world);
    world.comments.push(
      comment(8001, CORE[0]!, 'open', {
        assessmentId: 1000,
        authorId: 20,
        round: 2,
        stepPosition: 3,
      }),
    );
    const before = written(world);

    expect(await refusal(remove(8001))).toMatchObject(notDeletable);
    expect(written(world)).toBe(before);
  });

  // Disqualifier: the comment MUST carry an `sp_comment_responses` row; the
  // second variant is `open` so only the row can refuse it, not the state.
  it.each([['disagreed'], ['open']] as const)(
    'a %s comment the program already answered (an sp_comment_responses row)',
    async (state) => {
      const { world, remove } = setup({
        comments: [comment(7001, CORE[0]!, state)],
      });
      programAnswer(world, 7001);
      const before = written(world);

      expect(await refusal(remove(7001))).toMatchObject(notDeletable);
      expect(written(world)).toBe(before);
      expect(world.comments[0]!.deletedAt ?? null).toBe(null);
    },
  );

  it('a comment already deleted (a second delete is a conflict, nothing more is written)', async () => {
    const { world, remove } = setup();
    await remove(7001);
    const before = written(world);

    expect(await refusal(remove(7001))).toMatchObject(notDeletable);
    expect(written(world)).toBe(before);
  });

  it('a withdrawn comment: it is already out of every list', async () => {
    const { world, remove } = setup({
      comments: [comment(7001, CORE[0]!, 'withdrawn')],
    });
    const before = written(world);

    expect(await refusal(remove(7001))).toMatchObject(notDeletable);
    expect(written(world)).toBe(before);
  });

  it('a deleted comment cannot be withdrawn by its author afterwards', async () => {
    // Step 1 is open (a round-1 withdraw window); the delete was written by the Lead earlier.
    const { world, service } = setup({
      now: new Date('2026-11-15T10:00:00Z'),
      comments: [
        comment(7001, CORE[0]!, 'open', {
          deletedAt: new Date('2026-11-14T10:00:00Z'),
          deletedBy: 20,
        }),
      ],
    });

    expect(
      await refusal(service.withdraw(assessor(), 7001, RID)),
    ).toMatchObject({
      status: 409,
      body: { code: 'ASSESSMENT_COMMENT_NOT_OPEN' },
    });
    expect(world.comments[0]!.state).toBe('open');
  });
});

describe('FR-10 BUT outside the Lead scope: the 404 that tells nothing', () => {
  it('a missing comment, a result with no round-2 membership of the Lead, a result type outside the Lead, and a non-Lead all get the same body and write nothing', async () => {
    const missing = setup();
    const noMembership = setup();
    const otherType = setup();
    otherType.world.memberships[1]!.resultTypeKey = 'innovation_development';
    // Step 1 is open, so no step refusal comes before the 404 for the round-1 reviewer.
    const reviewer = setup({ now: new Date('2026-11-15T10:00:00Z') });

    const bodies = [
      await refusal(missing.remove(9999)),
      await refusal(noMembership.remove(7100)),
      await refusal(otherType.remove(7001)),
      await refusal(reviewer.remove(7001, assessor())),
    ];

    for (const body of bodies) {
      expect(body).toEqual(bodies[0]);
      expect(body).toMatchObject({
        status: 404,
        body: { code: 'ASSESSMENT_NOT_FOUND' },
      });
    }
    for (const s of [missing, noMembership, otherType, reviewer]) {
      expect(s.world.audits).toEqual([]);
      expect(s.world.commentEvents).toEqual([]);
      expect(
        s.world.comments.every((c) => (c.deletedAt ?? null) === null),
      ).toBe(true);
    }
  });

  it('an ADMIN is read only: 403', async () => {
    const { remove } = setup();
    expect(await refusal(remove(7001, admin()))).toMatchObject({
      status: 403,
      body: { code: 'ASSESSMENT_READ_ONLY' },
    });
  });
});

describe('FR-11 BUT afterwards every delete is refused', () => {
  it('after the Lead review ended: 409 ASSESSMENT_FINISHED and nothing is written', async () => {
    const { world, remove } = setup();
    addRoundTwoAssessment(world);
    roundTwoAssessment(world)!.status = 'escalated';
    const before = written(world);

    expect(await refusal(remove(7001))).toMatchObject({
      status: 409,
      body: { code: 'ASSESSMENT_FINISHED' },
    });
    expect(written(world)).toBe(before);
  });

  it('a membership already ended: 409 ASSESSMENT_FINISHED', async () => {
    const { world, remove } = setup();
    world.memberships[1]!.ended = true;
    world.memberships[1]!.endReason = 'released_qaed';
    expect(await refusal(remove(7001))).toMatchObject({
      status: 409,
      body: { code: 'ASSESSMENT_FINISHED' },
    });
  });

  it('step 3 not open: the existing 409 ASSESSMENT_STEP_CLOSED', async () => {
    const { world, remove } = setup({ now: AFTER_STEP_THREE });
    expect(await refusal(remove(7001))).toMatchObject({
      status: 409,
      body: { code: 'ASSESSMENT_STEP_CLOSED' },
    });
    expect(world.audits).toEqual([]);
  });
});

describe('FR-10 a decision on the deleted comment goes with it (FR-8 cleared)', () => {
  it('an agree_program decision is dropped in the same transaction: its green goes grey, with a decision_clear then the comment_delete audit', async () => {
    const { world, decide, remove } = setup();
    await decide(7001, 'agree_program');
    expect(world.validations).toContainEqual({
      assessmentId: 1000,
      fieldKey: CORE[0],
      validated: true,
    });

    await remove(7001);

    expect(world.commentDecisions).toEqual([]);
    expect(
      world.validations.filter((v) => v.assessmentId === 1000 && v.validated),
    ).toEqual([]);
    expect(auditActions(world)).toEqual([
      'decision_set',
      'decision_clear',
      'comment_delete',
    ]);
    expect(world.audits[1]).toMatchObject({ commentId: 7001 });
  });

  it('an agree on another comment of the field keeps the field green', async () => {
    const { world, decide, remove } = setup({
      comments: [comment(7001, CORE[0]!), comment(7003, CORE[0]!)],
    });
    await decide(7001, 'agree_program');
    await decide(7003, 'agree_program');

    await remove(7001);

    expect(world.commentDecisions.map((d) => d.commentId)).toEqual([7003]);
    expect(
      world.validations.filter((v) => v.assessmentId === 1000 && v.validated),
    ).toEqual([{ assessmentId: 1000, fieldKey: CORE[0], validated: true }]);
  });

  it('an escalate decision is dropped too and the field stays grey', async () => {
    const { world, decide, remove } = setup();
    await decide(7001, 'escalate');

    await remove(7001);

    expect(world.commentDecisions).toEqual([]);
    expect(auditActions(world)).toEqual([
      'decision_set',
      'decision_clear',
      'comment_delete',
    ]);
  });

  it('a comment with no decision writes no decision_clear', async () => {
    const { world, remove } = setup();
    await remove(7001);
    expect(auditActions(world)).toEqual(['comment_delete']);
  });
});

describe('FR-12 a delete that leaves every core field effectively green ends the review', () => {
  it('deleting the only live round-1 comment of a field the assessor greened carries the green: ends quality_assessed, one qaed release, nothing made visible', async () => {
    const { world, remove } = setup({
      comments: [comment(7001, CORE[0]!, 'disagreed')],
      greens: [CORE[0]!, CORE[1]!, CORE[2]!, CORE[3]!],
    });

    await remove(7001);

    expect(roundTwoAssessment(world)).toMatchObject({
      status: 'quality_assessed',
      finishedBy: 20,
    });
    expect(world.releases).toHaveLength(1);
    expect(world.releases[0]).toMatchObject({
      assessmentId: 1000,
      timelineResultId: 2,
      outcome: 'qaed',
      status: 'pending',
    });
    expect(auditActions(world)).toEqual([
      'comment_delete',
      'end_quality_assessed',
    ]);
    expect(world.comments.every((c) => c.visibleToProgramAt == null)).toBe(
      true,
    );
    expect(world.endUpdatesMatched).toBe(1);
  });

  it('a delete that leaves a core field grey does not end the review', async () => {
    const { world, remove } = setup();
    await remove(7001);
    expect(roundTwoAssessment(world)).toMatchObject({ status: 'pending' });
    expect(world.releases).toEqual([]);
  });
});

describe('FR-8 the agree guard ignores a dead escalate (a decision on a deleted comment)', () => {
  it('an agree on a field whose only escalate is on a deleted comment is allowed', async () => {
    const { world, decide } = setup({
      comments: [
        comment(7001, CORE[0]!, 'disagreed', {
          deletedAt: new Date('2027-02-09T08:00:00Z'),
          deletedBy: 20,
        }),
        comment(7003, CORE[0]!),
        comment(7002, CORE[1]!),
      ],
    });
    addRoundTwoAssessment(world);
    world.commentDecisions.push({
      commentId: 7001,
      assessmentId: 1000,
      roleCode: 'LEAD_ASSESSOR',
      decision: 'escalate',
      body: WHY,
      decidedBy: 20,
      decidedAt: STEP_THREE_OPEN,
      updatedAt: STEP_THREE_OPEN,
    });

    const result = await decide(7003, 'agree_program');

    expect(result.validations).toContainEqual({
      fieldKey: CORE[0],
      validated: true,
    });
  });
});
