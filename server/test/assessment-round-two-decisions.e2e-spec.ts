// @akili-spec escalation/round-2
import {
  bearer,
  buildAssessmentApp,
  type AssessmentApp,
} from './support/assessment-app.js';
import { ASSESSED, resultPath } from './support/assessment-seed.js';
import {
  addTwoRounds,
  IN_LEAD_STEP,
  plantRoundOneComment,
  seedRoundTwoWorld,
} from './support/round-two-fixture.js';
import type {
  FeedRelease,
  FeedReleaseQuery,
} from '../src/ingestion/results-feed.port.js';

// The Lead's decisions over real HTTP (P2-3912 T-7; FR-8, FR-12; NFR-3): the
// HTTP path only. Every branch of the decision rules is a unit spec over the
// in-memory stores (`assessment-decisions.service.spec.ts`). The round-2
// membership is the one the real load runner wrote (`round-two-fixture.ts`).
// Expected values are written out from the scenarios.

const CARRIED = ASSESSED[1]!; // green in round 1, uncommented, unchanged
const SECOND = ASSESSED[2]!; // grey, a disagreed round-1 comment
const FIRST = ASSESSED[3]!; // grey, a disagreed round-1 comment
const CORE = [CARRIED, SECOND, FIRST];
const lead = () => bearer('sub-lead');
const decisionPath = (code: number, commentId: number) =>
  resultPath(`/decisions/${commentId}`, code);

describe('Round-2 decisions of the Lead (e2e)', () => {
  let a: AssessmentApp;
  let code: number;
  let roundOneId: number;
  let roundTwoId: number;

  const roundTwo = () => a.world.memberships.find((m) => m.id === roundTwoId)!;
  const roundTwoAssessment = () =>
    a.world.assessments.find((x) => x.membershipId === roundTwoId);

  beforeEach(async () => {
    a = await buildAssessmentApp(IN_LEAD_STEP);
    const built = await seedRoundTwoWorld(a, {
      core: CORE,
      changedFields: null,
      roundOneGreens: [CARRIED],
    });
    code = built.code;
    roundOneId = built.roundOneId;
    roundTwoId = built.roundTwoId;
    plantRoundOneComment(a, roundOneId, 7001, {
      state: 'disagreed',
      fieldKey: FIRST,
    });
    plantRoundOneComment(a, roundOneId, 7002, {
      state: 'disagreed',
      fieldKey: SECOND,
    });
  });

  afterEach(async () => {
    await a.app.close();
  });

  const decide = (commentId: number, decision: string, body = 'Reason given') =>
    a.send('put', decisionPath(code, commentId), {
      token: lead(),
      body: { decision, body },
    });

  it('PUT agree_program: 200 with the decision and the green field; the view then shows both', async () => {
    const res = await decide(7001, 'agree_program', '  The figure matches  ');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      status: 'pending',
      assessedBy: null,
      finishedAt: null,
      validations: [{ fieldKey: FIRST, validated: true }],
      decision: {
        decision: 'agree_program',
        body: 'The figure matches',
        decidedAt: '2026-11-25T10:00:00.000Z',
      },
    });
    expect(a.world.commentDecisions).toHaveLength(1);

    const view = await a.send('get', resultPath('', code), { token: lead() });
    const fields = view.body.data.sections.flatMap(
      (s: { fields: Array<Record<string, unknown>> }) => s.fields,
    );
    const field = fields.find((f: { key: string }) => f.key === FIRST);
    expect(field).toMatchObject({
      effectiveValidated: true,
      thread: [
        {
          commentId: 7001,
          decision: { decision: 'agree_program', body: 'The figure matches' },
        },
      ],
    });
  });

  it('PUT escalate: 200, the field stays grey and its validation is 409 ASSESSMENT_FIELD_ESCALATED', async () => {
    const res = await decide(7001, 'escalate', 'The program is wrong');

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      status: 'pending',
      validations: [],
      decision: { decision: 'escalate', body: 'The program is wrong' },
    });

    const refused = await a.send('put', resultPath('/validations', code), {
      token: lead(),
      body: { validated: true, fieldKeys: [FIRST] },
    });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('ASSESSMENT_FIELD_ESCALATED');
    expect(a.world.validations.filter((v) => v.fieldKey === FIRST)).toEqual([]);
  });

  it('DELETE: 200 with no decision, and an agreed field goes back to grey', async () => {
    await decide(7001, 'agree_program');

    const res = await a.send('delete', decisionPath(code, 7001), {
      token: lead(),
    });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      status: 'pending',
      assessedBy: null,
      finishedAt: null,
      validations: [{ fieldKey: FIRST, validated: false }],
      decision: null,
    });
    expect(a.world.commentDecisions).toEqual([]);
  });

  it('409 ASSESSMENT_DECISION_INVALID on a comment the program accepted, with nothing stored', async () => {
    plantRoundOneComment(a, roundOneId, 7003, {
      state: 'accepted',
      fieldKey: FIRST,
    });

    const res = await decide(7003, 'agree_program');

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ASSESSMENT_DECISION_INVALID');
    expect(a.world.commentDecisions).toEqual([]);
    expect(roundTwoAssessment()).toBeUndefined();
  });

  it.each([
    ['an empty text', { decision: 'escalate', body: '' }],
    ['a blank text', { decision: 'escalate', body: '   ' }],
    [
      'a text over 2,000 characters',
      { decision: 'escalate', body: 'x'.repeat(2001) },
    ],
    ['an unknown decision', { decision: 'ppu_done', body: 'Reason' }],
    ['no decision', { body: 'Reason' }],
  ])(
    '400 VALIDATION_FAILED for %s, with nothing stored',
    async (_name, body) => {
      const res = await a.send('put', decisionPath(code, 7001), {
        token: lead(),
        body,
      });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(a.world.commentDecisions).toEqual([]);
    },
  );

  it('accepts exactly 2,000 characters', async () => {
    const res = await decide(7001, 'escalate', 'x'.repeat(2000));
    expect(res.status).toBe(200);
  });

  describe('FR-12 Last agree turns it green', () => {
    it('ends Quality Assessed, queues one qaed release, closes the comment as lead_sided_program, and the ack ends the membership released_qaed', async () => {
      a.feed.script('release', (q: FeedReleaseQuery): FeedRelease => ({
        phaseYear: q.phaseYear,
        released: q.items.map((item) => ({
          resultId: item.resultId,
          resultCode: code,
          outcome: item.outcome,
        })),
        notReleased: [],
      }));
      const first = await decide(7001, 'agree_program');
      expect(first.body.data.status).toBe('pending');
      expect(a.world.releases).toEqual([]);

      const last = await decide(
        7002,
        'agree_program',
        'Agreed, evidence given',
      );

      expect(last.status).toBe(200);
      expect(last.body.data).toMatchObject({
        status: 'quality_assessed',
        assessedBy: { id: a.users.lead.id },
        finishedAt: '2026-11-25T10:00:00.000Z',
      });
      // Read after the request: the end and its release row committed with it.
      expect(a.world.releases).toHaveLength(1);
      expect(a.world.releases[0]).toMatchObject({
        timelineResultId: roundTwoId,
        outcome: 'qaed',
      });
      expect(
        a.world.comments
          .filter((c) => c.assessmentId === roundOneId)
          .map((c) => [c.id, c.state]),
      ).toEqual([
        [7001, 'lead_sided_program'],
        [7002, 'lead_sided_program'],
      ]);
      expect(a.world.comments.every((c) => c.visibleToProgramAt == null)).toBe(
        true,
      );

      // Reporting answers `released`: the round-2 membership ends.
      await vi.waitFor(() => expect(roundTwo().ended).toBe(true));
      expect(roundTwo().endReason).toBe('released_qaed');
      expect(a.world.releases[0]!.status).toBe('sent');
    });

    it('is not ended while a core field is grey: the first agree leaves one release row out and the status pending', async () => {
      const res = await decide(7001, 'agree_program');
      expect(res.body.data.status).toBe('pending');
      expect(a.world.releases).toEqual([]);
    });
  });

  describe('NFR-3 a decision racing a finish', () => {
    it('is serialized: one end, one release row, the comment closed once', async () => {
      // The row exists, so a rolled-back loser cannot undo a row it created.
      a.world.assessments.push({
        id: 1000,
        membershipId: roundTwoId,
        stepPosition: 3,
        status: 'pending',
        fieldConfigVersion: 1,
      });
      await decide(7002, 'agree_program');
      a.world.holdLockUntil = 2;

      const [decided, finished] = await Promise.all([
        decide(7001, 'agree_program'),
        a.send('post', resultPath('/finish', code), { token: lead() }),
      ]);

      // Both requests reached the assessment lock together.
      expect(
        a.world.writeLog.filter((entry) => entry === 'lockAssessment'),
      ).toHaveLength(3);
      expect([decided.status, finished.status].sort((x, y) => x - y)).toEqual([
        200, 409,
      ]);
      expect(a.world.endUpdatesMatched).toBe(1);
      expect(a.world.releases).toHaveLength(1);
      expect(roundTwoAssessment()!.status).toBe('quality_assessed');
      const closed = a.world.commentEvents.filter(
        (e) => e.toState === 'lead_sided_program',
      );
      expect(closed.map((e) => e.commentId).sort((x, y) => x - y)).toEqual([
        7001, 7002,
      ]);
    });
  });
});

// FR-9 (P2-3912 T-8): a result NEW to round 2 (a round-2 membership with no
// previous membership and no round-1 one at all) is reviewed in full by the Lead.
describe('The Lead own comment on a new round-2 result (e2e)', () => {
  let a: AssessmentApp;
  let code: number;
  let roundTwoId: number;

  beforeEach(async () => {
    a = await buildAssessmentApp(IN_LEAD_STEP);
    await seedRoundTwoWorld(a, {
      core: CORE,
      changedFields: null,
      roundOneGreens: [],
    });
    const built = await addTwoRounds(
      a,
      { resultId: 1002, previous: false },
      null,
    );
    // New to round 2: the round-1 membership the helper also writes is removed.
    a.world.memberships = a.world.memberships.filter(
      (m) => m.id !== built.roundOneId,
    );
    a.world.assessments = a.world.assessments.filter(
      (x) => x.membershipId !== built.roundOneId,
    );
    code = built.code;
    roundTwoId = built.roundTwoId;
  });

  afterEach(async () => {
    await a.app.close();
  });

  it('comments a core field, escalates that comment (200), and refuses agree_program on it (409 ASSESSMENT_DECISION_INVALID)', async () => {
    const membership = a.world.memberships.find((m) => m.id === roundTwoId)!;
    expect(membership.previousMembershipId).toBeNull();
    expect(
      a.world.memberships.filter((m) => m.resultCode === code),
    ).toHaveLength(1);

    const created = await a.send('post', resultPath('/comments', code), {
      token: lead(),
      body: { fieldKey: FIRST, body: 'The core field is wrong' },
      key: 'new-kp-comment-1',
    });
    expect(created.status).toBe(201);
    const commentId = created.body.data.id as number;
    expect(created.body.data).toMatchObject({ round: 2, state: 'open' });

    const refused = await a.send('put', decisionPath(code, commentId), {
      token: lead(),
      body: { decision: 'agree_program', body: 'Agreeing with myself' },
    });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('ASSESSMENT_DECISION_INVALID');
    expect(a.world.commentDecisions).toEqual([]);

    const escalated = await a.send('put', decisionPath(code, commentId), {
      token: lead(),
      body: { decision: 'escalate', body: 'Escalating my own finding' },
    });
    expect(escalated.status).toBe(200);
    expect(escalated.body.data).toMatchObject({
      status: 'pending',
      validations: [],
      decision: { decision: 'escalate', body: 'Escalating my own finding' },
    });
    expect(
      a.world.commentDecisions.map((d) => [d.commentId, d.decision]),
    ).toEqual([[commentId, 'escalate']]);
  });
});
