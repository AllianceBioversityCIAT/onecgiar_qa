// @akili-spec admin/acts-as-reviewer
import {
  bearer,
  buildAssessmentApp,
  type AssessmentApp,
} from './support/assessment-app.js';
import {
  addSnapshotMembership,
  ASSESSED,
  resultPath,
  seedTimeline,
} from './support/assessment-seed.js';
import {
  plantRoundOneComment,
  seedRoundTwoWorld,
} from './support/round-two-fixture.js';

// The QA Admin acting as a reviewer role over real HTTP (admin/acts-as-reviewer,
// back lead 2026-11-23): the `X-Acting-Role` header, the step dates waived
// (R2), the end and its release as the role's (R3), the Admin mark on what it
// writes (R4), and the flow kept (R6). Clocks are AFTER the role's step closed,
// so every write here would be 409 ASSESSMENT_STEP_CLOSED for the reviewer.

const CORE = ASSESSED.slice(0, 3);
const NON_CORE = ASSESSED[3]!;
const admin = () => bearer('sub-admin');
const as = (role: string) => ({ 'X-Acting-Role': role });
const STEP_1_CLOSED = new Date('2026-11-21T10:00:00Z');
const STEP_3_CLOSED = new Date('2026-11-28T10:00:00Z');

describe('a QA Admin acting as a reviewer role (e2e)', () => {
  let a: AssessmentApp;

  afterEach(async () => {
    await a.app.close();
  });

  describe('round 1, as ASSESSOR, after step 1 closed', () => {
    let code: number;

    beforeEach(async () => {
      a = await buildAssessmentApp(STEP_1_CLOSED);
      seedTimeline(a, CORE);
      a.world.users.push({ id: a.users.admin.id, nickname: 'Ada' });
      await addSnapshotMembership(a, { [NON_CORE]: 'A value' });
      code = a.world.memberships.at(-1)!.resultCode;
    });

    it('without the header the Admin stays read-only (403), and the view lists the roles it may act as', async () => {
      const view = await a.send('get', resultPath('', code), {
        token: admin(),
      });
      expect(view.status).toBe(200);
      expect(view.body.data).toMatchObject({
        writable: false,
        readOnlyReason: 'admin_read_only',
        actingRoles: ['ASSESSOR'],
        actingRole: null,
      });

      const refused = await a.send('put', resultPath('/validations', code), {
        token: admin(),
        body: { validated: true, fieldKeys: [CORE[0]] },
      });
      expect(refused.status).toBe(403);
      expect(refused.body.error.code).toBe('ASSESSMENT_READ_ONLY');
    });

    it('validates, comments and finishes with the step closed; the end queues the release and every write carries the Admin mark', async () => {
      const view = await a.send('get', resultPath('', code), {
        token: admin(),
        headers: as('ASSESSOR'),
      });
      expect(view.body.data).toMatchObject({
        writable: true,
        readOnlyReason: null,
        actingRole: 'ASSESSOR',
      });

      const green = await a.send('put', resultPath('/validations', code), {
        token: admin(),
        headers: as('ASSESSOR'),
        body: { validated: true, fieldKeys: [CORE[0], CORE[1]] },
      });
      expect(green.status).toBe(200);

      const comment = await a.send('post', resultPath('/comments', code), {
        token: admin(),
        headers: as('ASSESSOR'),
        body: { fieldKey: NON_CORE, body: 'Check this' },
      });
      expect(comment.status).toBe(201);
      expect(comment.body.data.author).toEqual({
        id: a.users.admin.id,
        nickname: 'Ada',
        admin: true,
      });

      // CORE[2] still grey and uncommented: the role's own end rule refuses.
      const early = await a.send('post', resultPath('/finish', code), {
        token: admin(),
        headers: as('ASSESSOR'),
      });
      expect(early.status).toBe(409);
      expect(early.body.error.code).toBe('ASSESSMENT_CORE_UNCOMMENTED');

      await a.send('put', resultPath('/validations', code), {
        token: admin(),
        headers: as('ASSESSOR'),
        body: { validated: true, fieldKeys: [CORE[2]] },
      });
      const finish = await a.send('post', resultPath('/finish', code), {
        token: admin(),
        headers: as('ASSESSOR'),
      });
      expect(finish.status).toBe(200);
      // A comment sends a round-1 result back, as for the reviewer.
      expect(finish.body.data).toMatchObject({
        status: 'returned',
        assessedBy: { id: a.users.admin.id, nickname: 'Ada', admin: true },
      });

      expect(a.world.releases).toHaveLength(1);
      expect(a.world.releases[0]).toMatchObject({ outcome: 'not_qaed' });
      expect(a.world.assessments[0]).toMatchObject({
        status: 'returned',
        roleCode: 'ASSESSOR',
        finishedBy: a.users.admin.id,
        finishedAsAdmin: true,
      });
      expect(a.world.comments.at(-1)).toMatchObject({ actedAsAdmin: true });

      // A reviewer reads the Admin mark on the comment and on Assessed by.
      const read = await a.send('get', resultPath('', code), {
        token: bearer('sub-policy'),
      });
      expect(read.body.data.assessment.assessedBy).toEqual({
        id: a.users.admin.id,
        nickname: 'Ada',
        admin: true,
      });
      const fields = read.body.data.sections.flatMap(
        (s: { fields: Array<{ key: string; comments: unknown[] }> }) =>
          s.fields,
      );
      expect(
        fields.find((f: { key: string }) => f.key === NON_CORE).comments,
      ).toMatchObject([{ author: { nickname: 'Ada', admin: true } }]);
      // The reviewer's own view carries no acting members.
      expect(read.body.data).not.toHaveProperty('actingRoles');

      const worklist = await a.send('get', '/timelines/1/worklist', {
        token: bearer('sub-policy'),
      });
      expect(worklist.body.data.rows[0].assessedBy).toEqual({
        id: a.users.admin.id,
        nickname: 'Ada',
        admin: true,
      });
    });

    it('withdraws its own comment with steps 1 and 2 closed', async () => {
      const comment = await a.send('post', resultPath('/comments', code), {
        token: admin(),
        headers: as('ASSESSOR'),
        body: { fieldKey: NON_CORE, body: 'Not needed' },
      });
      a.setClock(new Date('2026-12-15T10:00:00Z'));
      const withdrawn = await a.send(
        'post',
        `/assessment-comments/${comment.body.data.id}/withdraw`,
        { token: admin(), headers: as('ASSESSOR') },
      );
      expect(withdrawn.status).toBe(200);
      expect(withdrawn.body.data.state).toBe('withdrawn');
    });

    it('as LEAD_ASSESSOR on a round-1 result: read-only (the role does not fit the round, R6)', async () => {
      const view = await a.send('get', resultPath('', code), {
        token: admin(),
        headers: as('LEAD_ASSESSOR'),
      });
      expect(view.body.data).toMatchObject({
        writable: false,
        readOnlyReason: 'admin_read_only',
        actingRole: null,
      });
      const refused = await a.send('put', resultPath('/validations', code), {
        token: admin(),
        headers: as('LEAD_ASSESSOR'),
        body: { validated: true, fieldKeys: [CORE[0]] },
      });
      expect(refused.status).toBe(403);
      expect(refused.body.error.code).toBe('ASSESSMENT_READ_ONLY');
    });

    it('a role with no reviewer row, or an unknown value, is 400 VALIDATION_FAILED on the header', async () => {
      for (const value of ['GUEST', 'nope']) {
        const res = await a.send('get', resultPath('', code), {
          token: admin(),
          headers: as(value),
        });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatchObject({
          code: 'VALIDATION_FAILED',
          fields: [{ field: 'X-Acting-Role', code: 'INVALID' }],
        });
      }
    });

    it("a reviewer's header is ignored: the step is still closed for them", async () => {
      const res = await a.send('put', resultPath('/validations', code), {
        token: bearer('sub-policy'),
        headers: as('ASSESSOR'),
        body: { validated: true, fieldKeys: [CORE[0]] },
      });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ASSESSMENT_STEP_CLOSED');
      const view = await a.send('get', resultPath('', code), {
        token: bearer('sub-policy'),
        headers: as('LEAD_ASSESSOR'),
      });
      expect(view.body.data).toMatchObject({
        writable: false,
        readOnlyReason: 'step_closed',
      });
      expect(view.body.data).not.toHaveProperty('actingRole');
    });
  });

  describe('round 2, as LEAD_ASSESSOR, after step 3 closed', () => {
    let code: number;
    let roundOneId: number;

    beforeEach(async () => {
      a = await buildAssessmentApp(STEP_3_CLOSED);
      const built = await seedRoundTwoWorld(a, {
        core: CORE,
        changedFields: null,
        roundOneGreens: [CORE[0]!],
      });
      a.world.users.push({ id: a.users.admin.id, nickname: 'Ada' });
      code = built.code;
      roundOneId = built.roundOneId;
      plantRoundOneComment(a, roundOneId, 7001, {
        state: 'disagreed',
        fieldKey: CORE[1],
      });
      plantRoundOneComment(a, roundOneId, 7002, {
        state: 'disagreed',
        fieldKey: CORE[2],
      });
    });

    const decide = (commentId: number, decision: string) =>
      a.send('put', resultPath(`/decisions/${commentId}`, code), {
        token: admin(),
        headers: as('LEAD_ASSESSOR'),
        body: { decision, body: 'Admin decision' },
      });

    it('decides and finishes: the review ends escalated, no release, the decisions carry the Admin mark', async () => {
      const view = await a.send('get', resultPath('', code), {
        token: admin(),
        headers: as('LEAD_ASSESSOR'),
      });
      expect(view.body.data).toMatchObject({
        round: 2,
        writable: true,
        actingRoles: ['LEAD_ASSESSOR'],
        actingRole: 'LEAD_ASSESSOR',
      });
      const thread = view.body.data.sections
        .flatMap(
          (s: { fields: Array<{ key: string; thread: unknown[] }> }) =>
            s.fields,
        )
        .find((f: { key: string }) => f.key === CORE[1]).thread;
      expect(thread).toMatchObject([
        {
          commentId: 7001,
          decidable: true,
          choices: ['agree_program', 'escalate'],
        },
      ]);

      expect((await decide(7001, 'agree_program')).status).toBe(200);
      expect((await decide(7002, 'escalate')).status).toBe(200);
      const finish = await a.send('post', resultPath('/finish', code), {
        token: admin(),
        headers: as('LEAD_ASSESSOR'),
      });
      expect(finish.status).toBe(200);
      expect(finish.body.data).toMatchObject({
        status: 'escalated',
        assessedBy: { id: a.users.admin.id, admin: true },
      });
      expect(a.world.releases).toEqual([]);
      expect(
        a.world.commentDecisions.map((d) => [d.commentId, d.actedAsAdmin]),
      ).toEqual([
        [7001, true],
        [7002, true],
      ]);
      expect(
        a.world.comments
          .filter((c) => c.assessmentId === roundOneId)
          .map((c) => [c.id, c.state]),
      ).toEqual([
        [7001, 'lead_sided_program'],
        [7002, 'escalated'],
      ]);
    });

    it('a second finish is 409 ASSESSMENT_FINISHED (R7: the first end wins)', async () => {
      await decide(7001, 'agree_program');
      await decide(7002, 'agree_program');
      // The last agree turned every core field green: the review ended quality_assessed with one release.
      expect(a.world.releases).toHaveLength(1);
      const again = await a.send('post', resultPath('/finish', code), {
        token: admin(),
        headers: as('LEAD_ASSESSOR'),
      });
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('ASSESSMENT_FINISHED');
    });

    it('the Lead of the result still reads the step as closed', async () => {
      const res = await decide(7001, 'agree_program');
      expect(res.status).toBe(200);
      const lead = await a.send('put', resultPath('/decisions/7002', code), {
        token: bearer('sub-lead'),
        body: { decision: 'escalate', body: 'Too late' },
      });
      expect(lead.status).toBe(409);
      expect(lead.body.error.code).toBe('ASSESSMENT_STEP_CLOSED');
    });
  });
});
