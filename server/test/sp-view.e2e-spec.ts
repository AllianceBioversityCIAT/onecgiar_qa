// P2-3911 (SP view): the /sp reads over real HTTP. Scope (a non-admin session
// sees only its program; an admin names one), the byte-identical 404, the
// programs-step window for comment visibility, filters, counts, and the
// privacy rule: no assessor identity in any SP answer.
import request from 'supertest';
import {
  bearer,
  buildAssessmentApp,
  withoutRequestMeta,
  type AssessmentApp,
} from './support/assessment-app.js';
import {
  AFTER_STEP_2,
  FIELD_A,
  FIELD_B,
  IN_STEP_1,
  IN_STEP_2,
  PLANTED,
  seedSpWorld,
  type SpWorld,
} from './support/sp-seed.js';
import { ASSESSED, resultPath } from './support/assessment-seed.js';
import { LogSpy } from './support/log-spy.js';
import {
  IN_LEAD_STEP,
  plantProgramResponse,
  plantRoundOneComment,
  seedRoundTwoWorld,
} from './support/round-two-fixture.js';

type Field = {
  key: string;
  comments: Array<Record<string, unknown>>;
};

const fieldsOf = (data: {
  sections: Array<{ fields: Field[] }>;
  other: Field[];
}): Field[] => [...data.sections.flatMap((s) => s.fields), ...data.other];

describe('SP view reads (e2e)', () => {
  let a: AssessmentApp;
  let w: SpWorld;
  let token: string;

  const build = async (at: Date) => {
    a = await buildAssessmentApp(at, {
      nicknames: { policy: PLANTED.nickname, policy2: PLANTED.nickname2 },
      names: { policy: { first: PLANTED.first, last: PLANTED.last } },
    });
    w = await seedSpWorld(a);
    token = await a.spLogin();
  };
  const get = (path: string, as: string = token) => a.spSend('get', path, as);

  afterEach(async () => {
    await a.app.close();
  });

  describe('inside the programs step', () => {
    beforeEach(() => build(IN_STEP_2));

    it('lists the official timeline and the additional ones covering the program, with the programs step', async () => {
      const res = await get('/sp/timelines').expect(200);
      expect(res.body.data).toEqual({
        timelines: [
          {
            id: 1,
            name: 'Official',
            kind: 'official',
            step: {
              position: 2,
              name: 'Programs review',
              opensAt: '2026-11-11T00:00',
              closesAt: '2026-11-20T23:59',
              state: 'in_progress',
            },
          },
          {
            id: 3,
            name: 'Additional for all',
            kind: 'additional',
            step: expect.objectContaining({ position: 2 }),
          },
        ],
        defaultTimelineId: 1,
      });
    });

    it('lists the program results with comments, answered, updated and status', async () => {
      const res = await get('/sp/timelines/1/results').expect(200);
      expect(res.body.data.rows).toEqual([
        {
          resultCode: w.codeA,
          title: 'Result A',
          updated: true,
          resultType: { key: 'policy_change', label: 'policy_change' },
          comments: 2,
          answered: 1,
          status: 'returned_to_program',
        },
        {
          resultCode: 7003,
          title: 'Result C',
          updated: false,
          resultType: { key: 'KP', label: 'Knowledge product' },
          comments: 0,
          answered: 0,
          status: 'pending',
        },
      ]);
      expect(res.body.data.options).toEqual({
        statuses: [
          { key: 'pending', label: 'Pending' },
          { key: 'returned_to_program', label: 'Returned to program' },
        ],
        resultTypes: [
          { key: 'KP', label: 'Knowledge product' },
          { key: 'policy_change', label: 'policy_change' },
        ],
      });
      expect(res.body.data.step.state).toBe('in_progress');
    });

    it('filters by status and result type on the server', async () => {
      const byStatus = await get(
        '/sp/timelines/1/results?status=pending',
      ).expect(200);
      expect(
        byStatus.body.data.rows.map(
          (r: { resultCode: number }) => r.resultCode,
        ),
      ).toEqual([7003]);
      const byType = await get(
        '/sp/timelines/1/results?resultTypeKey=policy_change,INNOVATION_DEV',
      ).expect(200);
      expect(
        byType.body.data.rows.map((r: { resultCode: number }) => r.resultCode),
      ).toEqual([w.codeA]);
      // The options are those of the unfiltered list.
      expect(byType.body.data.options.resultTypes).toHaveLength(2);
      await get('/sp/timelines/1/results?status=nope').expect(400);
    });

    it('reads one result with only the visible, non-withdrawn comments, in the SP shape', async () => {
      const res = await get(`/sp/timelines/1/results/${w.codeA}`).expect(200);
      const data = res.body.data;
      expect(data.header).toEqual({
        resultCode: w.codeA,
        title: 'Result A',
        program: { id: 1, code: 'SP01', name: 'Breeding' },
        resultType: { key: 'policy_change', label: 'policy_change' },
        timeline: { id: 1, name: 'Official' },
        status: 'returned_to_program',
        reportingUrl: `https://reporting.test.invalid/result/${w.codeA}/general-information`,
      });
      expect(data.writable).toBe(true);
      expect(data.readOnlyReason).toBeNull();
      expect(data.counts).toEqual({ comments: 2, answered: 1 });
      const fields = fieldsOf(data);
      const a1 = fields.find((f) => f.key === FIELD_A)!;
      const b1 = fields.find((f) => f.key === FIELD_B)!;
      expect(a1.comments).toEqual([
        {
          id: w.open,
          fieldKey: FIELD_A,
          body: 'Please add the evidence link',
          state: 'open',
          createdAt: '2026-11-05T09:00:00.000Z',
          valueCopy: { value: 'Value A' },
          valueTruncated: false,
          response: null,
          history: [],
          clarifications: [],
        },
      ]);
      expect(b1.comments).toEqual([
        expect.objectContaining({
          id: w.accepted,
          state: 'accepted',
          response: {
            id: 3000,
            kind: 'accept',
            body: null,
            respondedBy: { name: 'Earlier Responder' },
            respondedAt: '2026-11-12T09:00:00.000Z',
          },
          history: [expect.objectContaining({ id: 3000 })],
        }),
      ]);
      expect(res.text).not.toContain('Withdrawn text never shown');
      expect(res.text).not.toContain('Not visible text never shown');
      expect(res.text).not.toContain('earlier-responder@example.org');
    });

    it('never carries an assessor id, nickname, name or email in any /sp answer', async () => {
      const admin = await a.spLogin({
        programCode: null,
        isReportingAdmin: true,
      });
      const answers = [
        await get('/sp/me'),
        await get('/sp/timelines'),
        await get('/sp/timelines/1/results'),
        await get(`/sp/timelines/1/results/${w.codeA}`),
        await get(`/sp/timelines/1/results/${w.codeA}?programId=1`, admin),
        await get('/sp/timelines/1/results?programId=1', admin),
      ];
      for (const res of answers) {
        expect(res.status, res.req.path).toBe(200);
        for (const planted of [
          PLANTED.nickname,
          PLANTED.nickname2,
          PLANTED.first,
          PLANTED.last,
          // The assessors' emails (`<sub>@cgiar.org`); the catalog's own help text has an example address.
          'sub-policy',
          'Pia',
          'Pablo',
        ]) {
          expect(res.text, `${res.req.path}: ${planted}`).not.toContain(
            planted,
          );
        }
        expect(res.text).not.toMatch(
          /"(author|authorId|nickname|assessedBy|finishedBy|email|createdBy)"/,
        );
      }
    });

    it('answers a result of another program, of another timeline, or missing with the same 404 body', async () => {
      const missing = await get('/sp/timelines/1/results/999999').expect(404);
      expect(missing.body.error.code).toBe('SP_NOT_FOUND');
      const others = [
        await get('/sp/timelines/1/results/7002'), // program 2
        await get(`/sp/timelines/3/results/${w.codeA}`), // A is not in timeline 3
        await get(`/sp/timelines/2/results/${w.codeA}`), // timeline 2 is not SP01's
        await get('/sp/timelines/2/results'),
        await get('/sp/timelines/99/results'),
        await get('/sp/timelines/1/results/7004'), // not in QA
        await get('/sp/timelines/1/results/7005'), // ended, not listed
        await get(`/sp/timelines/1/results/${w.codeA}?programId=2`), // another program by query
        await get('/sp/timelines?programId=2'),
      ];
      for (const res of others) {
        expect(res.status, res.req.path).toBe(404);
        expect(withoutRequestMeta(res.body), res.req.path).toEqual(
          withoutRequestMeta(missing.body),
        );
      }
    });

    it('lets an admin read any program, and requires programId', async () => {
      const admin = await a.spLogin({
        programCode: null,
        isReportingAdmin: true,
      });
      const missing = await get('/sp/timelines', admin).expect(400);
      expect(missing.body.error).toMatchObject({
        code: 'VALIDATION_FAILED',
        fields: [expect.objectContaining({ field: 'programId' })],
      });
      await get('/sp/timelines/1/results', admin).expect(400);
      const two = await get('/sp/timelines?programId=2', admin).expect(200);
      expect(two.body.data.timelines.map((t: { id: number }) => t.id)).toEqual([
        1, 2, 3,
      ]);
      const rows = await get(
        '/sp/timelines/1/results?programId=2',
        admin,
      ).expect(200);
      expect(
        rows.body.data.rows.map((r: { resultCode: number }) => r.resultCode),
      ).toEqual([7002]);
      await get('/sp/timelines/1/results?programId=999', admin).expect(404);
    });

    it('answers 401 SP_SESSION_INVALID without a session on every read', async () => {
      for (const path of [
        '/sp/timelines',
        '/sp/timelines/1/results',
        `/sp/timelines/1/results/${w.codeA}`,
      ]) {
        const res = await request(a.app.getHttpServer())
          .get(`/api/v1${path}`)
          .expect(401);
        expect(res.body.error.code).toBe('SP_SESSION_INVALID');
      }
    });

    it('reads with a fixed number of statements, whatever the number of results', async () => {
      a.world.resetStatements();
      await get('/sp/timelines/1/results').expect(200);
      const few = a.world.statements;
      for (let i = 0; i < 20; i++) {
        a.world.memberships.push({
          id: 100 + i,
          timelineId: 1,
          resultCode: 8000 + i,
          title: `Extra ${i}`,
          programId: 1,
          resultTypeKey: 'KP',
        });
      }
      a.world.resetStatements();
      await get('/sp/timelines/1/results').expect(200);
      expect(a.world.statements).toBe(few);
    });
  });

  describe('before the programs step', () => {
    beforeEach(() => build(IN_STEP_1));

    it('shows no comment at all and is not writable', async () => {
      const list = await get('/sp/timelines/1/results').expect(200);
      const rowA = list.body.data.rows.find(
        (r: { resultCode: number }) => r.resultCode === w.codeA,
      );
      expect(rowA).toMatchObject({ comments: 0, answered: 0 });
      expect(list.body.data.step.state).toBe('upcoming');
      const one = await get(`/sp/timelines/1/results/${w.codeA}`).expect(200);
      expect(fieldsOf(one.body.data).flatMap((f) => f.comments)).toEqual([]);
      expect(one.body.data).toMatchObject({
        writable: false,
        readOnlyReason: 'step_not_open',
        counts: { comments: 0, answered: 0 },
      });
      expect(one.text).not.toContain('Please add the evidence link');
    });
  });

  describe('after the programs step', () => {
    beforeEach(() => build(AFTER_STEP_2));

    it('still shows the comments, read only', async () => {
      const one = await get(`/sp/timelines/1/results/${w.codeA}`).expect(200);
      expect(one.body.data).toMatchObject({
        writable: false,
        readOnlyReason: 'step_closed',
        counts: { comments: 2, answered: 1 },
      });
    });
  });
});

// P2-3912 T-11 (FR-15, NFR-2; design DD-8, 7): the Lead's own words stay out of
// every /sp answer and out of the logs. The markers are unique strings that no
// other fixture row carries, so a hit can only come from the Lead's writes.
describe('SP view and logs after the Lead finishes (e2e)', () => {
  const LEAD_COMMENT = 'Xq7Lead-Comment-Marker-91f3';
  const DECISION_A = 'Xq7Decision-A-Marker-52c8';
  const DECISION_B = 'Xq7Decision-B-Marker-3d6e';
  const FIRST = ASSESSED[3]!;
  const SECOND = ASSESSED[2]!;
  const lead = () => bearer('sub-lead');
  const spy = new LogSpy();
  let a: AssessmentApp;
  let code: number;

  beforeEach(async () => {
    spy.lines.length = 0;
    a = await buildAssessmentApp(IN_LEAD_STEP);
    const built = await seedRoundTwoWorld(a, {
      core: [ASSESSED[1]!, SECOND, FIRST],
      changedFields: null,
      roundOneGreens: [ASSESSED[1]!],
    });
    code = built.code;
    for (const [id, fieldKey] of [
      [7001, FIRST],
      [7002, SECOND],
      [7003, FIRST],
      [7004, FIRST],
    ] as const) {
      plantRoundOneComment(a, built.roundOneId, id, {
        state: id >= 7003 ? 'open' : 'disagreed',
        fieldKey,
        // Round-1 comments were made visible to the program at the end of step 1.
        visibleToProgramAt: new Date('2026-11-20T10:00:00Z'),
      });
    }
    // The program disagreed with both before the Lead decided.
    plantProgramResponse(a, 3001, 7001, 'disagree', 'We disagree one', 22);
    plantProgramResponse(a, 3002, 7002, 'disagree', 'We disagree two', 22);
    // 7004: the program asked, the assessor answered (back to `open`), then the Lead decides it.
    plantProgramResponse(a, 3003, 7004, 'request_clarification', 'Why?', 22);
    a.world.clarificationAnswers.push({
      id: 4001,
      commentId: 7004,
      responseId: 3003,
      body: 'Because of the date',
      createdAt: new Date('2026-11-22T12:00:00Z'),
      authorId: a.users.policy.id,
    });
    spy.attach();
  });

  afterEach(async () => {
    spy.detach();
    await a.app.close();
  });

  /** decide, clear, decide again, delete and comment, then finish `escalated`. */
  const leadFinishes = async () => {
    const decide = (id: number, decision: string, body: string) =>
      a.send('put', resultPath(`/decisions/${id}`, code), {
        token: lead(),
        body: { decision, body },
      });
    const steps = [
      await decide(7001, 'escalate', DECISION_A),
      await decide(7002, 'escalate', DECISION_B),
      await a.send('delete', resultPath('/decisions/7002', code), {
        token: lead(),
      }),
      await decide(7002, 'agree_program', DECISION_B),
      await decide(7004, 'escalate', DECISION_A),
      await a.send('post', '/assessment-comments/7003/delete', {
        token: lead(),
      }),
      await a.send('post', resultPath('/comments', code), {
        token: lead(),
        body: { fieldKey: ASSESSED[1]!, body: LEAD_COMMENT },
        key: 'lead-marker-comment-1',
      }),
      await a.send('post', resultPath('/finish', code), { token: lead() }),
    ];
    expect(steps.map((r) => r.status)).toEqual([
      200, 200, 200, 200, 200, 200, 201, 200,
    ]);
    expect(steps[7]!.body.data.status).toBe('escalated');
  };

  it('FR-15 after the Lead finishes, no /sp answer carries the Lead text and the round-1 comments keep their program-side states', async () => {
    const token = await a.spLogin();
    const listed = () =>
      a
        .spSend('get', '/sp/timelines/1/results', token)
        .then((res) => res.body.data.rows[0]);
    const before = await listed();
    expect(before).toMatchObject({ comments: 4, answered: 2 });
    const headerStatus = async () =>
      (await a.spSend('get', `/sp/timelines/1/results/${code}`, token)).body
        .data.header.status;
    const statusBefore = await headerStatus();
    await leadFinishes();
    const answers = [
      await a.spSend('get', '/sp/timelines/1/results', token),
      await a.spSend('get', `/sp/timelines/1/results/${code}`, token),
      await a.spSend(
        'get',
        `/sp/timelines/1/results/${code}/comments.csv`,
        token,
      ),
    ];
    for (const res of answers) {
      expect(res.status, res.req.path).toBe(200);
      for (const marker of [LEAD_COMMENT, DECISION_A, DECISION_B]) {
        expect(res.text, `${res.req.path}: ${marker}`).not.toContain(marker);
      }
    }
    // The stored states are the Lead's outcomes; the program still reads `disagreed`.
    expect(a.world.comments.find((c) => c.id === 7001)!.state).toBe(
      'escalated',
    );
    expect(a.world.comments.find((c) => c.id === 7002)!.state).toBe(
      'lead_sided_program',
    );
    // 7003 was deleted by the Lead: two comments remain, both still answered.
    expect(answers[0]!.body.data.rows[0]).toMatchObject({
      comments: 3,
      answered: 2,
    });
    // The answered clarification (7004) is still `open` and the status did not move.
    expect(answers[0]!.body.data.rows[0].status).toBe(before.status);
    expect(answers[1]!.body.data.header.status).toBe(statusBefore);
    const states = fieldsOf(answers[1]!.body.data)
      .flatMap((f) => f.comments.map((c) => [c.id, c.state]))
      .sort((x, y) => Number(x[0]) - Number(y[0]));
    expect(states).toEqual([
      [7001, 'disagreed'],
      [7002, 'disagreed'],
      [7004, 'open'],
    ]);
    expect(answers[1]!.text).not.toContain('Round-1 comment 7003');
    // The CSV shows the same two comments with the program's own response.
    const csv = answers[2]!.text;
    expect(csv).toContain('Round-1 comment 7001');
    expect(csv).toContain('We disagree two');
    expect(csv).not.toContain('Round-1 comment 7003');
  });

  it('NFR-2 the decide, decision_clear and delete log lines carry ids, fixed words and codes only', async () => {
    await leadFinishes();
    const lines = spy.lines.filter((l) => l.includes('"event":"assessment"'));
    const actions = lines.map(
      (l) => (JSON.parse(l) as { action: string }).action,
    );
    for (const action of ['decide', 'decision_clear', 'delete']) {
      expect(actions, action).toContain(action);
    }
    const haystack = spy.lines.join('\n');
    for (const marker of [LEAD_COMMENT, DECISION_A, DECISION_B]) {
      expect(haystack, marker).not.toContain(marker);
    }
  });
});
