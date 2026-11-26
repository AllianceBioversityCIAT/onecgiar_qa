// @akili-spec escalation/round-2-ppu
import {
  bearer,
  buildAssessmentApp,
  type AssessmentApp,
} from './support/assessment-app.js';
import { ASSESSED, resultPath } from './support/assessment-seed.js';
import {
  AFTER_PPU_STEP,
  IN_PPU_STEP,
  IN_TPB_STEP,
  plantProgramResponse,
  seedPpuWorld,
  seedTpbWorld,
} from './support/round-two-fixture.js';
import type {
  FeedRelease,
  FeedReleaseQuery,
} from '../src/ingestion/results-feed.port.js';

// P2-3917 over real HTTP (FR-1 … FR-13): the PPU's scope with no date window,
// the view with each case's context, Done and its undo, the automatic end,
// Unresolved, the refusals, an Admin acting as PPU and the quick comments. The
// world is the shared round-2 fixture with the TPB's end planted as it leaves
// it (`seedPpuWorld`); the whole path over HTTP is
// `assessment-round-two-ppu-flow.e2e-spec.ts`. AC6 (Changed in Reporting) is
// `assessment-round-two-ppu-reporting.e2e-spec.ts`.

const CARRIED = ASSESSED[1]!; // green in round 1, uncommented, unchanged
const SECOND = ASSESSED[2]!;
const FIRST = ASSESSED[3]!;
const ppu = () => bearer('sub-ppu');
const tpb = () => bearer('sub-tpb');
const admin = () => bearer('sub-admin');
const asPpu = { 'X-Acting-Role': 'PPU' };

describe('the PPU in step 5 (e2e, P2-3917)', () => {
  let a: AssessmentApp;
  let code: number;
  let roundTwoId: number;

  /**
   * FIRST: case 7001 (TPB sided with the assessor). SECOND: case 7002 and
   * 7003 (the Lead's own), both cases. 7004 on FIRST closed by the TPB.
   */
  const seed = async (at: Date = IN_PPU_STEP) => {
    a = await buildAssessmentApp(at);
    const built = await seedPpuWorld(a, {
      core: [CARRIED, SECOND, FIRST],
      roundOneGreens: [CARRIED],
      decided: [
        { id: 7001, fieldKey: FIRST, reason: 'Lead escalation', tpbReason: 'The assessor is right' },
        { id: 7002, fieldKey: SECOND },
        { id: 7003, fieldKey: SECOND, origin: 'lead' },
        { id: 7004, fieldKey: FIRST, sided: 'program' },
      ],
    });
    plantProgramResponse(a, 1, 7001, 'disagree', 'Our figure is right', 22);
    a.feed.script('release', (q: FeedReleaseQuery): FeedRelease => ({
      phaseYear: q.phaseYear,
      released: q.items.map((item) => ({
        resultId: item.resultId,
        resultCode: built.code,
        outcome: item.outcome,
      })),
      notReleased: [],
    }));
    code = built.code;
    roundTwoId = built.roundTwoId;
  };
  const roundTwo = () => a.world.memberships.find((m) => m.id === roundTwoId)!;
  const view = async (token = ppu(), headers?: Record<string, string>) =>
    (await a.send('get', resultPath('', code), { token, headers })).body.data;
  const fieldOf = (data: any, key: string) =>
    data.sections
      .flatMap((s: { fields: Array<{ key: string }> }) => s.fields)
      .find((f: { key: string }) => f.key === key);
  const done = (
    commentId: number,
    options: { token?: string; headers?: Record<string, string>; body?: unknown } = {},
  ) =>
    a.send('put', resultPath(`/decisions/${commentId}`, code), {
      token: options.token ?? ppu(),
      headers: options.headers,
      body:
        options.body === undefined
          ? { decision: 'ppu_done' }
          : { decision: 'ppu_done', body: options.body },
    });
  const undo = (commentId: number) =>
    a.send('delete', resultPath(`/decisions/${commentId}`, code), {
      token: ppu(),
    });
  const list = (token = ppu(), query = '') =>
    a.send('get', `/timelines/1/worklist${query}`, { token });

  afterEach(async () => {
    await a.app.close();
  });

  describe('FR-2 scope with no date window, FR-10 counters', () => {
    it.each([
      ['before step 5 opens', IN_TPB_STEP, 'pending_ppu'],
      ['in step 5', IN_PPU_STEP, 'pending_ppu'],
      ['after step 5 closed', AFTER_PPU_STEP, 'unresolved'],
    ])('%s: listed, writable, pending for the PPU', async (_name, at, status) => {
      await seed(at);
      const res = await list();
      expect(res.body.data.rows.map((r: any) => [r.membershipId, r.status, r.readOnlyReason])).toEqual([
        [roundTwoId, status, null],
      ]);
      expect(res.body.data.counters).toMatchObject({ pending: 1, finished: 0 });
      const opened = await view();
      expect(opened).toMatchObject({ writable: true, readOnlyReason: null });
      expect(opened.header.status).toBe(status);
    });

    it('does not cover a result the TPB has not ended (404)', async () => {
      a = await buildAssessmentApp(IN_PPU_STEP);
      const built = await seedTpbWorld(a, {
        core: [FIRST],
        escalated: [{ id: 7001, fieldKey: FIRST }],
      });
      a.world.timelines[0]!.steps.push({
        position: 5,
        name: 'Step 5',
        audience: 'ppu',
        opensAt: '2026-12-03T09:00' as never,
        closesAt: '2026-12-06T17:30' as never,
      });
      a.world.timelineUsers.push({ timelineId: 1, userId: a.users.ppu.id, roleCode: 'PPU' });
      expect((await list()).body.data.rows).toEqual([]);
      const opened = await a.send('get', resultPath('', built.code), { token: ppu() });
      expect(opened.status).toBe(404);
    });
  });

  describe('FR-1, FR-3 the view', () => {
    it('flags the cases decidable with the whole context; the rest is read-only', async () => {
      await seed();
      const opened = await view();
      expect(fieldOf(opened, FIRST).thread).toMatchObject([
        {
          commentId: 7001,
          round: 1,
          state: 'tpb_sided_assessor',
          response: { kind: 'disagree', body: 'Our figure is right' },
          leadDecision: { decision: 'escalate', body: 'Lead escalation' },
          tpbDecision: { decision: 'tpb_agree_assessor', body: 'The assessor is right' },
          decidable: true,
          choices: ['ppu_done'],
        },
        {
          commentId: 7004,
          state: 'tpb_sided_program',
          tpbDecision: { decision: 'tpb_agree_program' },
          decidable: false,
          choices: [],
        },
      ]);
      expect(fieldOf(opened, SECOND).thread.map((i: any) => [i.commentId, i.round, i.decidable])).toEqual([
        [7002, 1, true],
        [7003, 2, true],
      ]);
      expect(fieldOf(opened, CARRIED)).toMatchObject({ effectiveValidated: true, carried: true });
      expect(fieldOf(opened, FIRST).effectiveValidated).toBe(false);
      expect(opened.assessment).toBeNull();
    });

    it('the TPB still reads its own step-4 review after the PPU starts', async () => {
      await seed();
      await done(7001);
      const res = await a.send('get', resultPath('', code), { token: tpb() });
      expect(res.status).toBe(200);
      expect(res.body.data.assessment).toMatchObject({
        status: 'escalated',
        assessedBy: { id: a.users.tpb.id },
      });
      expect(res.body.data.header.status).toBe('pending_ppu');
    });
  });

  describe('FR-4 … FR-6 Done, undo and the automatic end', () => {
    it('Done with no comment greens the field, stores who and when; the other cases keep it pending', async () => {
      await seed();
      const res = await done(7001);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        status: 'pending',
        decision: { decision: 'ppu_done', body: null, decidedAt: '2026-12-04T10:00:00.000Z' },
        validations: [{ fieldKey: FIRST, validated: true }],
      });
      const step5 = a.world.assessments.find((x) => x.stepPosition === 5)!;
      expect(step5).toMatchObject({ status: 'pending', roleCode: 'PPU' });
      expect(a.world.commentDecisions.find((d) => d.roleCode === 'PPU')).toMatchObject({
        commentId: 7001,
        assessmentId: step5.id,
        decision: 'ppu_done',
        body: null,
        decidedBy: a.users.ppu.id,
      });
      expect(a.world.comments.find((c) => c.id === 7001)!.state).toBe('tpb_sided_assessor');
      expect(a.world.releases).toEqual([]);
      // AC5: nothing else was marked.
      expect(a.world.commentDecisions.filter((d) => d.roleCode === 'PPU')).toHaveLength(1);
    });

    it('Done with a comment stores it trimmed', async () => {
      await seed();
      const res = await done(7002, { body: '  Program fixed the figure  ' });
      expect(res.body.data.decision).toMatchObject({ body: 'Program fixed the figure' });
    });

    it('a field with two cases turns green only when both are Done; undo greys it again', async () => {
      await seed();
      expect((await done(7002)).body.data.validations).toEqual([]);
      expect(fieldOf(await view(), SECOND).effectiveValidated).toBe(false);
      await done(7003);
      expect(fieldOf(await view(), SECOND).effectiveValidated).toBe(true);
      const undone = await undo(7003);
      expect(undone.status).toBe(200);
      expect(undone.body.data).toMatchObject({
        decision: null,
        validations: [{ fieldKey: SECOND, validated: false }],
      });
      const step5 = a.world.assessments.find((x) => x.stepPosition === 5)!;
      expect(
        a.world.audits.filter((x) => x.assessmentId === step5.id).map((x) => x.action),
      ).toEqual(['decision_set', 'decision_set', 'decision_clear']);
    });

    it('the last Done ends the result Quality Assessed: one qaed, cases done, the ack ends released_qaed', async () => {
      await seed();
      await done(7001);
      await done(7002);
      const last = await done(7003);
      expect(last.status).toBe(200);
      expect(last.body.data).toMatchObject({
        status: 'quality_assessed',
        assessedBy: { id: a.users.ppu.id, nickname: 'Paz' },
      });
      expect(a.world.releases).toHaveLength(1);
      expect(a.world.releases[0]).toMatchObject({ timelineResultId: roundTwoId, outcome: 'qaed' });
      await vi.waitFor(() => expect(roundTwo().endReason).toBe('released_qaed'));
      expect(
        a.world.comments.filter((c) => (c.id ?? 0) >= 7001).map((c) => [c.id, c.state]),
      ).toEqual([
        [7001, 'done'],
        [7002, 'done'],
        [7003, 'done'],
        [7004, 'tpb_sided_program'],
      ]);
      expect(
        a.world.commentEvents.filter((e) => e.actorRole === 'PPU').map((e) => [e.commentId, e.toState]),
      ).toEqual([
        [7001, 'done'],
        [7002, 'done'],
        [7003, 'done'],
      ]);
      // After the end: read-only, finished; listed as finished for the PPU.
      const opened = await view();
      expect(opened).toMatchObject({ writable: false, readOnlyReason: 'finished' });
      expect(opened.header.status).toBe('quality_assessed');
      expect((await list()).body.data.counters).toMatchObject({ pending: 0, finished: 1 });
      const late = await undo(7003);
      expect(late.status).toBe(409);
      expect(late.body.error.code).toBe('ASSESSMENT_FINISHED');
    });

    it('refuses a non-case, another role value (409), a blank comment (400), a foreign comment (404)', async () => {
      await seed();
      const closed = await done(7004);
      expect(closed.status).toBe(409);
      expect(closed.body.error.code).toBe('ASSESSMENT_DECISION_INVALID');
      const tpbValue = await a.send('put', resultPath('/decisions/7001', code), {
        token: ppu(),
        body: { decision: 'tpb_agree_program', body: 'x' },
      });
      expect(tpbValue.status).toBe(409);
      expect(tpbValue.body.error.code).toBe('ASSESSMENT_DECISION_INVALID');
      const blank = await done(7001, { body: '   ' });
      expect(blank.status).toBe(400);
      expect(blank.body.error.code).toBe('VALIDATION_FAILED');
      const foreign = await done(99999);
      expect(foreign.status).toBe(404);
      expect(a.world.commentDecisions.filter((d) => d.roleCode === 'PPU')).toEqual([]);
    });

    it('a TPB sending ppu_done on its own route is 409', async () => {
      a = await buildAssessmentApp(IN_TPB_STEP);
      const built = await seedTpbWorld(a, {
        core: [FIRST],
        escalated: [{ id: 7001, fieldKey: FIRST }],
      });
      code = built.code;
      const res = await done(7001, { token: tpb() });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ASSESSMENT_DECISION_INVALID');
    });
  });

  describe('FR-7 no Finish, no other write', () => {
    it('refuses Finish, validations, comments and deletes with 403 ASSESSMENT_READ_ONLY', async () => {
      await seed();
      for (const [method, path, body] of [
        ['post', resultPath('/finish', code), undefined],
        ['put', resultPath('/validations', code), { validated: true, fieldKeys: [FIRST] }],
        ['post', '/assessment-comments/7001/delete', undefined],
      ] as const) {
        const res = await a.send(method, path, { token: ppu(), body: body as never });
        expect(res.status, path).toBe(403);
        expect(res.body.error.code).toBe('ASSESSMENT_READ_ONLY');
      }
      const commented = await a.send('post', resultPath('/comments', code), {
        token: ppu(),
        key: 'ppu-comment-1',
        body: { fieldKey: FIRST, body: 'A PPU note' },
      });
      expect(commented.status).toBe(403);
      expect(a.world.assessments.filter((x) => x.stepPosition === 5)).toEqual([]);
    });

    it('never sees the AI suggestion', async () => {
      await seed();
      const res = await a.send('get', `/timelines/1/results/${code}/ai-suggestions`, {
        token: ppu(),
      });
      expect(res.status).toBe(403);
    });
  });

  describe('FR-8 Unresolved', () => {
    it('after step 5 closed the result reads Unresolved to the PPU and the Admin; a Done still ends it', async () => {
      await seed(AFTER_PPU_STEP);
      expect((await view()).header.status).toBe('unresolved');
      const adminList = await list(admin(), '?status=unresolved');
      expect(adminList.body.data.rows.map((r: any) => [r.membershipId, r.status])).toEqual([
        [roundTwoId, 'unresolved'],
      ]);
      // Still Unresolved after the first Done (the PPU row is open).
      await done(7001);
      expect((await view(admin())).header.status).toBe('unresolved');
      await done(7002);
      const last = await done(7003);
      expect(last.body.data.status).toBe('quality_assessed');
      expect((await view()).header.status).toBe('quality_assessed');
    });
  });

  describe('FR-12 an Admin acting as PPU', () => {
    it('marks Done as the PPU, marked as Admin; the last one ends the result', async () => {
      await seed(AFTER_PPU_STEP);
      const opened = await view(admin(), asPpu);
      expect(opened).toMatchObject({ writable: true, actingRole: 'PPU' });
      expect(opened.actingRoles).toEqual(['LEAD_ASSESSOR', 'TPB', 'PPU']);
      for (const id of [7001, 7002]) {
        expect((await done(id, { token: admin(), headers: asPpu })).status).toBe(200);
      }
      const last = await done(7003, { token: admin(), headers: asPpu });
      expect(last.body.data).toMatchObject({
        status: 'quality_assessed',
        assessedBy: { id: a.users.admin.id, admin: true },
      });
      expect(
        a.world.commentDecisions.filter((d) => d.roleCode === 'PPU').every((d) => d.actedAsAdmin),
      ).toBe(true);
    });
  });

  describe('FR-11 quick comments of the PPU role', () => {
    it('saves to and reads the PPU list', async () => {
      await seed();
      const saved = await a.send('post', '/quick-comments', {
        token: ppu(),
        body: { role: 'PPU', body: 'Program changed the result' },
      });
      expect(saved.status).toBe(201);
      const listed = await a.send('get', '/quick-comments?role=PPU', { token: ppu() });
      expect(listed.body.data.map((q: any) => q.body)).toEqual(['Program changed the result']);
    });
  });
});
