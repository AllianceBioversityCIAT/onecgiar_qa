// @akili-spec escalation/round-2-tpb
import { PutItemCommand } from '@aws-sdk/client-dynamodb';
import { assertAiSchema, toAttributeMap } from './support/ai-contract.js';
import {
  bearer,
  buildAssessmentApp,
  type AssessmentApp,
} from './support/assessment-app.js';
import { ASSESSED, resultPath } from './support/assessment-seed.js';
import {
  AFTER_TPB_STEP,
  IN_LEAD_STEP,
  IN_TPB_STEP,
  plantProgramResponse,
  plantRoundOneComment,
  seedRoundTwoWorld,
  seedTpbWorld,
} from './support/round-two-fixture.js';

// P2-3916 over real HTTP (FR-1 … FR-14): the TPB's scope, view, decisions,
// Finish and both ends, the refusals, an Admin acting as TPB and the quick
// comments. The world is the shared round-2 fixture (real load runner) with
// the Lead's end planted as it leaves it (`seedTpbWorld`); the whole path with
// the Lead over HTTP is `assessment-round-two-tpb-flow.e2e-spec.ts`. Expected
// values are written out from the requirement scenarios.

const CARRIED = ASSESSED[1]!; // green in round 1, uncommented, unchanged
const SECOND = ASSESSED[2]!;
const FIRST = ASSESSED[3]!;
const AI_FIELD = 'general.gender_tag';
const tpb = () => bearer('sub-tpb');
const lead = () => bearer('sub-lead');
const admin = () => bearer('sub-admin');
const asTpb = { 'X-Acting-Role': 'TPB' };

describe('the Third-Party Broker in step 4 (e2e, P2-3916)', () => {
  let a: AssessmentApp;
  let code: number;
  let roundTwoId: number;
  let leadAssessmentId: number;

  /** FIRST escalated (round-1 comment 7001), SECOND escalated twice (7002 round 1, 7003 the Lead's own), 7004 closed by the Lead. */
  const seed = async (at: Date = IN_TPB_STEP) => {
    a = await buildAssessmentApp(at);
    const built = await seedTpbWorld(a, {
      core: [CARRIED, SECOND, FIRST],
      roundOneGreens: [CARRIED],
      escalated: [
        { id: 7001, fieldKey: FIRST, reason: 'Program figure is wrong' },
        { id: 7002, fieldKey: SECOND },
        { id: 7003, fieldKey: SECOND, origin: 'lead', reason: 'My own point' },
      ],
      sidedProgram: [{ id: 7004, fieldKey: FIRST }],
    });
    plantProgramResponse(a, 1, 7001, 'disagree', 'Our figure is right', 22);
    code = built.code;
    roundTwoId = built.roundTwoId;
    leadAssessmentId = built.leadAssessmentId;
  };
  const roundTwo = () => a.world.memberships.find((m) => m.id === roundTwoId)!;
  const view = async (token = tpb(), headers?: Record<string, string>) =>
    (await a.send('get', resultPath('', code), { token, headers })).body.data;
  const fieldOf = (data: any, key: string) =>
    data.sections
      .flatMap((s: { fields: Array<{ key: string }> }) => s.fields)
      .find((f: { key: string }) => f.key === key);
  const decide = (
    commentId: number,
    decision: string,
    options: { token?: string; headers?: Record<string, string>; body?: string } = {},
  ) =>
    a.send('put', resultPath(`/decisions/${commentId}`, code), {
      token: options.token ?? tpb(),
      headers: options.headers,
      body: { decision, body: options.body ?? 'Reason given' },
    });
  const clear = (commentId: number) =>
    a.send('delete', resultPath(`/decisions/${commentId}`, code), {
      token: tpb(),
    });
  const finish = (token = tpb(), headers?: Record<string, string>) =>
    a.send('post', resultPath('/finish', code), { token, headers });

  afterEach(async () => {
    await a.app.close();
  });

  describe('FR-2 scope and window', () => {
    it('lists the escalated result as Pending for TPB review, writable in step 4', async () => {
      await seed();
      const res = await a.send('get', '/timelines/1/worklist', { token: tpb() });
      expect(res.status).toBe(200);
      expect(
        res.body.data.rows.map((r: any) => [
          r.membershipId,
          r.status,
          r.readOnlyReason,
        ]),
      ).toEqual([[roundTwoId, 'pending_tpb_review', null]]);
      expect(res.body.data.writable).toBe(true);
      // The TPB's own work: Pending for TPB review is pending, not finished.
      expect(res.body.data.counters).toMatchObject({ pending: 1, finished: 0 });
      const opened = await view();
      expect(opened).toMatchObject({ round: 2, writable: true, readOnlyReason: null });
      expect(opened.header.status).toBe('pending_tpb_review');
    });

    it('does not list, and answers the scope 404 for, a round-2 result the Lead has not escalated', async () => {
      a = await buildAssessmentApp(IN_TPB_STEP);
      const built = await seedRoundTwoWorld(a, {
        core: [FIRST],
        changedFields: null,
        roundOneGreens: [],
      });
      a.world.timelines[0]!.steps.push({
        position: 4,
        name: 'Step 4',
        audience: 'tpb',
        opensAt: '2026-11-28T09:00' as never,
        closesAt: '2026-12-02T17:30' as never,
      });
      a.world.timelineUsers.push({
        timelineId: 1,
        userId: a.users.tpb.id,
        roleCode: 'TPB',
      });
      plantRoundOneComment(a, built.roundOneId, 7001, {
        state: 'disagreed',
        fieldKey: FIRST,
      });
      const listed = await a.send('get', '/timelines/1/worklist', {
        token: tpb(),
      });
      expect(listed.body.data.rows).toEqual([]);
      const opened = await a.send('get', resultPath('', built.code), {
        token: tpb(),
      });
      expect(opened.status).toBe(404);
      const decided = await a.send(
        'put',
        resultPath('/decisions/7001', built.code),
        { token: tpb(), body: { decision: 'tpb_agree_program', body: 'x' } },
      );
      expect(decided.status).toBe(404);
    });

    it('is read-only after step 4 closed: step_closed, and every write is refused', async () => {
      await seed(AFTER_TPB_STEP);
      const opened = await view();
      expect(opened).toMatchObject({ writable: false, readOnlyReason: 'step_closed' });
      expect(fieldOf(opened, FIRST).thread[0]).toMatchObject({
        decidable: false,
        choices: [],
      });
      const res = await decide(7001, 'tpb_agree_program');
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ASSESSMENT_STEP_CLOSED');
    });

    it('is read-only before step 4 opens: step_upcoming', async () => {
      await seed(IN_LEAD_STEP);
      expect(await view()).toMatchObject({
        writable: false,
        readOnlyReason: 'step_upcoming',
      });
    });
  });

  describe('FR-1, FR-3, FR-4 the view', () => {
    it('flags the escalated items decidable, keeps the rest read-only, and carries the context', async () => {
      await seed();
      const opened = await view();
      const first = fieldOf(opened, FIRST);
      expect(first.thread).toMatchObject([
        {
          commentId: 7001,
          round: 1,
          state: 'escalated',
          response: { kind: 'disagree', body: 'Our figure is right' },
          leadDecision: { decision: 'escalate', body: 'Program figure is wrong' },
          decidable: true,
          choices: ['tpb_agree_program', 'tpb_agree_assessor'],
        },
        {
          commentId: 7004,
          state: 'lead_sided_program',
          leadDecision: { decision: 'agree_program' },
          decidable: false,
          choices: [],
        },
      ]);
      expect(first.thread[0].valueCopy).toEqual({ value: 'Value when 7001 was written' });
      expect(first.thread[0].decision).toBeUndefined();
      // The Lead's own escalated comment is an item too, with its round.
      expect(fieldOf(opened, SECOND).thread.map((i: any) => [i.commentId, i.round, i.decidable])).toEqual([
        [7002, 1, true],
        [7003, 2, true],
      ]);
      expect(fieldOf(opened, CARRIED)).toMatchObject({
        effectiveValidated: true,
        carried: true,
        thread: [],
      });
      expect(fieldOf(opened, FIRST).effectiveValidated).toBe(false);
      // The TPB has written nothing: no step-4 row, and the view says so.
      expect(opened.assessment).toBeNull();
      expect(a.world.assessments.filter((x) => x.stepPosition === 4)).toEqual([]);
    });
  });

  describe('FR-5 … FR-7 decisions', () => {
    it('agree with the program greens the field in the step-4 row; clearing greys it again', async () => {
      await seed();
      const res = await decide(7001, 'tpb_agree_program', { body: '  Program is right  ' });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        status: 'pending',
        decision: {
          decision: 'tpb_agree_program',
          body: 'Program is right',
          decidedAt: '2026-11-30T10:00:00.000Z',
        },
        validations: [{ fieldKey: FIRST, validated: true }],
      });
      const step4 = a.world.assessments.find((x) => x.stepPosition === 4)!;
      expect(step4).toMatchObject({ status: 'pending', roleCode: 'TPB' });
      expect(a.world.commentDecisions.find((d) => d.roleCode === 'TPB')).toMatchObject({
        commentId: 7001,
        assessmentId: step4.id,
        decision: 'tpb_agree_program',
        body: 'Program is right',
        decidedBy: a.users.tpb.id,
      });
      // States move only at the end (DD-7).
      expect(a.world.comments.find((c) => c.id === 7001)!.state).toBe('escalated');
      expect(fieldOf(await view(), FIRST)).toMatchObject({
        effectiveValidated: true,
        thread: [{ decision: { decision: 'tpb_agree_program' } }, {}],
      });
      expect((await view()).header.status).toBe('pending_tpb_review');

      const cleared = await clear(7001);
      expect(cleared.status).toBe(200);
      expect(cleared.body.data).toMatchObject({
        decision: null,
        validations: [{ fieldKey: FIRST, validated: false }],
      });
      expect(a.world.commentDecisions.filter((d) => d.roleCode === 'TPB')).toEqual([]);
      expect(
        a.world.audits.filter((x) => x.assessmentId === step4.id).map((x) => x.action),
      ).toEqual(['decision_set', 'decision_clear']);
    });

    it('a field with two escalated items turns green only when both side with the program', async () => {
      await seed();
      await decide(7002, 'tpb_agree_program');
      expect(fieldOf(await view(), SECOND).effectiveValidated).toBe(false);
      const both = await decide(7003, 'tpb_agree_program');
      expect(both.body.data.validations).toEqual([{ fieldKey: SECOND, validated: true }]);
      const back = await decide(7003, 'tpb_agree_assessor');
      expect(back.body.data.validations).toEqual([{ fieldKey: SECOND, validated: false }]);
    });

    it('refuses an empty reason (400), a non-escalated comment and a Lead value (409), a foreign comment (404)', async () => {
      await seed();
      const empty = await decide(7001, 'tpb_agree_program', { body: '   ' });
      expect(empty.status).toBe(400);
      expect(empty.body.error.code).toBe('VALIDATION_FAILED');
      const closed = await decide(7004, 'tpb_agree_program');
      expect(closed.status).toBe(409);
      expect(closed.body.error.code).toBe('ASSESSMENT_DECISION_INVALID');
      const leadValue = await decide(7001, 'escalate');
      expect(leadValue.status).toBe(409);
      expect(leadValue.body.error.code).toBe('ASSESSMENT_DECISION_INVALID');
      const foreign = await decide(99999, 'tpb_agree_program');
      expect(foreign.status).toBe(404);
      expect(a.world.commentDecisions.filter((d) => d.roleCode === 'TPB')).toEqual([]);
    });

    it('a Lead cannot send a TPB value on its own route (409)', async () => {
      a = await buildAssessmentApp(IN_LEAD_STEP);
      const built = await seedRoundTwoWorld(a, {
        core: [FIRST],
        changedFields: null,
        roundOneGreens: [],
      });
      plantRoundOneComment(a, built.roundOneId, 7001, {
        state: 'disagreed',
        fieldKey: FIRST,
      });
      code = built.code;
      const res = await decide(7001, 'tpb_agree_program', { token: lead() });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ASSESSMENT_DECISION_INVALID');
    });
  });

  describe('FR-8, FR-9 Finish and the two ends', () => {
    it('refuses Finish while an escalated item is undecided, naming its fields; nothing is written', async () => {
      await seed();
      await decide(7001, 'tpb_agree_program');
      const res = await finish();
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ASSESSMENT_CORE_UNDECIDED');
      expect(res.body.error.fields).toEqual([SECOND]);
      expect(a.world.assessments.find((x) => x.stepPosition === 4)!.status).toBe('pending');
    });

    it('all with the program: Quality Assessed, one qaed release, comments tpb_sided_program', async () => {
      await seed();
      await decide(7001, 'tpb_agree_program');
      await decide(7002, 'tpb_agree_program');
      expect((await decide(7003, 'tpb_agree_program')).body.data.status).toBe('pending');
      // DD-T1: no decision ends the review by itself.
      expect(a.world.releases).toEqual([]);

      const done = await finish();
      expect(done.status).toBe(200);
      expect(done.body.data).toMatchObject({
        status: 'quality_assessed',
        assessedBy: { id: a.users.tpb.id, nickname: 'Tess' },
        finishedAt: '2026-11-30T10:00:00.000Z',
      });
      expect(a.world.releases).toHaveLength(1);
      expect(a.world.releases[0]).toMatchObject({
        timelineResultId: roundTwoId,
        outcome: 'qaed',
      });
      expect(
        a.world.comments.filter((c) => (c.id ?? 0) >= 7001).map((c) => [c.id, c.state]),
      ).toEqual([
        [7001, 'tpb_sided_program'],
        [7002, 'tpb_sided_program'],
        [7003, 'tpb_sided_program'],
        [7004, 'lead_sided_program'],
      ]);
      expect(
        a.world.commentEvents
          .filter((e) => e.actorRole === 'TPB')
          .map((e) => [e.commentId, e.fromState, e.toState]),
      ).toEqual([
        [7001, 'escalated', 'tpb_sided_program'],
        [7002, 'escalated', 'tpb_sided_program'],
        [7003, 'escalated', 'tpb_sided_program'],
      ]);
      expect((await view()).header.status).toBe('quality_assessed');
    });

    it('one with the assessor: escalated, Pending PPU, no release, the PPU case keeps its reason', async () => {
      await seed();
      await decide(7001, 'tpb_agree_assessor', { body: 'The assessor is right' });
      await decide(7002, 'tpb_agree_program');
      await decide(7003, 'tpb_agree_program');
      const done = await finish();
      expect(done.status).toBe(200);
      expect(done.body.data.status).toBe('escalated');
      expect(a.world.releases).toEqual([]);
      expect(roundTwo().ended).toBeFalsy();
      expect(a.world.comments.find((c) => c.id === 7001)!.state).toBe('tpb_sided_assessor');
      expect(
        a.world.commentDecisions.find((d) => d.commentId === 7001 && d.roleCode === 'TPB'),
      ).toMatchObject({ decision: 'tpb_agree_assessor', body: 'The assessor is right' });
      const step4 = a.world.assessments.find((x) => x.stepPosition === 4)!;
      expect(a.world.audits.filter((x) => x.assessmentId === step4.id).at(-1)).toMatchObject({
        action: 'end_escalated',
      });

      const opened = await view();
      expect(opened.header.status).toBe('pending_ppu');
      expect(opened).toMatchObject({ writable: false, readOnlyReason: 'finished' });
      const listed = await a.send('get', '/timelines/1/worklist', { token: tpb() });
      expect(listed.body.data.rows.map((r: any) => [r.membershipId, r.status])).toEqual([
        [roundTwoId, 'pending_ppu'],
      ]);
      expect(listed.body.data.counters).toMatchObject({ pending: 0, finished: 1 });
      const adminList = await a.send('get', '/timelines/1/worklist?status=pending_ppu', {
        token: admin(),
      });
      expect(adminList.body.data.rows.map((r: any) => r.membershipId)).toEqual([roundTwoId]);

      // AC9: nothing changes after the end.
      const late = await decide(7001, 'tpb_agree_program');
      expect(late.status).toBe(409);
      expect(late.body.error.code).toBe('ASSESSMENT_FINISHED');
      expect((await finish()).body.error.code).toBe('ASSESSMENT_FINISHED');
    });
  });

  describe('FR-11 a TPB writes only decisions', () => {
    it('refuses validations, comments and deletes with 403 ASSESSMENT_READ_ONLY', async () => {
      await seed();
      const validated = await a.send('put', resultPath('/validations', code), {
        token: tpb(),
        body: { validated: true, fieldKeys: [FIRST] },
      });
      expect(validated.status).toBe(403);
      expect(validated.body.error.code).toBe('ASSESSMENT_READ_ONLY');
      const commented = await a.send('post', resultPath('/comments', code), {
        token: tpb(),
        key: 'tpb-comment-1',
        body: { fieldKey: FIRST, body: 'A TPB note' },
      });
      expect(commented.status).toBe(403);
      expect(commented.body.error.code).toBe('ASSESSMENT_READ_ONLY');
      const deleted = await a.send('post', '/assessment-comments/7001/delete', {
        token: tpb(),
      });
      expect(deleted.status).toBe(403);
      expect(deleted.body.error.code).toBe('ASSESSMENT_READ_ONLY');
      expect(a.world.assessments.filter((x) => x.stepPosition === 4)).toEqual([]);
    });
  });

  describe('FR-12 an Admin acting as TPB', () => {
    it('decides and finishes after step 4 closed, marked as Admin', async () => {
      await seed(AFTER_TPB_STEP);
      const opened = await view(admin(), asTpb);
      expect(opened).toMatchObject({ writable: true, actingRole: 'TPB' });
      expect(opened.actingRoles).toEqual(['LEAD_ASSESSOR', 'TPB']);
      for (const id of [7001, 7002, 7003]) {
        const res = await decide(id, 'tpb_agree_program', { token: admin(), headers: asTpb });
        expect(res.status).toBe(200);
      }
      expect(
        a.world.commentDecisions.filter((d) => d.roleCode === 'TPB').every((d) => d.actedAsAdmin),
      ).toBe(true);
      const done = await finish(admin(), asTpb);
      expect(done.body.data).toMatchObject({
        status: 'quality_assessed',
        assessedBy: { id: a.users.admin.id, admin: true },
      });
    });
  });

  describe('FR-4 the AI suggestion, read-only with the copy mark', () => {
    it('answers 200 with the suggestion views and the copied/edited mark; a TPB records no usage', async () => {
      a = await buildAssessmentApp(IN_TPB_STEP);
      const built = await seedTpbWorld(a, {
        core: [FIRST, AI_FIELD],
        escalated: [{ id: 7001, fieldKey: AI_FIELD }],
      });
      code = built.code;
      const suggestionId = (1).toString(16).padStart(32, '0');
      await a.aiDynamo.client.send(
        new PutItemCommand({
          TableName: 'cgiar-qa-test',
          Item: toAttributeMap({
            __edb_e__: 'aiSuggestion',
            __edb_v__: '1',
            pk: `RESULT#${code}`,
            sk: `AI#${built.snapKey}#${AI_FIELD}#v2-1.0.0`,
            resultCode: code,
            snapKey: built.snapKey,
            promptVersion: 'v2-1.0.0',
            runId: 'load-1',
            createdAt: '2026-11-20T12:00:00Z',
            fieldKey: AI_FIELD,
            suggestionId,
            status: 'available',
            signal: 'red',
            suggestedValue: 0,
            reportedValue: 2,
            explanation: 'The evidence does not mention it.',
            evidenceQuote: 'trained farmers',
            evidenceSource: 'https://example.org/e.pdf',
            evidenceSourceIndex: 0,
            evidenceHash: 'h',
            quoteVerified: true,
            partialEvidence: false,
            modelId: 'anthropic.claude-haiku-5-5',
            unavailableReason: null,
          }) as never,
        }),
      );
      const res = await a.send(
        'get',
        `/timelines/1/results/${code}/ai-suggestions`,
        { token: tpb() },
      );
      expect(res.status).toBe(200);
      for (const v of res.body.data) assertAiSchema('ai-suggestion-view', v);
      const entry = (res.body.data as Array<Record<string, unknown>>).find(
        (v) => v.fieldKey === AI_FIELD,
      )!;
      expect(entry).toMatchObject({
        status: 'available',
        copiedByReviewer: false,
        editedByReviewer: null,
      });
      const used = await a.send(
        'post',
        `/timelines/1/results/${code}/ai-suggestions/${suggestionId}/events`,
        { token: tpb(), body: { action: 'shown' } },
      );
      expect(used.status).toBe(403);
      expect(used.body.error.code).toBe('ASSESSMENT_READ_ONLY');
    });
  });

  describe('FR-10 quick comments of the TPB role', () => {
    it('saves to and reads the TPB list', async () => {
      await seed();
      const saved = await a.send('post', '/quick-comments', {
        token: tpb(),
        body: { role: 'TPB', body: 'Program evidence is sufficient' },
      });
      expect(saved.status).toBe(201);
      const list = await a.send('get', '/quick-comments?role=TPB', { token: tpb() });
      expect(list.status).toBe(200);
      expect(list.body.data.map((q: any) => q.body)).toEqual([
        'Program evidence is sufficient',
      ]);
    });
  });

  describe("FR-13 the Lead's view after the TPB starts", () => {
    it("still shows the Lead's own step-3 review, read-only, with the current status", async () => {
      await seed();
      await decide(7001, 'tpb_agree_program');
      const res = await a.send('get', resultPath('', code), { token: lead() });
      expect(res.status).toBe(200);
      const data = res.body.data;
      expect(data.assessment).toMatchObject({
        status: 'escalated',
        assessedBy: { id: a.users.lead.id },
      });
      expect(data.header.status).toBe('pending_tpb_review');
      expect(data.writable).toBe(false);
      // The Lead's own escalated comment stays on its field.
      expect(fieldOf(data, SECOND).comments.map((c: any) => c.id)).toEqual([7003]);
      // A Lead write is refused: its review ended.
      const late = await decide(7002, 'agree_program', { token: lead() });
      expect(late.status).toBe(409);
      expect(['ASSESSMENT_FINISHED', 'ASSESSMENT_STEP_CLOSED']).toContain(late.body.error.code);
      expect(leadAssessmentId).toBeGreaterThan(0);
    });
  });
});
