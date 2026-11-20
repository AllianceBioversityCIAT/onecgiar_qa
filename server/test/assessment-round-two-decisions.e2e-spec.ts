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

  it('O-1: validating a core field whose round-1 comment is open and undecided is 409 ASSESSMENT_CORE_COMMENT_UNDECIDED; agreeing then ends the review and closes the comment', async () => {
    // The qatest path: a round-1 comment still `open` with no decision.
    a.world.comments.find((c) => c.id === 7001)!.state = 'open';
    a.world.comments.find((c) => c.id === 7002)!.state = 'open';
    const validate = (fieldKeys: string[]) =>
      a.send('put', resultPath('/validations', code), {
        token: lead(),
        body: { validated: true, fieldKeys },
      });

    const refused = await validate([FIRST, SECOND]);

    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('ASSESSMENT_CORE_COMMENT_UNDECIDED');
    expect(refused.body.error.fields).toEqual([FIRST, SECOND].sort());
    expect(
      a.world.validations.filter((v) => v.assessmentId !== roundOneId),
    ).toEqual([]);
    expect(roundTwoAssessment()?.status ?? 'pending').toBe('pending');

    await decide(7001, 'agree_program');
    const last = await decide(7002, 'agree_program');

    expect(last.body.data.status).toBe('quality_assessed');
    expect(
      a.world.comments
        .filter((c) => c.assessmentId === roundOneId)
        .map((c) => [c.id, c.state]),
    ).toEqual([
      [7001, 'lead_sided_program'],
      [7002, 'lead_sided_program'],
    ]);
  });

  it('T-17: while another comment on the field is escalated the rest offers only escalate; clearing restores both choices', async () => {
    plantRoundOneComment(a, roundOneId, 7003, {
      state: 'disagreed',
      fieldKey: FIRST,
    });
    const threadOf = async () => {
      const view = await a.send('get', resultPath('', code), { token: lead() });
      return view.body.data.sections
        .flatMap(
          (s: { fields: Array<{ key: string; thread: unknown[] }> }) =>
            s.fields,
        )
        .find((f: { key: string }) => f.key === FIRST).thread;
    };
    const both = ['agree_program', 'escalate'];

    await decide(7001, 'escalate');
    expect(await threadOf()).toMatchObject([
      { commentId: 7001, decidable: true, choices: both },
      { commentId: 7003, decidable: true, choices: ['escalate'] },
    ]);
    const refused = await decide(7003, 'agree_program');
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('ASSESSMENT_FIELD_ESCALATED');

    const cleared = await a.send('delete', decisionPath(code, 7001), {
      token: lead(),
    });
    expect(cleared.status).toBe(200);
    expect(await threadOf()).toMatchObject([
      { commentId: 7001, choices: both },
      { commentId: 7003, choices: both },
    ]);
  });

  it('T-17: once the review is finished the undecided round-1 comment on an escalated field reads not decidable, the decided one keeps its decision', async () => {
    plantRoundOneComment(a, roundOneId, 7003, {
      state: 'disagreed',
      fieldKey: FIRST,
    });
    const threadOf = async () => {
      const view = await a.send('get', resultPath('', code), { token: lead() });
      return view.body.data.sections
        .flatMap(
          (s: { fields: Array<{ key: string; thread: unknown[] }> }) =>
            s.fields,
        )
        .find((f: { key: string }) => f.key === FIRST).thread;
    };

    expect(await threadOf()).toMatchObject([
      { commentId: 7001, decidable: true },
      { commentId: 7003, decidable: true },
    ]);

    expect((await decide(7001, 'escalate')).status).toBe(200);
    expect((await decide(7002, 'escalate')).status).toBe(200);
    const done = await a.send('post', resultPath('/finish', code), {
      token: lead(),
    });
    expect(done.status).toBe(200);

    expect(await threadOf()).toMatchObject([
      {
        commentId: 7001,
        decision: { decision: 'escalate' },
        decidable: false,
        choices: [],
      },
      { commentId: 7003, decidable: false, choices: [] },
    ]);
  });

  it('T-17: after the Lead step closes (assessment still pending) the thread items and the own comments read not decidable', async () => {
    const created = await a.send('post', resultPath('/comments', code), {
      token: lead(),
      body: { fieldKey: FIRST, body: 'My own finding' },
      key: 'own-closed-1',
    });
    expect(created.status).toBe(201);
    const fieldOf = async () => {
      const view = await a.send('get', resultPath('', code), { token: lead() });
      return view.body.data.sections
        .flatMap((s: { fields: Array<Record<string, unknown>> }) => s.fields)
        .find((f: { key: string }) => f.key === FIRST);
    };

    expect(await fieldOf()).toMatchObject({
      thread: [{ commentId: 7001, decidable: true }],
      comments: [{ decidable: true, choices: ['escalate'] }],
    });

    a.setClock(new Date('2026-11-28T10:00:00Z')); // step 3 closed
    expect(roundTwoAssessment()?.status).toBe('pending');

    expect(await fieldOf()).toMatchObject({
      thread: [{ commentId: 7001, decidable: false, choices: [] }],
      comments: [{ decidable: false, choices: [] }],
    });
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

  describe('NFR-3 a decision racing a finish: both orders (T-9)', () => {
    // The fake does not model the row lock: the loser reads the row under the
    // lock only after the winner committed (`beforeLockAssessment`), which is the
    // order a real row lock gives. State: CORE[2] (FIRST) escalated and CORE[1]
    // (SECOND) agreed, so a finish ends `escalated`; changing FIRST to agree
    // would end Quality Assessed.
    const finish = () =>
      a.send('post', resultPath('/finish', code), { token: lead() });
    const states = () =>
      a.world.comments
        .filter((c) => c.assessmentId === roundOneId)
        .map((c) => [c.id, c.state]);
    const arrange = async () => {
      await decide(7001, 'escalate');
      await decide(7002, 'agree_program');
    };

    it('finish wins: the review ends escalated, the late decision is 409 ASSESSMENT_FINISHED and nothing of it is stored', async () => {
      await arrange();
      let finished: Awaited<ReturnType<typeof finish>> | undefined;
      a.world.beforeLockAssessment = async () => {
        a.world.beforeLockAssessment = null;
        finished = await finish();
      };

      const decided = await decide(7001, 'agree_program');

      expect(finished?.status).toBe(200);
      expect(finished?.body.data.status).toBe('escalated');
      expect(decided.status).toBe(409);
      expect(decided.body.error.code).toBe('ASSESSMENT_FINISHED');
      expect(roundTwoAssessment()!.status).toBe('escalated');
      expect(a.world.releases).toEqual([]);
      expect(
        a.world.commentDecisions.map((d) => [d.commentId, d.decision]),
      ).toEqual([
        [7001, 'escalate'],
        [7002, 'agree_program'],
      ]);
      expect(states()).toEqual([
        [7001, 'escalated'],
        [7002, 'lead_sided_program'],
      ]);
      expect(a.world.endUpdatesMatched).toBe(1);
    });

    it('decide wins: the last agree ends Quality Assessed with one qaed release, and the late finish is 409 ASSESSMENT_FINISHED', async () => {
      await arrange();
      let decided: Awaited<ReturnType<typeof decide>> | undefined;
      a.world.beforeLockAssessment = async () => {
        a.world.beforeLockAssessment = null;
        decided = await decide(7001, 'agree_program');
      };

      const finished = await finish();

      expect(decided?.status).toBe(200);
      expect(decided?.body.data.status).toBe('quality_assessed');
      expect(finished.status).toBe(409);
      expect(finished.body.error.code).toBe('ASSESSMENT_FINISHED');
      expect(roundTwoAssessment()!.status).toBe('quality_assessed');
      expect(a.world.releases).toHaveLength(1);
      expect(a.world.releases[0]).toMatchObject({
        timelineResultId: roundTwoId,
        outcome: 'qaed',
      });
      expect(states()).toEqual([
        [7001, 'lead_sided_program'],
        [7002, 'lead_sided_program'],
      ]);
      expect(a.world.endUpdatesMatched).toBe(1);
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

  it('T-16: a reload shows the Lead own comment with its escalate decision; before the decision it is decidable with decision null', async () => {
    const ownComments = async () => {
      const view = await a.send('get', resultPath('', code), {
        token: lead(),
      });
      const fields = view.body.data.sections.flatMap(
        (s: { fields: Array<{ key: string; comments: unknown[] }> }) =>
          s.fields,
      );
      return fields.find((f: { key: string }) => f.key === FIRST).comments;
    };
    const created = await a.send('post', resultPath('/comments', code), {
      token: lead(),
      body: { fieldKey: FIRST, body: 'The core field is wrong' },
      key: 'own-reload-1',
    });
    const commentId = created.body.data.id as number;

    expect(await ownComments()).toMatchObject([
      { id: commentId, decision: null, decidable: true, choices: ['escalate'] },
    ]);

    await a.send('put', decisionPath(code, commentId), {
      token: lead(),
      body: { decision: 'escalate', body: 'Escalating my own finding' },
    });

    expect(await ownComments()).toMatchObject([
      {
        id: commentId,
        decision: {
          decision: 'escalate',
          body: 'Escalating my own finding',
          decidedAt: '2026-11-25T10:00:00.000Z',
        },
        decidable: true,
        choices: ['escalate'],
      },
    ]);
  });

  it('T-16: after the review ends the own comment is not decidable and keeps its decision; a withdrawn one reads decision null', async () => {
    const commentsOf = async () => {
      const view = await a.send('get', resultPath('', code), {
        token: lead(),
      });
      return view.body.data.sections
        .flatMap(
          (s: { fields: Array<{ key: string; comments: unknown[] }> }) =>
            s.fields,
        )
        .find((f: { key: string }) => f.key === FIRST).comments;
    };
    const post = async (key: string) =>
      (
        await a.send('post', resultPath('/comments', code), {
          token: lead(),
          body: { fieldKey: FIRST, body: 'A finding' },
          key,
        })
      ).body.data.id as number;
    const escalated = await post('own-end-1');
    const withdrawn = await post('own-end-2');
    for (const id of [escalated, withdrawn]) {
      await a.send('put', decisionPath(code, id), {
        token: lead(),
        body: { decision: 'escalate', body: 'Escalating' },
      });
    }
    await a.send('post', `/assessment-comments/${withdrawn}/withdraw`, {
      token: lead(),
      body: {},
    });
    a.world.assessments.find((x) => x.membershipId === roundTwoId)!.status =
      'escalated';

    expect(await commentsOf()).toMatchObject([
      {
        id: escalated,
        decision: { decision: 'escalate' },
        decidable: false,
        choices: [],
      },
      { id: withdrawn, decision: null, decidable: false, choices: [] },
    ]);
  });
});
