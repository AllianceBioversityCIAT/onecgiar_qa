// @akili-spec escalation/round-2-tpb
import { PutItemCommand } from '@aws-sdk/client-dynamodb';
import { toAttributeMap } from './support/ai-contract.js';
import {
  bearer,
  buildAssessmentApp,
  type AssessmentApp,
} from './support/assessment-app.js';
import { ASSESSED, resultPath } from './support/assessment-seed.js';
import {
  IN_LEAD_STEP,
  IN_TPB_STEP,
  plantRoundOneComment,
  seedRoundTwoWorld,
  seedTpbWorld,
  tpbStep,
} from './support/round-two-fixture.js';

// DD-T11 over real HTTP: a person who is Lead Assessor AND TPB on the same
// timeline gets one deterministic role per result, `header.reviewerRole`, and
// the view, the decisions and the finish all use it. Expected values are the
// brief's mapping: pending → LEAD_ASSESSOR, pending_tpb_review → TPB; an Admin
// with X-Acting-Role gets that role; an Admin without it, null.

const CARRIED = ASSESSED[1]!;
const SECOND = ASSESSED[2]!;
const AI_FIELD = 'general.gender_tag';
const FIRST = ASSESSED[3]!;
const lead = () => bearer('sub-lead');
const admin = () => bearer('sub-admin');
const actingAs = (role: string) => ({ 'X-Acting-Role': role });

describe('Effective reviewer role of a Lead who is also TPB (e2e, DD-T11)', () => {
  let a: AssessmentApp;
  let code: number;

  /** Lena (sub-lead) also holds TPB, assigned as TPB on timeline 1. */
  const alsoTpb = async () => {
    await a.grant(a.users.lead.id, 'TPB');
    a.world.timelineUsers.push({
      timelineId: 1,
      userId: a.users.lead.id,
      roleCode: 'TPB',
    });
  };
  const open = async (token: string, headers?: Record<string, string>) => {
    const res = await a.send('get', resultPath('', code), { token, headers });
    expect(res.status).toBe(200);
    return res.body.data;
  };
  const threadOf = (data: any) =>
    data.sections
      .flatMap((s: any) => s.fields)
      .flatMap((f: any) => f.thread ?? [])
      .map((i: any) => [i.commentId, i.decidable, i.choices]);

  afterEach(async () => {
    await a.app.close();
  });

  describe('pending (step 3): the Lead role', () => {
    beforeEach(async () => {
      a = await buildAssessmentApp(IN_LEAD_STEP);
      const built = await seedRoundTwoWorld(a, {
        core: [CARRIED, SECOND, FIRST],
        changedFields: null,
        roundOneGreens: [CARRIED],
      });
      a.world.timelines[0]!.steps.push(tpbStep());
      code = built.code;
      plantRoundOneComment(a, built.roundOneId, 7001, {
        state: 'disagreed',
        fieldKey: FIRST,
      });
      await alsoTpb();
    });

    it('reads and decides as LEAD_ASSESSOR', async () => {
      const data = await open(lead());
      expect(data.header).toMatchObject({
        status: 'pending',
        reviewerRole: 'LEAD_ASSESSOR',
      });
      expect(data.writable).toBe(true);
      expect(threadOf(data)).toEqual([
        [7001, true, ['agree_program', 'escalate']],
      ]);

      const decided = await a.send('put', resultPath('/decisions/7001', code), {
        token: lead(),
        body: { decision: 'escalate', body: 'Wrong figure' },
      });
      expect(decided.status).toBe(200);
      expect(a.world.commentDecisions).toMatchObject([
        { commentId: 7001, roleCode: 'LEAD_ASSESSOR', decision: 'escalate' },
      ]);
    });

    it('a non-admin X-Acting-Role is ignored: still LEAD_ASSESSOR', async () => {
      expect((await open(lead(), actingAs('TPB'))).header.reviewerRole).toBe(
        'LEAD_ASSESSOR',
      );
    });

    it('an Admin gets the role it acts as, and null without X-Acting-Role', async () => {
      expect(
        (await open(admin(), actingAs('LEAD_ASSESSOR'))).header.reviewerRole,
      ).toBe('LEAD_ASSESSOR');
      const asTpb = await open(admin(), actingAs('TPB'));
      expect(asTpb.header.reviewerRole).toBe('TPB');
      expect(asTpb.actingRole).toBe('TPB');
      const plain = await open(admin());
      expect(plain.header.reviewerRole).toBeNull();
      expect(plain.actingRole).toBeNull();
    });
  });

  describe('pending_tpb_review (step 4): the TPB role', () => {
    let leadAssessmentId: number;

    beforeEach(async () => {
      a = await buildAssessmentApp(IN_TPB_STEP);
      const built = await seedTpbWorld(a, {
        core: [CARRIED, SECOND, FIRST],
        roundOneGreens: [CARRIED],
        escalated: [{ id: 7001, fieldKey: FIRST, reason: 'Wrong figure' }],
        leadGreens: [SECOND],
      });
      code = built.code;
      leadAssessmentId = built.leadAssessmentId;
      await alsoTpb();
    });

    it('reads as TPB: no own assessment yet, the escalation decidable with the TPB choices', async () => {
      const data = await open(lead());
      expect(data.header).toMatchObject({
        status: 'pending_tpb_review',
        reviewerRole: 'TPB',
      });
      // Not the Lead's own escalated step-3 review (which would read `finished`).
      expect(data.assessment).toBeNull();
      expect(data.writable).toBe(true);
      expect(threadOf(data)).toEqual([
        [7001, true, ['tpb_agree_program', 'tpb_agree_assessor']],
      ]);
    });

    it('decides and finishes as TPB on its own step-4 assessment', async () => {
      const decided = await a.send('put', resultPath('/decisions/7001', code), {
        token: lead(),
        body: { decision: 'tpb_agree_program', body: 'Program is right' },
      });
      expect(decided.status).toBe(200);
      expect(
        a.world.commentDecisions.filter((d) => d.roleCode === 'TPB'),
      ).toMatchObject([{ commentId: 7001, decision: 'tpb_agree_program' }]);

      const finished = await a.send('post', resultPath('/finish', code), {
        token: lead(),
      });
      expect(finished.status).toBe(200);
      const tpbRow = a.world.assessments.find((row) => row.stepPosition === 4);
      expect(tpbRow).toMatchObject({
        roleCode: 'TPB',
        finishedBy: a.users.lead.id,
      });
      expect(
        a.world.assessments.find((row) => row.id === leadAssessmentId)?.status,
      ).toBe('escalated');
    });

    it('an Admin acting as the Lead reads the Lead role and its ended review; without X-Acting-Role, null', async () => {
      const asLead = await open(admin(), actingAs('LEAD_ASSESSOR'));
      expect(asLead.header.reviewerRole).toBe('LEAD_ASSESSOR');
      expect(asLead.assessment?.status).toBe('escalated');
      expect(asLead.readOnlyReason).toBe('finished');

      expect((await open(admin(), actingAs('TPB'))).header.reviewerRole).toBe(
        'TPB',
      );
      expect((await open(admin())).header.reviewerRole).toBeNull();
    });
  });
  describe('the AI route follows the effective role', () => {
    it('a Lead who is also TPB gets the TPB AI mode on a pending_tpb_review result: the copy mark, and no usage event', async () => {
      a = await buildAssessmentApp(IN_TPB_STEP);
      const built = await seedTpbWorld(a, {
        core: [FIRST, AI_FIELD],
        escalated: [{ id: 7001, fieldKey: AI_FIELD }],
      });
      code = built.code;
      await alsoTpb();
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
        { token: lead() },
      );
      expect(res.status).toBe(200);
      // The TPB mode carries the reviewer's copy mark (the Lead's mode does not).
      expect(
        (res.body.data as Array<Record<string, unknown>>).find(
          (v) => v.fieldKey === AI_FIELD,
        ),
      ).toMatchObject({
        status: 'available',
        copiedByReviewer: false,
        editedByReviewer: null,
      });
      // A TPB reads; only a reviewer's use measures the AI.
      const used = await a.send(
        'post',
        `/timelines/1/results/${code}/ai-suggestions/${suggestionId}/events`,
        { token: lead(), body: { action: 'shown' } },
      );
      expect(used.status).toBe(403);
      expect(used.body.error.code).toBe('ASSESSMENT_READ_ONLY');
    });
  });
});
