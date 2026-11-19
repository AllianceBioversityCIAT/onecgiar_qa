// @akili-spec escalation/round-2
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

// The round-2 end (P2-3912 T-9; requirements FR-11, FR-12, FR-13, FR-15, NFR-3):
// Finish ends `escalated` when every grey core field carries an `escalate`
// decision, `quality_assessed` when none is grey, and is a 409
// `ASSESSMENT_CORE_UNDECIDED` otherwise; a round-2 end never returns, queues no
// `not_qaed` and, on `escalated`, no release. Expected values are the literals
// of the FR-11 / FR-12 / FR-13 scenarios. After the end every write is refused.

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
const NON_CORE = ASSESSED.slice(4);

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
const STEP_ONE_OPEN = new Date('2026-11-15T10:00:00Z');
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
 * its step-1 assessment (id 1), the round-2 membership (2) of the Lead; result
 * 5003 is an active round-1 membership (4) of the assessor for the NFR-6 pin.
 * By default CORE[0] and CORE[1] carry a `disagreed` round-1 comment (7001,
 * 7002) and CORE[2] and CORE[3] were green and uncommented: carried greens.
 */
function setup(
  options: {
    now?: Date;
    comments?: FakeComment[];
    greens?: string[];
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
      changedFields: null,
    },
    { ...base, id: 4, resultCode: 5003, title: 'Round one', round: 1 },
  );
  world.assessments.push(
    { id: 1, membershipId: 1, stepPosition: 1, status: 'returned' },
    { id: 4, membershipId: 4, stepPosition: 1, status: 'pending' },
  );
  world.comments.push(
    ...(options.comments ?? [comment(7001, CORE[0]!), comment(7002, CORE[1]!)]),
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
  ) => service.decide(lead(), 1, 5001, commentId, { decision, body }, RID);
  const finish = () => service.finish(lead(), 1, 5001, RID);
  const validate = (validated: boolean, fieldKeys: string[]) =>
    service.validate(lead(), 1, 5001, { validated, fieldKeys }, RID);
  /** The Lead's own round-2 comment, stored the way the comment route stores it (the route needs a snapshot). */
  const ownComment = (fieldKey: string, id: number) => {
    if (world.assessments.every((a) => a.membershipId !== 2)) {
      world.assessments.push({
        id: 1000,
        membershipId: 2,
        stepPosition: 3,
        status: 'pending',
      });
    }
    world.comments.push(
      comment(id, fieldKey, 'open', {
        assessmentId: 1000,
        authorId: 20,
        round: 2,
        stepPosition: 3,
      }),
    );
    return id;
  };
  return { world, service, decide, finish, validate, ownComment };
}

/** The answer of a request as the client sees it: a success is `{ status: 200, body }`, a refusal its status and body. */
async function answer(promise: Promise<unknown>) {
  try {
    return { status: 200, body: await promise };
  } catch (error) {
    const http = error as {
      getStatus?: () => number;
      getResponse?: () => unknown;
    };
    return { status: http.getStatus?.(), body: http.getResponse?.() };
  }
}

const roundTwoAssessment = (world: InMemoryAssessmentWorld) =>
  world.assessments.find((a) => a.membershipId === 2);
const auditActions = (world: InMemoryAssessmentWorld) =>
  world.audits.map((a) => a.action);
const roundOneStates = (world: InMemoryAssessmentWorld) =>
  world.comments
    .filter((c) => c.assessmentId === 1)
    .map((c) => [c.id, c.state]);

describe('FR-13 round 2 never returns (service level)', () => {
  it('a grey core field with a comment and no escalate decision is 409 ASSESSMENT_CORE_UNDECIDED, never returned, and nothing is written', async () => {
    const s = setup({ comments: [], greens: [] });
    // The Lead commented on the grey CORE[0] but decided nothing; the rest is green.
    s.ownComment(CORE[0]!, 8001);
    s.world.validations.push(
      ...CORE.slice(1).map((fieldKey) => ({
        assessmentId: 1000,
        fieldKey,
        validated: true,
      })),
    );
    const before = JSON.stringify([
      s.world.comments,
      s.world.commentEvents,
      s.world.audits,
    ]);

    const refused = await answer(s.finish());

    expect(refused).toMatchObject({
      status: 409,
      body: { code: 'ASSESSMENT_CORE_UNDECIDED', fields: [CORE[0]] },
    });
    expect(roundTwoAssessment(s.world)).toMatchObject({ status: 'pending' });
    expect(s.world.releases).toEqual([]);
    expect(
      JSON.stringify([s.world.comments, s.world.commentEvents, s.world.audits]),
    ).toBe(before);
  });
});

describe('FR-11 Escalated', () => {
  /** CORE[0] escalated, CORE[1] agreed (green), CORE[2] and CORE[3] carried green. */
  async function escalatedReview() {
    const s = setup();
    await s.decide(7001, 'escalate');
    await s.decide(7002, 'agree_program');
    return s;
  }

  it('ends escalated: status, Assessed by the Lead, no release row, comment states, events, audit and no visibility', async () => {
    const s = await escalatedReview();

    const result = await s.finish();

    expect(result).toMatchObject({
      status: 'escalated',
      assessedBy: { id: 20, nickname: null },
      finishedAt: '2027-02-10T10:00:00.000Z',
    });
    expect(roundTwoAssessment(s.world)).toMatchObject({
      status: 'escalated',
      finishedBy: 20,
    });
    // FR-11 / design 7: an `escalated` end queues nothing for Reporting.
    expect(s.world.releases).toEqual([]);
    expect(s.world.writeLog).not.toContain('insertRelease');
    expect(roundOneStates(s.world)).toEqual([
      [7001, 'escalated'],
      [7002, 'lead_sided_program'],
    ]);
    expect(s.world.commentEvents).toEqual([
      {
        commentId: 7001,
        actorId: 20,
        actorRole: 'LEAD_ASSESSOR',
        fromState: 'disagreed',
        toState: 'escalated',
        at: STEP_THREE_OPEN,
      },
      {
        commentId: 7002,
        actorId: 20,
        actorRole: 'LEAD_ASSESSOR',
        fromState: 'disagreed',
        toState: 'lead_sided_program',
        at: STEP_THREE_OPEN,
      },
    ]);
    expect(auditActions(s.world)).toEqual([
      'decision_set',
      'decision_set',
      'end_escalated',
    ]);
    // FR-15, DD-8: nothing becomes visible to the program.
    expect(s.world.writeLog).not.toContain('markCommentsVisible');
    expect(s.world.comments.every((c) => c.visibleToProgramAt == null)).toBe(
      true,
    );
    expect(s.world.endUpdatesMatched).toBe(1);
  });

  it("the Lead's own round-2 comment escalated moves open to escalated, with its event", async () => {
    const s = setup();
    s.ownComment(CORE[3]!, 8001);
    await s.validate(false, [CORE[3]!]);
    await s.decide(8001, 'escalate', 'Core field is wrong');
    await s.decide(7001, 'escalate');
    await s.decide(7002, 'agree_program');

    const result = await s.finish();

    expect(result.status).toBe('escalated');
    expect(s.world.comments.find((c) => c.id === 8001)!.state).toBe(
      'escalated',
    );
    expect(s.world.commentEvents.filter((e) => e.commentId === 8001)).toEqual([
      {
        commentId: 8001,
        actorId: 20,
        actorRole: 'LEAD_ASSESSOR',
        fromState: 'open',
        toState: 'escalated',
        at: STEP_THREE_OPEN,
      },
    ]);
    expect(s.world.releases).toEqual([]);
  });

  it('a decision on a deleted comment is not moved and gets no event; the end still happens', async () => {
    const s = await escalatedReview();
    // T-10 deletes a comment by `deleted_at`; its state stays `disagreed`.
    s.world.comments.find((c) => c.id === 7002)!.deletedAt = new Date(
      '2027-02-10T09:00:00Z',
    );

    const result = await s.finish();

    expect(result.status).toBe('escalated');
    expect(roundOneStates(s.world)).toEqual([
      [7001, 'escalated'],
      [7002, 'disagreed'],
    ]);
    expect(s.world.commentEvents.map((e) => e.commentId)).toEqual([7001]);
  });

  it('green + escalate stays unreachable: an escalated field refuses its validation, and the end that follows is escalated, never Quality Assessed', async () => {
    const s = await escalatedReview();

    expect(await answer(s.validate(true, [CORE[0]!]))).toMatchObject({
      status: 409,
      body: { code: 'ASSESSMENT_FIELD_ESCALATED' },
    });
    const result = await s.finish();

    expect(result.status).toBe('escalated');
    expect(s.world.releases).toEqual([]);
  });
});

describe('FR-11 Undecided', () => {
  it('two grey core fields with no decision: 409 ASSESSMENT_CORE_UNDECIDED naming both, in core order, and nothing is written', async () => {
    const s = setup();
    const before = JSON.stringify([
      s.world.comments,
      s.world.commentEvents,
      s.world.validations,
    ]);

    const refused = await answer(s.finish());

    expect(refused).toEqual({
      status: 409,
      body: expect.objectContaining({
        code: 'ASSESSMENT_CORE_UNDECIDED',
        fields: [CORE[0], CORE[1]],
      }),
    });
    // The assessment row created for the request went with the rollback.
    expect(roundTwoAssessment(s.world)).toBeUndefined();
    expect(s.world.releases).toEqual([]);
    expect(s.world.audits).toEqual([]);
    expect(
      JSON.stringify([
        s.world.comments,
        s.world.commentEvents,
        s.world.validations,
      ]),
    ).toBe(before);
  });

  it('only the undecided field is named: CORE[0] escalated, CORE[1] has no decision', async () => {
    const s = setup();
    await s.decide(7001, 'escalate');

    expect(await answer(s.finish())).toMatchObject({
      status: 409,
      body: { code: 'ASSESSMENT_CORE_UNDECIDED', fields: [CORE[1]] },
    });
    expect(roundTwoAssessment(s.world)).toMatchObject({ status: 'pending' });
  });

  it.each([
    ['deleted', { deletedAt: new Date('2027-02-10T09:00:00Z') }],
    ['withdrawn', { state: 'withdrawn' as const }],
  ])(
    'an escalate decision on a %s comment does not count: the field is undecided',
    async (_label, over) => {
      const s = setup();
      await s.decide(7001, 'escalate');
      await s.decide(7002, 'agree_program');
      Object.assign(
        s.world.comments.find((c) => c.id === 7001)!,
        over,
      );

      expect(await answer(s.finish())).toMatchObject({
        status: 409,
        body: { code: 'ASSESSMENT_CORE_UNDECIDED', fields: [CORE[0]] },
      });
    },
  );
});

describe('FR-12 Finish with no grey core field', () => {
  it('ends quality_assessed with one qaed release, whatever non-core fields carry', async () => {
    // Every core field carried green; a comment on a non-core field changes nothing.
    const s = setup({
      comments: [comment(7001, NON_CORE[0]!)],
      greens: [...CORE],
    });

    const result = await s.finish();

    expect(result).toMatchObject({
      status: 'quality_assessed',
      assessedBy: { id: 20, nickname: null },
    });
    expect(s.world.releases).toHaveLength(1);
    expect(s.world.releases[0]).toMatchObject({
      assessmentId: 1000,
      timelineResultId: 2,
      outcome: 'qaed',
      status: 'pending',
    });
    expect(auditActions(s.world)).toEqual(['end_quality_assessed']);
    expect(s.world.writeLog).not.toContain('markCommentsVisible');
    expect(s.world.endUpdatesMatched).toBe(1);
  });
});

describe('FR-11 the review is frozen after the end', () => {
  const FINISHED = { status: 409, body: { code: 'ASSESSMENT_FINISHED' } };

  it('validation, comment, decision, clear, finish and withdraw are all ASSESSMENT_FINISHED, and nothing changes', async () => {
    const s = setup();
    // An own comment on a green field, still `open` at the end: only a withdraw can reach it.
    s.ownComment(CORE[2]!, 8002);
    await s.decide(7001, 'escalate');
    await s.decide(7002, 'agree_program');
    await s.finish();
    const snapshot = () =>
      JSON.stringify([
        s.world.validations,
        s.world.commentDecisions,
        s.world.comments,
        s.world.commentEvents,
        s.world.audits,
        s.world.releases,
      ]);
    const before = snapshot();

    // Thunks: each attempt starts only when it is awaited, so none rejects unobserved.
    const attempts: Array<[string, () => Promise<unknown>]> = [
      ['validation', () => s.validate(true, [CORE[3]!])],
      [
        'comment',
        () =>
          s.service.comment(
            lead(),
            1,
            5001,
            { fieldKey: CORE[2]!, body: 'A late comment' },
            RID,
          ),
      ],
      ['decision', () => s.decide(7001, 'agree_program')],
      ['clear', () => s.service.clearDecision(lead(), 1, 5001, 7001, RID)],
      ['finish', () => s.finish()],
      ['withdraw', () => s.service.withdraw(lead(), 8002, RID)],
    ];
    for (const [name, attempt] of attempts) {
      expect(await answer(attempt()), name).toMatchObject(FINISHED);
    }

    expect(snapshot()).toBe(before);
    expect(s.world.comments.find((c) => c.id === 8002)!.state).toBe('open');
  });

  it('a withdraw while the review is pending still works (only the end freezes it)', async () => {
    const s = setup();
    s.ownComment(CORE[2]!, 8002);

    const result = await s.service.withdraw(lead(), 8002, RID);

    expect(result.state).toBe('withdrawn');
  });
});

describe('validations PUT carries effectiveValidated (design 6)', () => {
  const effective = (
    rows: ReadonlyArray<{ fieldKey: string; validated: boolean }> | undefined,
  ) => Object.fromEntries((rows ?? []).map((r) => [r.fieldKey, r.validated]));

  it('round 2: every core field, the carried greens included', async () => {
    const s = setup();

    const result = await s.validate(true, [CORE[0]!]);

    // Stored: only CORE[0]. Effective: CORE[2] and CORE[3] are carried green, CORE[1] is grey.
    expect(result.validations).toEqual([
      { fieldKey: CORE[0], validated: true },
    ]);
    expect(effective(result.effectiveValidated)).toEqual({
      [CORE[0]!]: true,
      [CORE[1]!]: false,
      [CORE[2]!]: true,
      [CORE[3]!]: true,
    });
  });

  it('round 2 with nothing written (a new result, greying a field) answers every core field grey', async () => {
    const s = setup();
    s.world.memberships[1]!.previousMembershipId = null;

    const result = await s.validate(false, [CORE[0]!]);

    expect(result.validations).toEqual([]);
    expect(effective(result.effectiveValidated)).toEqual({
      [CORE[0]!]: false,
      [CORE[1]!]: false,
      [CORE[2]!]: false,
      [CORE[3]!]: false,
    });
  });

  it('round 1 is unchanged: the answer has no effectiveValidated', async () => {
    const s = setup({ now: STEP_ONE_OPEN });

    const result = await s.service.validate(
      assessor(),
      1,
      5003,
      { validated: true, fieldKeys: [CORE[0]!] },
      RID,
    );

    expect(Object.keys(result).sort()).toEqual([
      'assessedBy',
      'finishedAt',
      'status',
      'validations',
    ]);
  });
});

describe('NFR-6 round 1 Finish is unchanged', () => {
  it('a grey core field with a comment still ends returned with a not_qaed release and makes the comments visible', async () => {
    const s = setup({ now: STEP_ONE_OPEN });
    s.world.comments.push(
      comment(7200, CORE[0]!, 'open', { assessmentId: 4, authorId: 10 }),
    );
    s.world.validations.push(
      ...CORE.slice(1).map((fieldKey) => ({
        assessmentId: 4,
        fieldKey,
        validated: true,
      })),
    );

    const result = await s.service.finish(assessor(), 1, 5003, RID);

    expect(result.status).toBe('returned');
    expect(s.world.releases).toHaveLength(1);
    expect(s.world.releases[0]).toMatchObject({
      assessmentId: 4,
      outcome: 'not_qaed',
    });
    expect(s.world.writeLog).toContain('markCommentsVisible');
    expect(auditActions(s.world)).toEqual(['end_returned']);
  });
});
