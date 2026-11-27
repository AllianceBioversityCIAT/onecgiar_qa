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

// Round-2 decisions (P2-3912 T-7; requirements FR-8, FR-12, FR-7; NFR-3): the
// Lead sets `agree_program` or `escalate` on a round-1 comment of THIS result.
// Expected values are written out from the scenarios: agree turns the field
// green, escalate keeps it grey and refuses its validation, clearing or
// un-greening undoes an agree, the last green ends the review Quality Assessed
// with one `qaed` release and the comment `lead_sided_program`.

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
  return { world, service, decide, clear, validate };
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

const roundTwoAssessment = (world: InMemoryAssessmentWorld) =>
  world.assessments.find((a) => a.membershipId === 2);
const stored = (world: InMemoryAssessmentWorld) =>
  world.validations.filter((v) => v.assessmentId === 1000);
const auditActions = (world: InMemoryAssessmentWorld) =>
  world.audits.map((a) => a.action);

describe('FR-8 Agree with the program', () => {
  it('stores the decision with its author and time and turns the field green; the review stays open while a core field is grey', async () => {
    const { world, decide } = setup();

    const result = await decide(7001, 'agree_program');

    expect(world.commentDecisions).toEqual([
      {
        commentId: 7001,
        assessmentId: 1000,
        roleCode: 'LEAD_ASSESSOR',
        decision: 'agree_program',
        body: WHY,
        decidedAt: STEP_THREE_OPEN,
        decidedBy: 20,
        updatedAt: STEP_THREE_OPEN,
      },
    ]);
    expect(stored(world)).toEqual([
      { assessmentId: 1000, fieldKey: CORE[0], validated: true },
    ]);
    expect(result).toEqual({
      status: 'pending',
      assessedBy: null,
      finishedAt: null,
      validations: [{ fieldKey: CORE[0], validated: true }],
      decision: {
        decision: 'agree_program',
        body: WHY,
        decidedAt: '2027-02-10T10:00:00.000Z',
      },
    });
    expect(auditActions(world)).toEqual(['decision_set']);
    expect(world.audits[0]).toMatchObject({
      assessmentId: 1000,
      actorId: 20,
      fieldKeys: [CORE[0]],
      commentId: 7001,
    });
    // DD-7: no comment state changes while the review is open.
    expect(world.comments.find((c) => c.id === 7001)!.state).toBe('disagreed');
  });

  it('trims nothing itself and stores the text it is given (the DTO trims)', async () => {
    const { world, decide } = setup();
    await decide(7001, 'agree_program', 'Short');
    expect(world.commentDecisions[0]!.body).toBe('Short');
  });

  it('keeps the lock order: timeline share, the round-2 assessment, then the comment row; the round-1 assessment is never locked', async () => {
    const { world, decide } = setup();
    await decide(7001, 'agree_program');
    expect(world.writeLog.slice(0, 4)).toEqual([
      'lockTimelineShared',
      'ensureAssessment',
      'lockAssessment',
      'lockDecisionTarget',
    ]);
    expect(world.writeLog.filter((e) => e === 'lockAssessment')).toHaveLength(
      1,
    );
  });

  it('the same request twice leaves the same state', async () => {
    const { world, decide } = setup();
    await decide(7001, 'agree_program');
    const again = await decide(7001, 'agree_program');
    expect(world.commentDecisions).toHaveLength(1);
    expect(stored(world)).toHaveLength(1);
    expect(again.validations).toEqual([{ fieldKey: CORE[0], validated: true }]);
  });

  it('FR-12 Last agree turns it green: ends quality_assessed, one qaed release, the comment lead_sided_program, no comment made visible', async () => {
    const { world, decide } = setup();
    await decide(7001, 'agree_program');

    const last = await decide(7002, 'agree_program', 'Agreed, evidence given');

    expect(last).toMatchObject({
      status: 'quality_assessed',
      assessedBy: { id: 20, nickname: null },
      finishedAt: '2027-02-10T10:00:00.000Z',
    });
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
    expect(
      world.comments
        .filter((c) => c.assessmentId === 1)
        .map((c) => [c.id, c.state]),
    ).toEqual([
      [7001, 'lead_sided_program'],
      [7002, 'lead_sided_program'],
    ]);
    expect(world.commentEvents).toEqual([
      {
        commentId: 7001,
        actorId: 20,
        actorRole: 'LEAD_ASSESSOR',
        fromState: 'disagreed',
        toState: 'lead_sided_program',
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
    expect(auditActions(world)).toEqual([
      'decision_set',
      'decision_set',
      'end_quality_assessed',
    ]);
    // DD-8: a round-2 end never makes a comment visible to the program.
    expect(world.writeLog).not.toContain('markCommentsVisible');
    expect(world.comments.every((c) => c.visibleToProgramAt == null)).toBe(
      true,
    );
    expect(world.endUpdatesMatched).toBe(1);
  });

  it('the end counts effective greens: a field in changed_fields is not carried, so the agree does not end the review', async () => {
    const { world, decide } = setup({
      comments: [comment(7001, CORE[0]!)],
      greens: [CORE[1]!, CORE[2]!, CORE[3]!],
      changedFields: [CORE[3]!],
    });

    const result = await decide(7001, 'agree_program');

    expect(result.status).toBe('pending');
    expect(world.releases).toEqual([]);
  });

  it('with every other core field carried green the agree ends the review (the stored marks alone would be one of four)', async () => {
    const { world, decide } = setup({
      comments: [comment(7001, CORE[0]!)],
      greens: [CORE[1]!, CORE[2]!, CORE[3]!],
    });

    const result = await decide(7001, 'agree_program');

    expect(result.status).toBe('quality_assessed');
    expect(stored(world)).toEqual([
      { assessmentId: 1000, fieldKey: CORE[0], validated: true },
    ]);
    expect(world.releases).toHaveLength(1);
  });
});

describe('FR-7 a deleted round-1 comment no longer blocks a carried green', () => {
  it('a field green in round 1 whose only comment was deleted counts as green for the end', async () => {
    const { decide } = setup({
      comments: [
        comment(7001, CORE[0]!, 'disagreed', {
          deletedAt: new Date('2027-02-09T08:00:00Z'),
        }),
        comment(7002, CORE[1]!),
      ],
      greens: [CORE[0]!, CORE[2]!, CORE[3]!],
    });

    const result = await decide(7002, 'agree_program');

    expect(result.status).toBe('quality_assessed');
  });
});

describe('ADR-006: the end moves a comment only along the transition table', () => {
  it('a decided comment that is no longer in a decidable state is not moved and gets no event; the end still happens', async () => {
    const { world, decide } = setup({
      comments: [comment(7001, CORE[0]!), comment(7002, CORE[1]!)],
    });
    await decide(7001, 'agree_program');
    // The program's answer changed the comment after the decision.
    world.comments.find((c) => c.id === 7001)!.state = 'accepted';

    const last = await decide(7002, 'agree_program');

    expect(last.status).toBe('quality_assessed');
    expect(
      world.comments
        .filter((c) => c.assessmentId === 1)
        .map((c) => [c.id, c.state]),
    ).toEqual([
      [7001, 'accepted'],
      [7002, 'lead_sided_program'],
    ]);
    expect(world.commentEvents.map((e) => e.commentId)).toEqual([7002]);
  });
});

describe('FR-8 Escalate', () => {
  it('stores the decision and keeps the field grey; a later validation of it is 409 ASSESSMENT_FIELD_ESCALATED', async () => {
    const { world, decide, validate } = setup();

    const result = await decide(7001, 'escalate', 'The program is wrong');

    expect(result.status).toBe('pending');
    expect(result.decision).toMatchObject({ decision: 'escalate' });
    expect(world.commentDecisions[0]).toMatchObject({
      commentId: 7001,
      decision: 'escalate',
      body: 'The program is wrong',
    });
    expect(stored(world)).toEqual([]);
    const before = JSON.stringify([world.validations, world.audits]);

    expect(await refusal(validate(true, [CORE[0]!]))).toMatchObject({
      status: 409,
      body: { code: 'ASSESSMENT_FIELD_ESCALATED', fields: [CORE[0]] },
    });
    expect(JSON.stringify([world.validations, world.audits])).toBe(before);
  });

  it('Check all is refused whole while a field is escalated, and un-greening it is allowed', async () => {
    const { world, decide, service } = setup();
    await decide(7001, 'escalate');

    expect(
      await refusal(
        service.validate(lead(), 1, 5001, { validated: true, all: true }, RID),
      ),
    ).toMatchObject({
      status: 409,
      body: { code: 'ASSESSMENT_FIELD_ESCALATED', fields: [CORE[0]] },
    });
    expect(stored(world)).toEqual([]);
    await service.validate(
      lead(),
      1,
      5001,
      { validated: false, fieldKeys: [CORE[0]!] },
      RID,
    );
  });

  it('changing agree to escalate puts the field back to grey in the same transaction', async () => {
    const { world, decide } = setup();
    await decide(7001, 'agree_program');

    const result = await decide(7001, 'escalate', 'On second thought');

    expect(world.commentDecisions).toHaveLength(1);
    expect(world.commentDecisions[0]).toMatchObject({
      decision: 'escalate',
      body: 'On second thought',
    });
    expect(stored(world)).toEqual([
      { assessmentId: 1000, fieldKey: CORE[0], validated: false },
    ]);
    expect(result.validations).toEqual([
      { fieldKey: CORE[0], validated: false },
    ]);
  });

  it('changing escalate to agree turns the field green and refreshes who decided and when', async () => {
    const { world, decide } = setup();
    await decide(7001, 'escalate');
    world.commentDecisions[0]!.decidedAt = new Date('2027-02-09T08:00:00Z');
    world.commentDecisions[0]!.updatedAt = new Date('2027-02-09T08:00:00Z');

    await decide(7001, 'agree_program');

    expect(world.commentDecisions).toHaveLength(1);
    expect(world.commentDecisions[0]).toMatchObject({
      decision: 'agree_program',
      decidedAt: STEP_THREE_OPEN,
      decidedBy: 20,
      updatedAt: STEP_THREE_OPEN,
    });
    expect(stored(world)).toEqual([
      { assessmentId: 1000, fieldKey: CORE[0], validated: true },
    ]);
  });

  it('two comments on one field: an agree cannot turn it green while the other is escalated (409), and an escalate greys it and drops the agree', async () => {
    const { world, decide, clear } = setup({
      comments: [comment(7001, CORE[0]!), comment(7002, CORE[0]!)],
    });
    await decide(7001, 'escalate');
    expect(await refusal(decide(7002, 'agree_program'))).toMatchObject({
      status: 409,
      body: { code: 'ASSESSMENT_FIELD_ESCALATED', fields: [CORE[0]] },
    });
    expect(world.commentDecisions).toHaveLength(1);

    // Clear the escalate, agree on one comment, then escalate the other.
    await clear(7001);
    await decide(7002, 'agree_program');
    // O-1: 7001 is undecided again, so the field stays grey until it is decided too.
    expect(stored(world)).toEqual([]);
    await decide(7001, 'agree_program');
    expect(stored(world)).toEqual([
      { assessmentId: 1000, fieldKey: CORE[0], validated: true },
    ]);
    await decide(7001, 'escalate');
    expect(
      world.commentDecisions.map((d) => [d.commentId, d.decision]),
    ).toEqual([[7001, 'escalate']]);
    expect(stored(world)).toEqual([
      { assessmentId: 1000, fieldKey: CORE[0], validated: false },
    ]);
  });
});

describe('FR-8 clearing a decision', () => {
  it('clearing an agree_program puts its field back to grey and removes the decision, with one decision_clear audit row', async () => {
    const { world, decide, clear } = setup();
    await decide(7001, 'agree_program');

    const result = await clear(7001);

    expect(world.commentDecisions).toEqual([]);
    expect(stored(world)).toEqual([
      { assessmentId: 1000, fieldKey: CORE[0], validated: false },
    ]);
    expect(result).toEqual({
      status: 'pending',
      assessedBy: null,
      finishedAt: null,
      validations: [{ fieldKey: CORE[0], validated: false }],
      decision: null,
    });
    expect(auditActions(world)).toEqual(['decision_set', 'decision_clear']);
    expect(world.audits[1]).toMatchObject({
      fieldKeys: [CORE[0]],
      commentId: 7001,
    });
  });

  it('clearing an escalate removes it and leaves the field grey; validating it is then refused as undecided, no longer as escalated (O-1)', async () => {
    const { world, decide, clear, validate } = setup();
    await decide(7001, 'escalate');

    await clear(7001);
    const refused = await refusal(validate(true, [CORE[0]!]));

    expect(refused).toMatchObject({
      status: 409,
      body: {
        code: 'ASSESSMENT_CORE_COMMENT_UNDECIDED',
        fields: [CORE[0]],
      },
    });
    expect(world.commentDecisions).toEqual([]);
    expect(stored(world)).toEqual([]);
  });

  it('clearing where nothing was decided succeeds and writes nothing; with no assessment row it creates none', async () => {
    const { world, clear } = setup();

    const result = await clear(7001);

    expect(result).toEqual({
      status: 'pending',
      assessedBy: null,
      finishedAt: null,
      validations: [],
      decision: null,
    });
    expect(roundTwoAssessment(world)).toBeUndefined();
    expect(world.transactions).toBe(0);
    expect(world.audits).toEqual([]);
  });

  it('clearing with an assessment row but no decision writes no audit row', async () => {
    const { world, decide, clear } = setup();
    await decide(7001, 'agree_program');
    await clear(7001);
    const audits = world.audits.length;

    await clear(7001);

    expect(world.audits).toHaveLength(audits);
  });

  it('with two agrees on one field, clearing one turns the field grey and keeps the other agree (O-1)', async () => {
    const { world, decide, clear } = setup({
      comments: [comment(7001, CORE[0]!), comment(7002, CORE[0]!)],
    });
    await decide(7001, 'agree_program');
    await decide(7002, 'agree_program');

    const result = await clear(7001);

    expect(stored(world)).toEqual([
      { assessmentId: 1000, fieldKey: CORE[0], validated: false },
    ]);
    expect(world.commentDecisions.map((d) => d.commentId)).toEqual([7002]);
    expect(result.validations).toEqual([
      { fieldKey: CORE[0], validated: false },
    ]);
    expect(auditActions(world)).toEqual([
      'decision_set',
      'decision_set',
      'decision_clear',
    ]);
  });

  it('two agrees, clear one: finish is refused ASSESSMENT_CORE_UNDECIDED, not quality_assessed; agreeing the cleared one again greens the field', async () => {
    const { world, service, decide, clear } = setup({
      comments: [comment(7001, CORE[0]!), comment(7002, CORE[0]!)],
      // CORE[3] stays grey, so the two agrees alone do not end the review.
      greens: [CORE[1]!, CORE[2]!],
    });
    await decide(7001, 'agree_program');
    await decide(7002, 'agree_program');
    await clear(7001);

    const refused = await refusal(service.finish(lead(), 1, 5001, RID));

    expect(refused).toMatchObject({
      status: 409,
      body: {
        code: 'ASSESSMENT_CORE_UNDECIDED',
        fields: [CORE[0]!, CORE[3]!].sort(),
      },
    });

    const again = await decide(7001, 'agree_program');

    expect(again.validations).toEqual([{ fieldKey: CORE[0], validated: true }]);
    expect(again.status).toBe('pending');
    // The last grey core field validated: now the review ends.
    const end = await service.validate(
      lead(),
      1,
      5001,
      { validated: true, fieldKeys: [CORE[3]!] },
      RID,
    );
    expect(end.status).toBe('quality_assessed');
    expect(world.commentDecisions.map((d) => d.commentId)).toEqual([
      7002, 7001,
    ]);
  });

  it('a comment of another result is the 404 on a clear as well', async () => {
    const { clear } = setup();
    expect(await refusal(clear(7100))).toMatchObject({
      status: 404,
      body: { code: 'ASSESSMENT_NOT_FOUND' },
    });
  });
});

describe('FR-8 Un-green a field the Lead agreed on', () => {
  it('un-greening the field clears the decision on its comment in the same transaction', async () => {
    const { world, decide, validate } = setup();
    await decide(7001, 'agree_program');

    const result = await validate(false, [CORE[0]!]);

    expect(world.commentDecisions).toEqual([]);
    expect(result.validations).toEqual([
      { fieldKey: CORE[0], validated: false },
    ]);
    expect(auditActions(world)).toEqual([
      'decision_set',
      'unvalidate',
      'decision_clear',
    ]);
  });

  it('un-greening a field with no decision leaves the decisions of other fields alone', async () => {
    // CORE[2] is grey here, so validating CORE[1] does not complete the core.
    const { world, decide, validate } = setup({ greens: [CORE[3]!] });
    await decide(7001, 'agree_program');
    await validate(true, [CORE[2]!]);

    await validate(false, [CORE[2]!]);

    expect(world.commentDecisions.map((d) => d.commentId)).toEqual([7001]);
  });

  it('FR-7: un-greening a carried green writes a stored false row for it', async () => {
    const { world, validate } = setup();

    const result = await validate(false, [CORE[2]!]);

    expect(stored(world)).toEqual([
      { assessmentId: 1000, fieldKey: CORE[2], validated: false },
    ]);
    expect(result.validations).toEqual([
      { fieldKey: CORE[2], validated: false },
    ]);
  });

  it('FR-7: validating a carried green changes nothing (it is already green)', async () => {
    const { world, validate } = setup();
    await validate(true, [CORE[2]!]);
    expect(stored(world)).toEqual([]);
    expect(auditActions(world)).toEqual([]);
  });
});

describe('FR-12 / FR-7 the end over effective greens through a validation', () => {
  it('the last validation ends the review when the other core fields are carried green', async () => {
    const { world, validate } = setup({
      comments: [],
      greens: [CORE[0]!, CORE[1]!, CORE[2]!],
    });

    const result = await validate(true, [CORE[3]!]);

    expect(result.status).toBe('quality_assessed');
    expect(world.releases).toHaveLength(1);
    expect(world.releases[0]!.outcome).toBe('qaed');
    expect(stored(world)).toEqual([
      { assessmentId: 1000, fieldKey: CORE[3], validated: true },
    ]);
  });

  it('un-greening a carried green then re-validating the rest does not end it: the stored false wins', async () => {
    const { world, validate } = setup({
      comments: [],
      greens: [CORE[0]!, CORE[1]!, CORE[2]!],
    });
    await validate(false, [CORE[0]!]);

    const result = await validate(true, [CORE[3]!]);

    expect(result.status).toBe('pending');
    expect(world.releases).toEqual([]);
  });

  it('a validation that ends the review also closes the comments the Lead agreed on (lead_sided_program, one event each)', async () => {
    // 7002 is withdrawn: its field has no live round-1 comment, so the Lead can validate it directly.
    const { world, decide, validate } = setup({
      comments: [comment(7001, CORE[0]!), comment(7002, CORE[1]!, 'withdrawn')],
    });
    await decide(7001, 'agree_program');

    const result = await validate(true, [CORE[1]!]);

    expect(result.status).toBe('quality_assessed');
    expect(
      world.comments
        .filter((c) => c.assessmentId === 1)
        .map((c) => [c.id, c.state]),
    ).toEqual([
      [7001, 'lead_sided_program'],
      // 7002 had no decision: the Lead validated its field directly.
      [7002, 'withdrawn'],
    ]);
    expect(world.commentEvents.map((e) => e.commentId)).toEqual([7001]);
    expect(world.writeLog).not.toContain('markCommentsVisible');
  });
});

describe('FR-8 Not decidable', () => {
  const cases: Array<[string, FakeComment]> = [
    ['accepted', comment(7101, CORE[0]!, 'accepted')],
    ['accepted_with_comment', comment(7101, CORE[0]!, 'accepted_with_comment')],
    ['withdrawn', comment(7101, CORE[0]!, 'withdrawn')],
    [
      'deleted',
      comment(7101, CORE[0]!, 'disagreed', {
        deletedAt: new Date('2027-02-09T08:00:00Z'),
      }),
    ],
    ['a non-core field', comment(7101, NON_CORE[0]!, 'disagreed')],
    [
      'already closed (lead_sided_program)',
      comment(7101, CORE[0]!, 'lead_sided_program'),
    ],
    ['already escalated', comment(7101, CORE[0]!, 'escalated')],
  ];

  it.each(cases)(
    'a comment that is %s: 409 ASSESSMENT_DECISION_INVALID and nothing is stored',
    async (_name, target) => {
      const { world, decide } = setup({ comments: [target] });

      for (const choice of ['agree_program', 'escalate'] as const) {
        expect(await refusal(decide(7101, choice))).toMatchObject({
          status: 409,
          body: { code: 'ASSESSMENT_DECISION_INVALID' },
        });
      }
      expect(world.commentDecisions).toEqual([]);
      expect(world.validations.filter((v) => v.assessmentId === 1000)).toEqual(
        [],
      );
      expect(world.audits).toEqual([]);
      expect(roundTwoAssessment(world)).toBeUndefined();
    },
  );

  it.each(['open', 'clarification_requested'] as const)(
    'a comment in state %s is decidable',
    async (state) => {
      const { world, decide } = setup({
        comments: [comment(7101, CORE[0]!, state)],
      });
      await decide(7101, 'escalate');
      expect(world.commentDecisions).toHaveLength(1);
    },
  );

  it('a comment of another result is the 404 body of a comment that does not exist, and nothing is stored', async () => {
    const { world, decide } = setup();

    const other = await refusal(decide(7100, 'agree_program'));
    const missing = await refusal(decide(7999, 'agree_program'));

    expect(other).toEqual({
      status: 404,
      body: expect.objectContaining({ code: 'ASSESSMENT_NOT_FOUND' }),
    });
    expect(other).toEqual(missing);
    expect(world.commentDecisions).toEqual([]);
    expect(roundTwoAssessment(world)).toBeUndefined();
  });
});

describe('who may decide, and when', () => {
  it('a round-1 reviewer is not a Lead: the 404 that tells nothing (step 1 open, so no step refusal comes first)', async () => {
    const { decide } = setup({ now: new Date('2026-11-13T10:00:00Z') });
    expect(
      await refusal(decide(7001, 'agree_program', WHY, assessor())),
    ).toMatchObject({ status: 404, body: { code: 'ASSESSMENT_NOT_FOUND' } });
  });

  it('an ADMIN is read only: 403 ASSESSMENT_READ_ONLY', async () => {
    const { world, decide, clear } = setup();
    expect(
      await refusal(decide(7001, 'agree_program', WHY, admin())),
    ).toMatchObject({ status: 403, body: { code: 'ASSESSMENT_READ_ONLY' } });
    expect(await refusal(clear(7001, admin()))).toMatchObject({
      status: 403,
      body: { code: 'ASSESSMENT_READ_ONLY' },
    });
    expect(world.commentDecisions).toEqual([]);
  });

  it('a new round-2 result has no round-1 comment: every comment is the 404', async () => {
    const { world, decide } = setup();
    world.memberships[1]!.previousMembershipId = null;
    expect(await refusal(decide(7001, 'agree_program'))).toMatchObject({
      status: 404,
    });
  });

  it('after the review ended: 409 ASSESSMENT_FINISHED, on a decision and on a clear, and nothing moves', async () => {
    const { world, decide, clear } = setup();
    await decide(7001, 'agree_program');
    world.assessments.find((a) => a.membershipId === 2)!.status =
      'quality_assessed';
    const before = JSON.stringify([
      world.commentDecisions,
      world.validations,
      world.audits,
    ]);

    for (const attempt of [() => decide(7001, 'escalate'), () => clear(7001)]) {
      expect(await refusal(attempt())).toMatchObject({
        status: 409,
        body: { code: 'ASSESSMENT_FINISHED' },
      });
    }
    expect(
      JSON.stringify([world.commentDecisions, world.validations, world.audits]),
    ).toBe(before);
  });

  it('a membership already ended takes no decision: 409 ASSESSMENT_FINISHED', async () => {
    const { world, decide } = setup();
    world.memberships[1]!.ended = true;
    world.memberships[1]!.endReason = 'released_qaed';
    expect(await refusal(decide(7001, 'agree_program'))).toMatchObject({
      status: 409,
      body: { code: 'ASSESSMENT_FINISHED' },
    });
  });

  it('outside the step window: 409 ASSESSMENT_STEP_CLOSED', async () => {
    const { world, decide, clear } = setup({ now: AFTER_STEP_THREE });
    for (const attempt of [
      () => decide(7001, 'agree_program'),
      () => clear(7001),
    ]) {
      expect(await refusal(attempt())).toMatchObject({
        status: 409,
        body: { code: 'ASSESSMENT_STEP_CLOSED' },
      });
    }
    expect(world.commentDecisions).toEqual([]);
  });
});

describe('NFR-2 the log line of a decision carries ids and fixed words only', () => {
  it('writes one `decide` line and no text', async () => {
    const lines: string[] = [];
    vi.spyOn(Logger.prototype, 'log').mockImplementation((line) => {
      lines.push(String(line));
    });
    const { decide, clear } = setup();

    await decide(7001, 'agree_program', 'A very private reason');
    await clear(7001);

    const parsed = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(parsed).toEqual([
      expect.objectContaining({
        event: 'assessment',
        action: 'decide',
        outcome: 'ok',
        timelineId: 1,
        membershipId: 2,
        actorId: 20,
      }),
      expect.objectContaining({
        event: 'assessment',
        action: 'decision_clear',
        outcome: 'ok',
      }),
    ]);
    expect(lines.join('\n')).not.toContain('private reason');
    vi.restoreAllMocks();
  });
});

// Round-2 FR-9 (P2-3912 T-8): the Lead's OWN round-2 comment can be escalated,
// never agreed; withdrawing it takes its escalate with it; the withdraw window
// also opens while step 3 is in progress, for a round-2 comment only.
describe('FR-9 the Lead own comment', () => {
  // The comment route is covered by its own specs (it needs a snapshot); here
  // the Lead's comment is written the way that route stores it: round 2, step 3.
  const own = (
    setupResult: ReturnType<typeof setup>,
    fieldKey = CORE[0]!,
    id = 8001,
  ) => {
    const { world } = setupResult;
    if (roundTwoAssessment(world) === undefined) {
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
  const withdraw = (
    setupResult: ReturnType<typeof setup>,
    id: number,
    user = lead(),
  ) => setupResult.service.withdraw(user, id, RID);

  it('escalates the own comment: the decision is stored and the field stays grey', async () => {
    const s = setup();
    const id = own(s);

    const result = await s.decide(id, 'escalate', 'Core field is wrong');

    expect(result.status).toBe('pending');
    expect(result.decision).toEqual({
      decision: 'escalate',
      body: 'Core field is wrong',
      decidedAt: '2027-02-10T10:00:00.000Z',
    });
    expect(
      s.world.commentDecisions.map((d) => [d.commentId, d.decision]),
    ).toEqual([[id, 'escalate']]);
    expect(auditActions(s.world)).toContain('decision_set');
    expect(
      s.world.validations.filter((v) => v.assessmentId === 1000 && v.validated),
    ).toEqual([]);
  });

  it('refuses agree_program on the own comment with 409 ASSESSMENT_DECISION_INVALID and stores nothing', async () => {
    const s = setup();
    const id = own(s);

    expect(await refusal(s.decide(id, 'agree_program'))).toMatchObject({
      status: 409,
      body: { code: 'ASSESSMENT_DECISION_INVALID' },
    });
    expect(s.world.commentDecisions).toEqual([]);
  });

  it('a withdrawn own comment is not decidable (409)', async () => {
    const s = setup();
    const id = own(s);
    await withdraw(s, id);

    expect(await refusal(s.decide(id, 'escalate'))).toMatchObject({
      status: 409,
      body: { code: 'ASSESSMENT_DECISION_INVALID' },
    });
  });

  it('a comment of another author on the same assessment is the 404 that tells nothing', async () => {
    const s = setup();
    const id = own(s);
    s.world.comments.find((c) => c.id === id)!.authorId = 21;

    expect(await refusal(s.decide(id, 'escalate'))).toMatchObject({
      status: 404,
    });
  });

  it('escalate then withdraw leaves no live decision, with one decision_clear audit row', async () => {
    const s = setup();
    const id = own(s);
    await s.decide(id, 'escalate');

    await withdraw(s, id);

    expect(s.world.commentDecisions).toEqual([]);
    expect(auditActions(s.world).filter((a) => a === 'decision_clear')).toEqual(
      ['decision_clear'],
    );
    expect(auditActions(s.world)).toContain('comment_withdraw');
  });

  it('withdraws an own round-2 comment while step 3 is in progress', async () => {
    const s = setup();
    const id = own(s);

    const result = await withdraw(s, id);

    expect(result.state).toBe('withdrawn');
  });

  it('refuses the withdraw of a round-2 comment once step 3 has closed (409 ASSESSMENT_STEP_CLOSED)', async () => {
    const s = setup({ now: AFTER_STEP_THREE });
    const id = own(s);

    expect(await refusal(withdraw(s, id))).toMatchObject({
      status: 409,
      body: { code: 'ASSESSMENT_STEP_CLOSED' },
    });
  });

  it('round 1 is unchanged: a round-1 comment cannot be withdrawn while only step 3 is open', async () => {
    const s = setup({
      comments: [comment(7001, CORE[0]!, 'open')],
    });

    expect(await refusal(withdraw(s, 7001, assessor()))).toMatchObject({
      status: 409,
      body: { code: 'ASSESSMENT_STEP_CLOSED' },
    });
  });
});

describe('FR-8 none (undecided): a core field with an undecided round-1 comment cannot be validated (HITL O-1)', () => {
  const undecided = () =>
    setup({
      comments: [
        comment(7001, CORE[0]!, 'open'),
        comment(7002, CORE[1]!, 'clarification_requested'),
        comment(7003, CORE[2]!, 'disagreed'),
      ],
    });
  const noWrite = (world: InMemoryAssessmentWorld) => {
    expect(stored(world)).toEqual([]);
    expect(world.audits).toEqual([]);
    expect(world.commentDecisions).toEqual([]);
  };

  it('refuses the whole request with the sorted fields, and writes nothing', async () => {
    const { world, validate } = undecided();

    const refused = await refusal(
      validate(true, [CORE[2]!, CORE[0]!, CORE[1]!]),
    );

    expect(refused).toMatchObject({
      status: 409,
      body: {
        code: 'ASSESSMENT_CORE_COMMENT_UNDECIDED',
        fields: [CORE[0]!, CORE[1]!, CORE[2]!].sort(),
      },
    });
    noWrite(world);
  });

  it('a request mixing an undecided field with a clean one is refused whole: the clean one is not written', async () => {
    const { world, validate } = undecided();

    const refused = await refusal(validate(true, [CORE[0]!, CORE[3]!]));

    expect(refused).toMatchObject({
      status: 409,
      body: { code: 'ASSESSMENT_CORE_COMMENT_UNDECIDED', fields: [CORE[0]] },
    });
    noWrite(world);
  });

  it('Check all is refused whole, naming every undecided core field', async () => {
    const { world, service } = undecided();

    const refused = await refusal(
      service.validate(lead(), 1, 5001, { validated: true, all: true }, RID),
    );

    expect(refused).toMatchObject({
      status: 409,
      body: {
        code: 'ASSESSMENT_CORE_COMMENT_UNDECIDED',
        fields: [CORE[0]!, CORE[1]!, CORE[2]!].sort(),
      },
    });
    noWrite(world);
  });

  it('an escalated field keeps its precedence: ASSESSMENT_FIELD_ESCALATED comes first', async () => {
    const { world, decide, validate } = undecided();
    await decide(7001, 'escalate');

    const refused = await refusal(validate(true, [CORE[0]!, CORE[1]!]));

    expect(refused).toMatchObject({
      status: 409,
      body: { code: 'ASSESSMENT_FIELD_ESCALATED', fields: [CORE[0]] },
    });
    expect(stored(world)).toEqual([]);
  });

  it('a withdrawn or a deleted round-1 comment does not block', async () => {
    const { world, validate } = setup({
      comments: [
        comment(7001, CORE[0]!, 'withdrawn'),
        comment(7002, CORE[1]!, 'open', { deletedAt: STEP_THREE_OPEN }),
      ],
    });

    await validate(true, [CORE[0]!, CORE[1]!]);

    expect(stored(world).map((v) => v.fieldKey)).toEqual([CORE[0], CORE[1]]);
  });

  it('un-validating is never refused', async () => {
    // CORE[3] is a carried green; greying it writes a stored false row while other fields stay undecided.
    const { world, validate } = undecided();

    const result = await validate(false, [CORE[3]!]);

    expect(result.status).toBe('pending');
    expect(stored(world)).toEqual([
      { assessmentId: 1000, fieldKey: CORE[3], validated: false },
    ]);
  });

  it('a field without a round-1 comment still validates', async () => {
    const { world, validate } = setup({
      comments: [comment(7001, CORE[0]!, 'open')],
      greens: [],
    });

    await validate(true, [CORE[3]!]);

    expect(stored(world)).toEqual([
      { assessmentId: 1000, fieldKey: CORE[3], validated: true },
    ]);
  });

  it('a field whose comment has a decision is no longer blocked by it (the agree already greened it)', async () => {
    const { world, decide, validate } = undecided();
    await decide(7001, 'agree_program');

    await validate(true, [CORE[0]!]);

    expect(stored(world)).toEqual([
      { assessmentId: 1000, fieldKey: CORE[0], validated: true },
    ]);
  });

  it('two comments on one field: the first agree is stored but the field stays grey until the last one is decided', async () => {
    const { world, decide } = setup({
      comments: [comment(7001, CORE[0]!), comment(7002, CORE[0]!, 'open')],
    });

    const first = await decide(7001, 'agree_program');

    expect(world.commentDecisions.map((d) => d.commentId)).toEqual([7001]);
    expect(stored(world)).toEqual([]);
    expect(first.validations).toEqual([]);

    const second = await decide(7002, 'agree_program');

    expect(world.commentDecisions.map((d) => d.commentId)).toEqual([
      7001, 7002,
    ]);
    expect(second.validations).toEqual([
      { fieldKey: CORE[0], validated: true },
    ]);
  });
});
