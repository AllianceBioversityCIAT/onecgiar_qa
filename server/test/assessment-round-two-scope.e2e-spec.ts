// @akili-spec escalation/round-2
import {
  bearer,
  buildAssessmentApp,
  withoutRequestMeta,
  type AssessmentApp,
} from './support/assessment-app.js';
import {
  ASSESSED,
  resultPath,
  seedTimeline,
} from './support/assessment-seed.js';
import { runRealLoad } from './support/real-load-writer.js';

// Round 2 scope for the Lead Assessor over real HTTP (P2-3912, FR-1, FR-2,
// FR-14, FR-16). The round-2 membership is the one the real load runner
// wrote the second time (`runRealLoad` with load 2), never a hand-typed key.
// Steps: assessors 12-20 Nov, programs 21-23 Nov, lead assessors 24-27 Nov
// 2026 (Rome is UTC+1). Expected values are written out from the spec.

const TITLE = 'general.title';
const PROGRAM = 'general.primary_program';
const FIELD = ASSESSED[1]!;

const IN_LEAD_STEP = new Date('2026-11-25T10:00:00Z');
const BEFORE_LEAD_STEP = new Date('2026-11-23T10:00:00Z'); // step 3 upcoming
const AFTER_LEAD_STEP = new Date('2026-11-28T10:00:00Z'); // step 3 closed

const lead = () => bearer('sub-lead');
const assessor = () => bearer('sub-policy');
const admin = () => bearer('sub-admin');
const tpb = () => bearer('sub-tpb');

const minute = (value: string) => value as never;
const steps = () => [
  {
    position: 1,
    name: 'Step 1',
    audience: 'assessors' as const,
    opensAt: minute('2026-11-12T09:00'),
    closesAt: minute('2026-11-20T17:30'),
  },
  {
    position: 2,
    name: 'Step 2',
    audience: 'programs' as const,
    opensAt: minute('2026-11-21T09:00'),
    closesAt: minute('2026-11-23T17:30'),
  },
  {
    position: 3,
    name: 'Step 3',
    audience: 'lead_assessors' as const,
    opensAt: minute('2026-11-24T09:00'),
    closesAt: minute('2026-11-27T17:30'),
  },
];

function expectNotFound(res: { status: number; body: unknown }) {
  expect(res.status).toBe(404);
  expect(res.body).toMatchObject({
    success: false,
    error: { status: 404, code: 'ASSESSMENT_NOT_FOUND' },
  });
}

describe('Round 2 scope of the Lead (e2e)', () => {
  let a: AssessmentApp;
  let nextId = 1;
  let resultCode: number;
  let roundTwoId: number;
  let roundOneId: number;

  /**
   * Result code R in two rounds, built by the real runner: round 1 ended
   * returned (its step-1 assessment `returned`), then round 2 re-submitted
   * from load 2. Returns the round-2 membership id.
   */
  async function addTwoRounds(
    options: {
      programId?: number;
      resultTypeKey?: string;
      timelineId?: number;
    } = {},
  ) {
    const values = { [TITLE]: 'First submission', [PROGRAM]: 3 };
    const first = await runRealLoad([{ resultId: 1001, values }], {
      loadId: 1,
    });
    const second = await runRealLoad(
      [{ resultId: 1001, values: { ...values, [TITLE]: 'Re-submitted' } }],
      { loadId: 2 },
    );
    for (const real of [first, second]) {
      const written = real.memberships[0]!;
      for (const snapshot of await real.snapshots.history(written.resultCode)) {
        await a.snapshots.put(snapshot);
      }
    }
    const one = first.memberships[0]!;
    const two = second.memberships[0]!;
    const base = {
      timelineId: options.timelineId ?? 1,
      resultCode: one.resultCode,
      programId: options.programId ?? 1,
      resultTypeKey: options.resultTypeKey ?? 'policy_change',
    };
    const roundOneId = nextId++;
    const roundTwo = nextId++;
    a.world.memberships.push(
      {
        ...base,
        id: roundOneId,
        title: 'First submission',
        round: 1,
        ended: true,
        endReason: 'returned',
        snapshotSk: one.snapshotSk,
      },
      {
        ...base,
        id: roundTwo,
        title: 'Re-submitted',
        round: 2,
        changedFields: [TITLE],
        snapshotSk: two.snapshotSk,
      },
    );
    a.world.assessments.push({
      id: roundOneId,
      membershipId: roundOneId,
      stepPosition: 1,
      status: 'returned',
    });
    return { code: one.resultCode, roundOneId, roundTwoId: roundTwo };
  }

  beforeEach(async () => {
    a = await buildAssessmentApp(IN_LEAD_STEP);
    seedTimeline(a, [FIELD]);
    a.world.timelines[0]!.steps = steps();
    a.world.timelines.push({
      id: 2,
      name: 'Additional',
      kind: 'additional',
      steps: steps(),
    });
    a.world.timelineUsers.push(
      { timelineId: 1, userId: a.users.lead.id, roleCode: 'LEAD_ASSESSOR' },
      { timelineId: 1, userId: a.users.tpb.id, roleCode: 'TPB' },
    );
    await a.programScope(a.users.lead.id, [1]);
    const built = await addTwoRounds();
    resultCode = built.code;
    roundTwoId = built.roundTwoId;
    roundOneId = built.roundOneId;
  });

  afterEach(async () => {
    await a.app.close();
  });

  describe('FR-1 Lead opens a round-2 result in scope', () => {
    it('lists the round-2 membership as Pending and not the round-1 one', async () => {
      const res = await a.send('get', '/timelines/1/worklist', {
        token: lead(),
      });
      expect(res.status).toBe(200);
      const rows = res.body.data.rows as Array<{
        membershipId: number;
        resultCode: number;
        status: string;
        readOnlyReason: string | null;
      }>;
      expect(
        rows.map((r) => [
          r.membershipId,
          r.resultCode,
          r.status,
          r.readOnlyReason,
        ]),
      ).toEqual([[roundTwoId, resultCode, 'pending', null]]);
    });

    it('opens it writable on step 3, Pending, with the step-1 structure of the type (FR-2)', async () => {
      const res = await a.send('get', resultPath('', resultCode), {
        token: lead(),
      });
      expect(res.status).toBe(200);
      expect(res.body.data.header).toMatchObject({
        resultCode,
        title: 'Re-submitted',
        step: { position: 3, name: 'Step 3' },
        status: 'pending',
      });
      expect(res.body.data.writable).toBe(true);
      expect(res.body.data.readOnlyReason).toBeNull();

      // Same sections and field order as the assessor's step-1 view of another result of the same type.
      const other = await a.send('get', resultPath('', resultCode), {
        token: assessor(),
      });
      expect(other.status).toBe(200);
      const shape = (body: {
        data: {
          sections: Array<{ key: string; fields: Array<{ key: string }> }>;
        };
      }) => body.data.sections.map((s) => [s.key, s.fields.map((f) => f.key)]);
      expect(shape(res.body)).toEqual(shape(other.body));
    });
  });

  describe('FR-1 what the Lead never reaches (404, the body of a missing result)', () => {
    it('answers the same 404 for another type, another program, round 1 only, an unassigned timeline and a missing code', async () => {
      // Other type and other program: round-2 memberships outside the Lead's grant.
      a.world.memberships.push(
        {
          id: 900,
          timelineId: 1,
          resultCode: 7001,
          title: 'Other type',
          programId: 1,
          resultTypeKey: 'innovation_use',
          round: 2,
        },
        {
          id: 901,
          timelineId: 1,
          resultCode: 7002,
          title: 'Other program',
          programId: 2,
          resultTypeKey: 'policy_change',
          round: 2,
        },
        // A result with a round-1 membership only.
        {
          id: 902,
          timelineId: 1,
          resultCode: 7003,
          title: 'Round 1 only',
          programId: 1,
          resultTypeKey: 'policy_change',
          round: 1,
        },
        // A round-2 membership of a timeline the Lead is not assigned to.
        {
          id: 903,
          timelineId: 2,
          resultCode: 7004,
          title: 'Unassigned timeline',
          programId: 1,
          resultTypeKey: 'policy_change',
          round: 2,
        },
      );
      const missing = await a.send('get', resultPath('', 999999), {
        token: lead(),
      });
      expectNotFound(missing);
      for (const res of [
        await a.send('get', resultPath('', 7001), { token: lead() }),
        await a.send('get', resultPath('', 7002), { token: lead() }),
        await a.send('get', resultPath('', 7003), { token: lead() }),
        await a.send('get', resultPath('', 7004, 2), { token: lead() }),
        await a.send('get', resultPath('', 7004), { token: lead() }),
      ]) {
        expectNotFound(res);
        expect(withoutRequestMeta(res.body)).toEqual(
          withoutRequestMeta(missing.body),
        );
      }
      const listed = await a.send('get', '/timelines/1/worklist', {
        token: lead(),
      });
      expect(
        (listed.body.data.rows as Array<{ resultCode: number }>).map(
          (r) => r.resultCode,
        ),
      ).toEqual([resultCode]);
    });

    it('an ASSESSOR does not reach a round-2 membership (FR-1 Assessor does not reach round 2)', async () => {
      a.world.memberships.push({
        id: 910,
        timelineId: 1,
        resultCode: 7010,
        title: 'Round 2 only',
        programId: 1,
        resultTypeKey: 'policy_change',
        round: 2,
      });
      expectNotFound(
        await a.send('get', resultPath('', 7010), { token: assessor() }),
      );
    });

    it('a TPB opens nothing: TPB stays designed only (FR-16)', async () => {
      expectNotFound(
        await a.send('get', resultPath('', resultCode), { token: tpb() }),
      );
    });
  });

  describe('FR-1 the step window', () => {
    it.each<[string, Date, string]>([
      ['upcoming', BEFORE_LEAD_STEP, 'step_upcoming'],
      ['closed', AFTER_LEAD_STEP, 'step_closed'],
    ])(
      'step 3 %s: opens read-only and refuses every write with the step-closed error',
      async (_name, at, reason) => {
        a.setClock(at);
        const view = await a.send('get', resultPath('', resultCode), {
          token: lead(),
        });
        expect(view.status).toBe(200);
        expect(view.body.data.writable).toBe(false);
        expect(view.body.data.readOnlyReason).toBe(reason);

        const before = {
          comments: a.world.comments.length,
          assessments: a.world.assessments.length,
          audits: a.world.audits.length,
        };
        for (const [name, res] of [
          [
            'validate',
            await a.send('put', resultPath('/validations', resultCode), {
              token: lead(),
              body: { validated: true, fieldKeys: [FIELD] },
            }),
          ],
          [
            'comment',
            await a.send('post', resultPath('/comments', resultCode), {
              token: lead(),
              key: `lead-${reason}`,
              body: { fieldKey: FIELD, body: 'Not now' },
            }),
          ],
          [
            'finish',
            await a.send('post', resultPath('/finish', resultCode), {
              token: lead(),
            }),
          ],
        ] as const) {
          expect(res.status, name).toBe(409);
          expect(res.body.error.code, name).toBe('ASSESSMENT_STEP_CLOSED');
        }
        expect(a.world.comments).toHaveLength(before.comments);
        expect(a.world.assessments).toHaveLength(before.assessments);
        expect(a.world.audits).toHaveLength(before.audits);
      },
    );
  });

  describe('FR-14 Admin worklist', () => {
    it('lists the round-2 membership as Pending for TPB review once the Lead assessment ended escalated, and counts it', async () => {
      a.world.assessments.push({
        id: 50,
        membershipId: roundTwoId,
        stepPosition: 3,
        status: 'escalated',
      });
      const res = await a.send(
        'get',
        '/timelines/1/worklist?status=pending_tpb_review',
        { token: admin() },
      );
      expect(res.status).toBe(200);
      expect(
        (
          res.body.data.rows as Array<{ membershipId: number; status: string }>
        ).map((r) => [r.membershipId, r.status]),
      ).toEqual([[roundTwoId, 'pending_tpb_review']]);
      // FR-14: Pending for TPB review counts as finished, not pending (round 1 is returned, also finished).
      expect(res.body.data.counters).toEqual({
        pending: 0,
        finished: 2,
        total: 2,
      });

      const all = await a.send('get', '/timelines/1/worklist', {
        token: admin(),
      });
      const statuses = Object.fromEntries(
        (
          all.body.data.rows as Array<{ membershipId: number; status: string }>
        ).map((r) => [r.membershipId, r.status]),
      );
      // Round 1 keeps its own status (NFR-6); round 2 reads its own current step.
      expect(statuses).toEqual({
        [roundOneId]: 'returned_to_program',
        [roundTwoId]: 'pending_tpb_review',
      });

      // The Lead and the view read the same status.
      const view = await a.send('get', resultPath('', resultCode), {
        token: lead(),
      });
      expect(view.body.data.header.status).toBe('pending_tpb_review');
      expect(view.body.data.readOnlyReason).toBe('finished');
    });
  });
});
