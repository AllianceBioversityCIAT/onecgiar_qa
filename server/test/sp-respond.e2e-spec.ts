// P2-3911 (SP view): a program responds to QA comments, and the assessor
// answers a clarification, over real HTTP. A response changes the comment
// only: never a validation, the assessment status, a release or the
// membership. The clock is the app's ADMIN_CONFIG_CLOCK override.
import {
  bearer,
  buildAssessmentApp,
  withoutRequestMeta,
  type AssessmentApp,
} from './support/assessment-app.js';
import { LogSpy } from './support/log-spy.js';
import {
  AFTER_STEP_2,
  IN_STEP_1,
  IN_STEP_2,
  seedSpWorld,
  type SpWorld,
} from './support/sp-seed.js';

const respondPath = (id: number | string) => `/sp/comments/${id}/response`;

describe('SP responses and clarification answers (e2e)', () => {
  let a: AssessmentApp;
  let w: SpWorld;
  let token: string;

  const build = async (at: Date) => {
    a = await buildAssessmentApp(at);
    w = await seedSpWorld(a);
    token = await a.spLogin({
      email: 'sp-user@example.org',
      name: 'Sam Program',
    });
  };
  const respond = (id: number | string, body: object, as = token) =>
    a.spSend('put', respondPath(id), as, body);
  const answer = (id: number, body: object, sub = 'sub-policy') =>
    a.send('post', `/assessment-comments/${id}/clarification-answer`, {
      token: bearer(sub),
      body,
    });
  const commentState = (id: number) =>
    a.world.comments.find((c) => c.id === id)!.state;
  /** What a response must never touch. */
  const untouched = () =>
    JSON.stringify({
      validations: a.world.validations,
      assessments: a.world.assessments,
      releases: a.world.releases,
      memberships: a.world.memberships,
      audits: a.world.audits,
    });

  afterEach(async () => {
    vi.restoreAllMocks();
    await a.app.close();
  });

  describe('inside the programs step', () => {
    beforeEach(() => build(IN_STEP_2));

    it.each([
      ['accept', undefined, 'accepted'],
      ['accept_with_comment', 'Fine, we will fix it', 'accepted_with_comment'],
      ['disagree', 'The value is right', 'disagreed'],
      [
        'request_clarification',
        'What is wrong with it?',
        'clarification_requested',
      ],
    ])(
      'records a %s response and moves the comment to its state',
      async (kind, body, state) => {
        const before = untouched();
        const res = await respond(w.open, {
          kind,
          ...(body === undefined ? {} : { body: `  ${body}  ` }),
        }).expect(200);
        const responseId = a.world.spResponses.at(-1)!.id;
        expect(res.body.data.comment).toMatchObject({
          id: w.open,
          state,
          response: {
            id: responseId,
            kind,
            body: body ?? null,
            respondedBy: { name: 'Sam Program' },
            respondedAt: IN_STEP_2.toISOString(),
          },
        });
        expect(res.body.data.counts).toEqual({
          comments: 2,
          answered: state === 'clarification_requested' ? 1 : 2,
        });
        expect(commentState(w.open)).toBe(state);
        expect(a.world.spResponses.at(-1)).toEqual({
          id: responseId,
          commentId: w.open,
          kind,
          body: body ?? null,
          responderName: 'Sam Program',
          responderEmail: 'sp-user@example.org',
          programId: 1,
          createdAt: IN_STEP_2,
        });
        expect(a.world.commentEvents).toEqual([
          {
            commentId: w.open,
            actorId: null,
            actorRole: 'PROGRAM',
            fromState: 'open',
            toState: state,
            spResponseId: responseId,
            at: IN_STEP_2,
          },
        ]);
        expect(res.text).not.toContain('sp-user@example.org');
        // Never a validation, an assessment status, a release, a membership or an audit row.
        expect(untouched()).toBe(before);
      },
    );

    it.each([
      ['accept with a body', { kind: 'accept', body: 'x' }],
      ['accept with an empty body', { kind: 'accept', body: '' }],
      ['accept_with_comment without a body', { kind: 'accept_with_comment' }],
      ['disagree with a blank body', { kind: 'disagree', body: '   ' }],
      [
        'request_clarification with null',
        { kind: 'request_clarification', body: null },
      ],
      [
        'a body over 2,000 characters',
        { kind: 'disagree', body: 'x'.repeat(2001) },
      ],
      ['an unknown kind', { kind: 'escalate', body: 'x' }],
      ['an unknown field', { kind: 'accept', note: 'x' }],
    ])(
      'refuses %s with 400 VALIDATION_FAILED and writes nothing',
      async (_, body) => {
        const res = await respond(w.open, body).expect(400);
        expect(res.body.error.code).toBe('VALIDATION_FAILED');
        expect(a.world.spResponses).toHaveLength(1);
        expect(commentState(w.open)).toBe('open');
      },
    );

    it('accepts exactly 2,000 characters', async () => {
      await respond(w.open, {
        kind: 'disagree',
        body: 'é'.repeat(2000),
      }).expect(200);
    });

    it('keeps the history and lets the latest response count', async () => {
      await respond(w.open, { kind: 'accept' }).expect(200);
      const res = await respond(w.open, {
        kind: 'disagree',
        body: 'On second thought, no',
      }).expect(200);
      expect(commentState(w.open)).toBe('disagreed');
      expect(res.body.data.comment.response.kind).toBe('disagree');
      expect(
        res.body.data.comment.history.map((h: { kind: string }) => h.kind),
      ).toEqual(['accept', 'disagree']);
      // The same answer again is a change too (a new row), not an error.
      await respond(w.open, { kind: 'disagree', body: 'Still no' }).expect(200);
      expect(a.world.commentEvents.map((e) => e.toState)).toEqual([
        'accepted',
        'disagreed',
        'disagreed',
      ]);
      // The SP view reads the same thread.
      const view = await a.spSend(
        'get',
        `/sp/timelines/1/results/${w.codeA}`,
        token,
      );
      expect(view.text).toContain('Still no');
    });

    it('answers a hidden, withdrawn, other-program or missing comment with the same 404', async () => {
      a.world.comments.push({
        id: 21,
        assessmentId: 100,
        authorId: a.users.policy.id,
        state: 'open',
        body: 'x',
      });
      // A comment of program 2.
      a.world.assessments.push({
        id: 101,
        membershipId: 3,
        stepPosition: 1,
        status: 'returned',
      });
      a.world.comments.push({
        id: 22,
        assessmentId: 101,
        authorId: a.users.policy.id,
        state: 'open',
        visibleToProgramAt: new Date('2026-11-09T10:00:00Z'),
      });
      const missing = await respond(999999, { kind: 'accept' }).expect(404);
      expect(missing.body.error.code).toBe('SP_NOT_FOUND');
      for (const id of [w.hidden, w.withdrawn, 21, 22]) {
        const res = await respond(id, { kind: 'accept' }).expect(404);
        expect(withoutRequestMeta(res.body)).toEqual(
          withoutRequestMeta(missing.body),
        );
      }
      expect(a.world.spResponses).toHaveLength(1);
      // An admin session may respond for any program.
      const admin = await a.spLogin({
        programCode: null,
        isReportingAdmin: true,
        name: 'Ada Admin',
      });
      await respond(22, { kind: 'accept' }, admin).expect(200);
      expect(a.world.spResponses.at(-1)).toMatchObject({
        commentId: 22,
        programId: 2,
        responderName: 'Ada Admin',
      });
    });

    it('refuses a state no response may start from with 409 SP_COMMENT_NOT_RESPONDABLE', async () => {
      a.world.comments.find((c) => c.id === w.open)!.state = 'escalated';
      const res = await respond(w.open, { kind: 'accept' }).expect(409);
      expect(res.body.error.code).toBe('SP_COMMENT_NOT_RESPONDABLE');
      expect(a.world.spResponses).toHaveLength(1);
    });

    it('lets the database decide a race: a state changed after the read is a 409 and nothing is written', async () => {
      a.world.beforeLockAssessment = () => {
        a.world.comments.find((c) => c.id === w.open)!.state = 'disagreed';
        a.world.beforeLockAssessment = null;
      };
      const res = await respond(w.open, { kind: 'accept' }).expect(409);
      expect(res.body.error.code).toBe('SP_COMMENT_NOT_RESPONDABLE');
      expect(a.world.spResponses).toHaveLength(1);
      expect(a.world.commentEvents).toEqual([]);
      expect(a.world.writeLog).toEqual([
        'lockTimelineShared',
        'lockAssessment',
        'setCommentState',
      ]);
    });

    it('writes in the module lock order', async () => {
      await respond(w.open, { kind: 'accept' }).expect(200);
      expect(a.world.writeLog).toEqual([
        'lockTimelineShared',
        'lockAssessment',
        'setCommentState',
        'insertResponse',
        'insertCommentEvent',
      ]);
    });

    it('updates the answered counts of the SP list and of the assessor worklist', async () => {
      const worklist = async () =>
        (
          await a.send('get', '/timelines/1/worklist', {
            token: bearer('sub-policy'),
          })
        ).body.data.rows.find(
          (r: { resultCode: number }) => r.resultCode === w.codeA,
        );
      expect((await worklist()).answeredBySp).toBe(1);
      await respond(w.open, { kind: 'disagree', body: 'No' }).expect(200);
      expect((await worklist()).answeredBySp).toBe(2);
      const list = await a.spSend('get', '/sp/timelines/1/results', token);
      expect(
        list.body.data.rows.find(
          (r: { resultCode: number }) => r.resultCode === w.codeA,
        ),
      ).toMatchObject({ comments: 2, answered: 2 });
      // Sorting by answered uses the same count.
      const sorted = await a.send(
        'get',
        '/timelines/1/worklist?sort=answered&dir=desc',
        { token: bearer('sub-policy') },
      );
      expect(sorted.status).toBe(200);
      expect(sorted.body.data.rows[0].resultCode).toBe(w.codeA);
    });

    it('runs a clarification round trip: request, answer by the author, respond again', async () => {
      await respond(w.open, {
        kind: 'request_clarification',
        body: 'Which link?',
      }).expect(200);
      const requestId = a.world.spResponses.at(-1)!.id;
      const list = await a.spSend('get', '/sp/timelines/1/results', token);
      expect(
        list.body.data.rows.find(
          (r: { resultCode: number }) => r.resultCode === w.codeA,
        ).status,
      ).toBe('clarification_requested');

      // Not the author, not pending, an admin, a stranger.
      const other = await answer(w.open, { body: 'x' }, 'sub-policy2').expect(
        403,
      );
      expect(other.body.error.code).toBe('ASSESSMENT_NOT_COMMENT_AUTHOR');
      const admin = await answer(w.open, { body: 'x' }, 'sub-admin').expect(
        403,
      );
      expect(admin.body.error.code).toBe('ASSESSMENT_READ_ONLY');
      const stranger = await answer(w.open, { body: 'x' }, 'sub-other').expect(
        404,
      );
      expect(stranger.body.error.code).toBe('ASSESSMENT_NOT_FOUND');
      await answer(w.open, { body: '  ' }).expect(400);

      a.world.commentEvents = [];
      const res = await answer(w.open, { body: '  The DOI link  ' }).expect(
        200,
      );
      expect(res.body.data).toMatchObject({
        commentId: w.open,
        state: 'open',
        response: {
          id: requestId,
          kind: 'request_clarification',
          respondedBy: { name: 'Sam Program', email: 'sp-user@example.org' },
        },
        clarifications: [
          {
            requestId,
            question: 'Which link?',
            requestedAt: IN_STEP_2.toISOString(),
            answer: {
              body: 'The DOI link',
              answeredAt: IN_STEP_2.toISOString(),
            },
          },
        ],
      });
      expect(commentState(w.open)).toBe('open');
      expect(a.world.clarificationAnswers).toEqual([
        expect.objectContaining({
          commentId: w.open,
          responseId: requestId,
          authorId: a.users.policy.id,
          body: 'The DOI link',
        }),
      ]);
      expect(a.world.commentEvents).toEqual([
        {
          commentId: w.open,
          actorId: a.users.policy.id,
          actorRole: 'ASSESSOR',
          fromState: 'clarification_requested',
          toState: 'open',
          at: IN_STEP_2,
        },
      ]);
      const again = await answer(w.open, { body: 'Twice' }).expect(409);
      expect(again.body.error.code).toBe('CLARIFICATION_NOT_PENDING');

      // The program sees the answer and responds again.
      const view = await a.spSend(
        'get',
        `/sp/timelines/1/results/${w.codeA}`,
        token,
      );
      expect(view.text).toContain('The DOI link');
      await respond(w.open, { kind: 'accept' }).expect(200);
      expect(commentState(w.open)).toBe('accepted');
    });

    it('lets the assessor read every program thread of a result, with the responder email', async () => {
      await respond(w.open, { kind: 'disagree', body: 'No' }).expect(200);
      const res = await a.send(
        'get',
        `/timelines/1/results/${w.codeA}/sp-responses`,
        { token: bearer('sub-policy') },
      );
      expect(res.status).toBe(200);
      expect(res.body.data.comments).toEqual([
        expect.objectContaining({
          commentId: w.open,
          state: 'disagreed',
          response: expect.objectContaining({
            kind: 'disagree',
            body: 'No',
            respondedBy: { name: 'Sam Program', email: 'sp-user@example.org' },
          }),
        }),
        expect.objectContaining({ commentId: w.accepted, state: 'accepted' }),
      ]);
      const outside = await a.send(
        'get',
        `/timelines/1/results/7002/sp-responses`,
        { token: bearer('sub-other') },
      );
      expect(outside.status).toBe(404);
      expect(outside.body.error.code).toBe('ASSESSMENT_NOT_FOUND');
    });

    it('logs one fixed-shape sp_response line, with ids and words only', async () => {
      const spy = new LogSpy();
      spy.attach();
      try {
        await respond(w.open, {
          kind: 'disagree',
          body: 'Planted-body-text',
        }).expect(200);
        await respond(999999, { kind: 'accept' }).expect(404);
        const lines = spy.lines
          .filter((l) => l.includes('"event":"sp_response"'))
          .map((l) => JSON.parse(l) as Record<string, unknown>);
        expect(
          lines.map(({ requestId: _r, sessionId: _s, ...rest }) => rest),
        ).toEqual([
          {
            event: 'sp_response',
            action: 'respond',
            commentId: w.open,
            kind: 'disagree',
            outcome: 'ok',
          },
          {
            event: 'sp_response',
            action: 'respond',
            commentId: 999999,
            kind: 'accept',
            outcome: 'refused',
            reason: 'SP_NOT_FOUND',
          },
        ]);
        const all = spy.lines.join('\n');
        for (const secret of [
          'Planted-body-text',
          'sp-user@example.org',
          'Sam Program',
          token,
        ]) {
          expect(all).not.toContain(secret);
        }
      } finally {
        spy.detach();
      }
    });
  });

  describe('outside the programs step', () => {
    it('before it: the comment is not visible yet, so it is the 404', async () => {
      await build(IN_STEP_1);
      const res = await respond(w.open, { kind: 'accept' }).expect(404);
      expect(res.body.error.code).toBe('SP_NOT_FOUND');
    });

    it('after it: 409 SP_STEP_CLOSED, and the assessor can no longer answer (409 ASSESSMENT_STEP_CLOSED)', async () => {
      await build(IN_STEP_2);
      await respond(w.open, {
        kind: 'request_clarification',
        body: 'Which link?',
      }).expect(200);
      a.setClock(AFTER_STEP_2);
      // A session lasts 8 h: a new one for the new day.
      token = await a.spLogin();
      const res = await respond(w.open, { kind: 'accept' }).expect(409);
      expect(res.body.error.code).toBe('SP_STEP_CLOSED');
      const late = await answer(w.open, { body: 'Too late' }).expect(409);
      expect(late.body.error.code).toBe('ASSESSMENT_STEP_CLOSED');
      expect(commentState(w.open)).toBe('clarification_requested');
    });

    it('closes at the last minute of the step (Rome)', async () => {
      await build(IN_STEP_2);
      // 2026-11-20T23:59 Rome = 22:59 UTC (UTC+1 in November).
      a.setClock(new Date('2026-11-20T22:59:59Z'));
      token = await a.spLogin();
      await respond(w.open, { kind: 'accept' }).expect(200);
      a.setClock(new Date('2026-11-20T23:00:00Z'));
      await respond(w.open, { kind: 'disagree', body: 'x' }).expect(409);
    });
  });
});
