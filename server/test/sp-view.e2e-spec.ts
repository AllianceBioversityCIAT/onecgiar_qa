// P2-3911 (SP view): the /sp reads over real HTTP. Scope (a non-admin session
// sees only its program; an admin names one), the byte-identical 404, the
// programs-step window for comment visibility, filters, counts, and the
// privacy rule: no assessor identity in any SP answer.
import request from 'supertest';
import {
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
