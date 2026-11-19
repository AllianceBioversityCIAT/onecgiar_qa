// @akili-spec escalation/round-2
import {
  bearer,
  buildAssessmentApp,
  type AssessmentApp,
} from './support/assessment-app.js';
import { ASSESSED, resultPath } from './support/assessment-seed.js';
import {
  IN_LEAD_STEP,
  plantRoundOneComment,
  seedRoundTwoWorld,
} from './support/round-two-fixture.js';

// The end of the Lead's review over real HTTP (P2-3912 T-9; FR-11, FR-12, FR-13,
// FR-15; NFR-3): the HTTP path only. Every branch of the end rules is a unit
// spec over the in-memory stores (`assessment-round-two-end.service.spec.ts`).
// Expected values are written out from the scenarios. There is no delete route
// yet (T-10), so a delete after the end is covered when that route lands. The
// decision-vs-finish race (both orders) is in `assessment-round-two-decisions.e2e-spec.ts`.

const CARRIED = ASSESSED[1]!; // green in round 1, uncommented, unchanged
const SECOND = ASSESSED[2]!; // grey, a disagreed round-1 comment
const FIRST = ASSESSED[3]!; // grey, a disagreed round-1 comment
const CORE = [CARRIED, SECOND, FIRST];
const lead = () => bearer('sub-lead');
const admin = () => bearer('sub-admin');
const decisionPath = (code: number, commentId: number) =>
  resultPath(`/decisions/${commentId}`, code);

describe('The end of the Lead review (e2e)', () => {
  let a: AssessmentApp;
  let code: number;
  let roundOneId: number;
  let roundTwoId: number;

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
  const finish = () =>
    a.send('post', resultPath('/finish', code), { token: lead() });
  /** FIRST escalated and SECOND agreed: the review is ready to end `escalated`. */
  const decideBoth = async () => {
    await decide(7001, 'escalate');
    await decide(7002, 'agree_program');
  };
  const roundOneStates = () =>
    a.world.comments
      .filter((c) => c.assessmentId === roundOneId)
      .map((c) => [c.id, c.state]);

  describe('FR-11 Escalated', () => {
    it('ends Pending for TPB review with no release row, the comments moved, and the status read the same in the view and the worklist', async () => {
      await decideBoth();

      const res = await finish();

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        status: 'escalated',
        assessedBy: { id: a.users.lead.id },
        finishedAt: '2026-11-25T10:00:00.000Z',
      });
      expect(roundTwoAssessment()).toMatchObject({ status: 'escalated' });
      // The release table and the comment states, not the status alone.
      expect(a.world.releases).toEqual([]);
      expect(roundOneStates()).toEqual([
        [7001, 'escalated'],
        [7002, 'lead_sided_program'],
      ]);
      // FR-15: nothing is made visible to the program.
      expect(a.world.comments.every((c) => c.visibleToProgramAt == null)).toBe(
        true,
      );

      const view = await a.send('get', resultPath('', code), {
        token: lead(),
      });
      expect(view.body.data.header.status).toBe('pending_tpb_review');
      expect(view.body.data.readOnlyReason).toBe('finished');
      const listed = await a.send(
        'get',
        '/timelines/1/worklist?status=pending_tpb_review',
        { token: admin() },
      );
      expect(
        (
          listed.body.data.rows as Array<{
            membershipId: number;
            status: string;
          }>
        ).map((r) => [r.membershipId, r.status]),
      ).toEqual([[roundTwoId, 'pending_tpb_review']]);
      expect(listed.body.data.counters).toMatchObject({ pending: 0 });
    });
  });

  describe('FR-11 Undecided and FR-13', () => {
    it('409 ASSESSMENT_CORE_UNDECIDED names the grey fields without a decision, and nothing is written', async () => {
      await decide(7001, 'escalate');
      const before = JSON.stringify([
        a.world.comments,
        a.world.commentEvents,
        a.world.commentDecisions,
        a.world.validations,
      ]);

      const res = await finish();

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ASSESSMENT_CORE_UNDECIDED');
      expect(res.body.error.fields).toEqual([SECOND]);
      expect(roundTwoAssessment()).toMatchObject({ status: 'pending' });
      expect(a.world.releases).toEqual([]);
      expect(
        JSON.stringify([
          a.world.comments,
          a.world.commentEvents,
          a.world.commentDecisions,
          a.world.validations,
        ]),
      ).toBe(before);
    });
  });

  describe('NFR-3 concurrent finishes', () => {
    it('five parallel finishes: exactly one 200, four 409 ASSESSMENT_FINISHED, one end, no decision applied twice', async () => {
      await decideBoth();
      a.world.holdLockUntil = 5;

      const responses = await Promise.all([1, 2, 3, 4, 5].map(() => finish()));

      expect(responses.filter((r) => r.status === 200)).toHaveLength(1);
      const refused = responses.filter((r) => r.status === 409);
      expect(refused).toHaveLength(4);
      for (const res of refused) {
        expect(res.body.error.code).toBe('ASSESSMENT_FINISHED');
      }
      expect(a.world.endUpdatesMatched).toBe(1);
      expect(a.world.releases).toEqual([]);
      expect(
        a.world.audits.filter((x) => x.action.startsWith('end_')),
      ).toHaveLength(1);
      expect(a.world.commentEvents).toHaveLength(2);
    });
  });

  describe('FR-11 frozen after the end', () => {
    it('validation, comment, decision, clear, withdraw and a second finish are all 409 ASSESSMENT_FINISHED', async () => {
      // An own comment on the carried green field: `open` at the end, so only a withdraw can reach it.
      const created = await a.send('post', resultPath('/comments', code), {
        token: lead(),
        body: { fieldKey: CARRIED, body: 'Looks fine, noting it' },
        key: 'frozen-own-comment-1',
      });
      expect(created.status).toBe(201);
      const ownId = created.body.data.id as number;
      await decideBoth();
      expect((await finish()).status).toBe(200);

      const attempts: Array<
        [string, () => Promise<{ status: number; body: any }>]
      > = [
        [
          'validation',
          () =>
            a.send('put', resultPath('/validations', code), {
              token: lead(),
              body: { validated: false, fieldKeys: [CARRIED] },
            }),
        ],
        [
          'comment',
          () =>
            a.send('post', resultPath('/comments', code), {
              token: lead(),
              body: { fieldKey: FIRST, body: 'A late comment' },
              key: 'frozen-late-comment-1',
            }),
        ],
        ['decision', () => decide(7001, 'agree_program')],
        [
          'clear',
          () => a.send('delete', decisionPath(code, 7001), { token: lead() }),
        ],
        [
          'withdraw',
          () =>
            a.send('post', `/assessment-comments/${ownId}/withdraw`, {
              token: lead(),
            }),
        ],
        ['finish', () => finish()],
      ];
      for (const [name, attempt] of attempts) {
        const res = await attempt();
        expect([name, res.status, res.body.error?.code]).toEqual([
          name,
          409,
          'ASSESSMENT_FINISHED',
        ]);
      }
      expect(a.world.comments.find((c) => c.id === ownId)!.state).toBe('open');
    });
  });
});
