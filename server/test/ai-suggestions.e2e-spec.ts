// @akili-spec assessment/ai-suggestions
import { PutItemCommand } from '@aws-sdk/client-dynamodb';
import type request from 'supertest';
import type { ConfigItem } from '../src/admin-config/field-config/field-config-diff.js';
import { snapshotKeyOf } from '../src/ingestion/load-rules.js';
import { assertAiSchema, toAttributeMap } from './support/ai-contract.js';
import {
  bearer,
  buildAssessmentApp,
  withoutRequestMeta,
  type AssessmentApp,
} from './support/assessment-app.js';
import { defaultFakeSteps } from './support/in-memory-assessment.js';
import { runRealLoad } from './support/real-load-writer.js';

// The AI suggestion routes over real HTTP (ai-suggestions T-5, T-8; FR-4,
// FR-5, FR-8, FR-9, FR-11, NFR-1, NFR-3). Guards, pipe, envelope and OpenAPI
// are real; the worker's items sit in a fake DynamoDB table and are read by
// the real ElectroDB store. Snapshots come from the real LoadRunner, so the
// `snapKey` of an item is the runner's own. Expected values are written out.

const IRL = 'innovation_dev.readiness_level';
const GENDER = 'general.gender_tag';
const CLIMATE = 'general.climate_tag';
const POVERTY = 'general.poverty_tag';
const PROMPT = 'v2-1.0.0';

const base = (code: number) => `/timelines/1/results/${code}/ai-suggestions`;
const events = (code: number, id: string) => `${base(code)}/${id}/events`;
const policy = () => bearer('sub-policy');
const id = (n: number) => n.toString(16).padStart(32, '0');

function expectError(res: request.Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(res.body).toMatchObject({ success: false, error: { status, code } });
}

describe('AI suggestions (e2e)', () => {
  let a: AssessmentApp;
  let code: number;
  let snapKey: string;

  async function putItem(item: Record<string, unknown>, checkSchema = true) {
    const full: Record<string, unknown> = {
      __edb_e__: 'aiSuggestion',
      __edb_v__: '1',
      resultCode: code,
      snapKey,
      promptVersion: PROMPT,
      runId: 'load-1',
      createdAt: '2026-11-20T12:00:00Z',
      ...item,
    };
    full.pk = `RESULT#${code}`;
    full.sk = `AI#${String(full.snapKey)}#${String(full.fieldKey)}#${String(full.promptVersion)}`;
    if (checkSchema) assertAiSchema('ai-suggestion-item', full);
    await a.aiDynamo.client.send(
      new PutItemCommand({
        TableName: 'cgiar-qa-test',
        Item: toAttributeMap(full) as never,
      }),
    );
  }

  const available = (
    fieldKey: string,
    n: number,
    over: Record<string, unknown> = {},
  ) =>
    putItem({
      fieldKey,
      suggestionId: id(n),
      status: 'available',
      signal: 'red',
      suggestedValue: 0,
      reportedValue: 2,
      explanation: 'The evidence does not mention gender.',
      evidenceQuote: 'trained farmers',
      evidenceSource: 'https://example.org/e.pdf',
      evidenceSourceIndex: 0,
      evidenceHash: 'h',
      quoteVerified: true,
      partialEvidence: false,
      modelId: 'anthropic.claude-haiku-5-5',
      unavailableReason: null,
      ...over,
    });

  const configure = (aiFields: string[], extra: ConfigItem[] = []) => {
    const items: ConfigItem[] = [
      ...[GENDER, CLIMATE, POVERTY, IRL, 'general.title'].map((fieldKey) => ({
        resultTypeKey: 'policy_change',
        fieldKey,
        // FR-1: eligible = in production AND Assessed; the AI input flag is not read.
        visibility: aiFields.includes(fieldKey)
          ? ('assessed' as const)
          : ('view_only' as const),
        isCore: false,
        isAiInput: false,
      })),
      ...extra,
    ];
    a.world.fieldConfigItems['policy_change'] = items;
    a.world.versionItems[1] = { policy_change: items };
  };

  /** Each GET entry passes the worker's view schema. */
  const getViews = async (token = policy(), resultCode = code) => {
    const res = await a.send('get', base(resultCode), { token });
    if (res.status === 200) {
      for (const view of res.body.data)
        assertAiSchema('ai-suggestion-view', view);
    }
    return res;
  };
  const post = (suggestionId: string, body: object, token = policy()) => {
    assertAiSchema('ai-suggestion-event', body);
    return a.send('post', events(code, suggestionId), { token, body });
  };

  beforeEach(async () => {
    a = await buildAssessmentApp();
    a.world.timelines.push({
      id: 1,
      name: 'Official',
      kind: 'official',
      steps: defaultFakeSteps(),
    });
    a.world.timelineUsers.push({
      timelineId: 1,
      userId: a.users.policy.id,
      roleCode: 'ASSESSOR',
    });
    a.world.users.push({ id: a.users.policy.id, nickname: 'Pia' });
    const real = await runRealLoad([
      { resultId: 1001, values: { 'general.title': 'T' } },
    ]);
    const written = real.memberships[0]!;
    for (const snapshot of await real.snapshots.history(written.resultCode)) {
      await a.snapshots.put(snapshot);
    }
    code = written.resultCode;
    snapKey = snapshotKeyOf(written.snapshotSk);
    a.world.memberships.push({
      id: 1,
      timelineId: 1,
      resultCode: code,
      title: null,
      programId: 1,
      resultTypeKey: 'policy_change',
      snapshotSk: written.snapshotSk,
    });
    configure([GENDER, CLIMATE, POVERTY, IRL]);
  });

  afterEach(async () => {
    await a.app.close();
  });

  describe('GET (FR-4, FR-5)', () => {
    it('answers one view per AI-input field: available, unavailable with its reason, pending', async () => {
      await available(GENDER, 1);
      await putItem({
        fieldKey: CLIMATE,
        suggestionId: id(2),
        status: 'unavailable',
        unavailableReason: 'no_supporting_quote',
      });

      const res = await getViews();

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([
        {
          status: 'available',
          fieldKey: GENDER,
          suggestionId: id(1),
          signal: 'red',
          valueKind: 'level',
          suggestedValue: 0,
          explanation: 'The evidence does not mention gender.',
          evidenceQuote: 'trained farmers',
          quoteVerified: true,
          evidenceSource: 'https://example.org/e.pdf',
          promptVersion: PROMPT,
          modelId: 'anthropic.claude-haiku-5-5',
        },
        {
          status: 'unavailable',
          fieldKey: CLIMATE,
          unavailableReason: 'no_supporting_quote',
        },
        { status: 'pending', fieldKey: POVERTY },
        { status: 'pending', fieldKey: IRL },
      ]);
    });

    it('shows nothing for an Assessed field not in production, nor for a View only one', async () => {
      configure(
        [GENDER],
        [
          {
            resultTypeKey: 'policy_change',
            fieldKey: 'general.description',
            visibility: 'assessed',
            isCore: false,
            isAiInput: true,
          },
        ],
      );
      await available(CLIMATE, 3);
      await putItem({
        fieldKey: 'general.description',
        suggestionId: id(4),
        status: 'unavailable',
        unavailableReason: 'no_criteria_for_field',
      });

      const res = await getViews();

      expect(res.body.data).toEqual([{ status: 'pending', fieldKey: GENDER }]);
    });

    it('ignores the items of another prompt version', async () => {
      await available(GENDER, 1, { promptVersion: 'v1-1.0.0' });
      const res = await getViews();
      expect(res.body.data[0]).toEqual({ status: 'pending', fieldKey: GENDER });
    });

    it('answers [] for a membership that is not pending (no job was sent)', async () => {
      a.world.memberships[0]!.status = 'auto_validated';
      await available(GENDER, 1);
      const res = await getViews();
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });

    it('gives an ADMIN the suggestions read-only, without the copied mark (OQ-2)', async () => {
      await available(GENDER, 1);
      await post(id(1), { action: 'copied' });

      const res = await getViews(bearer('sub-admin'));

      expect(res.status).toBe(200);
      expect(res.body.data[0].status).toBe('available');
      expect(res.body.data[0]).not.toHaveProperty('copiedByReviewer');
      expect(res.body.data[0]).not.toHaveProperty('editedByReviewer');
    });

    it('gives the assessor no copied mark either', async () => {
      await available(GENDER, 1);
      await post(id(1), { action: 'copied' });
      const res = await getViews();
      expect(res.body.data[0]).not.toHaveProperty('copiedByReviewer');
    });

    it('a result outside the caller scope is the same 404 body as the assessment view', async () => {
      const ai = await a.send('get', base(999_999), { token: policy() });
      const view = await a.send(
        'get',
        `/timelines/1/results/999999/assessment`,
        { token: policy() },
      );
      expectError(ai, 404, 'ASSESSMENT_NOT_FOUND');
      expect(withoutRequestMeta(ai.body)).toEqual(
        withoutRequestMeta(view.body),
      );
      const other = await a.send('get', base(code), {
        token: bearer('sub-other'),
      });
      expect(withoutRequestMeta(other.body)).toEqual(
        withoutRequestMeta(view.body),
      );
    });

    // P2-3916 enabled the TPB row; it covers round-2 results the Lead escalated only (the TPB view is in assessment-round-two-tpb.e2e-spec.ts).
    it('a TPB on a round-1 result gets the assessment 404 (its row is round 2, step 4)', async () => {
      a.world.timelineUsers.push({
        timelineId: 1,
        userId: a.users.tpb.id,
        roleCode: 'TPB',
      });
      const res = await getViews(bearer('sub-tpb'));
      expectError(res, 404, 'ASSESSMENT_NOT_FOUND');
    });

    it('503 when DynamoDB cannot be read (the client shows "Suggestion not available")', async () => {
      a.aiSource.down = true;
      const res = await getViews();
      expectError(res, 503, 'SERVICE_UNAVAILABLE');
    });
  });

  describe('POST events (FR-8)', () => {
    beforeEach(async () => {
      await available(GENDER, 1);
      await available(IRL, 5, {
        signal: 'amber',
        suggestedValue: 3,
        reportedValue: 6,
        explanation: 'Evidence explicitly supports level 3.',
      });
    });

    it('records shown once, with the levels copied from the stored item; a repeat is a 204 no-op', async () => {
      const first = await post(id(5), { action: 'shown' });
      const again = await post(id(5), { action: 'shown' });

      expect(first.status).toBe(204);
      expect(again.status).toBe(204);
      expect(a.aiUsage.rows).toEqual([
        expect.objectContaining({
          suggestionId: id(5),
          timelineResultId: 1,
          stepPosition: 1,
          roleCode: 'ASSESSOR',
          fieldKey: IRL,
          promptVersion: PROMPT,
          signal: 'amber',
          action: 'shown',
          aiLevel: 3,
          reportedLevel: 6,
        }),
      ]);
      // A read never creates the assessment (DD-3).
      expect(a.world.assessments).toEqual([]);
    });

    it('records copied once', async () => {
      await post(id(1), { action: 'copied' });
      await post(id(1), { action: 'copied' });
      expect(a.aiUsage.rows.map((r) => r.action)).toEqual(['copied']);
    });

    it('comment_saved stores whether the copy was edited, never the text', async () => {
      await a.send('post', `/timelines/1/results/${code}/assessment/comments`, {
        token: policy(),
        key: 'k-1',
        body: {
          fieldKey: GENDER,
          body: '  The evidence does not   mention gender. ',
        },
      });
      await a.send('post', `/timelines/1/results/${code}/assessment/comments`, {
        token: policy(),
        key: 'k-2',
        body: { fieldKey: GENDER, body: 'Gender is not in the evidence.' },
      });
      const [c1, c2] = a.world.comments;

      expect(
        (
          await post(id(1), {
            action: 'comment_saved',
            commentId: String(c1!.id),
          })
        ).status,
      ).toBe(204);
      expect(
        (
          await post(id(1), {
            action: 'comment_saved',
            commentId: String(c2!.id),
          })
        ).status,
      ).toBe(204);
      expect(
        (
          await post(id(1), {
            action: 'comment_saved',
            commentId: String(c2!.id),
          })
        ).status,
      ).toBe(204);

      expect(
        a.aiUsage.rows.map((r) => [r.action, r.commentId, r.edited]),
      ).toEqual([
        ['comment_saved', c1!.id, false],
        ['comment_saved', c2!.id, true],
      ]);
      expect(JSON.stringify(a.aiUsage.rows)).not.toContain('Gender is not');
    });

    it('comment_saved of a comment on another field is a 400', async () => {
      await a.send('post', `/timelines/1/results/${code}/assessment/comments`, {
        token: policy(),
        key: 'k-3',
        body: { fieldKey: CLIMATE, body: 'x' },
      });
      const res = await post(id(1), {
        action: 'comment_saved',
        commentId: String(a.world.comments[0]!.id),
      });
      expectError(res, 400, 'AI_EVENT_INVALID');
      expect(a.aiUsage.rows).toEqual([]);
    });

    it('comment_saved without a comment id is a 400', async () => {
      const res = await post(id(1), { action: 'comment_saved' });
      expectError(res, 400, 'AI_EVENT_INVALID');
    });

    it('validated_above_ai with the stored levels, 2+ apart and a one-line reason is recorded once', async () => {
      const body = {
        action: 'validated_above_ai',
        aiLevel: 3,
        validatedLevel: 6,
        reason: 'The pilot report shows use in the field.',
      };
      expect((await post(id(5), body)).status).toBe(204);
      expect((await post(id(5), { ...body, reason: 'Another' })).status).toBe(
        204,
      );
      expect(a.aiUsage.rows).toEqual([
        expect.objectContaining({
          action: 'validated_above_ai',
          aiLevel: 3,
          validatedLevel: 6,
          reason: 'The pilot report shows use in the field.',
        }),
      ]);
    });

    it.each([
      [
        'an AI level that is not the stored one',
        { aiLevel: 4, validatedLevel: 6 },
      ],
      [
        'a validated level that is not the reported one',
        { aiLevel: 3, validatedLevel: 7 },
      ],
    ])('validated_above_ai with %s is a 400', async (_label, levels) => {
      const res = await post(id(5), {
        action: 'validated_above_ai',
        ...levels,
        reason: 'r',
      });
      expectError(res, 400, 'AI_EVENT_INVALID');
    });

    it('validated_above_ai with a difference of 1 is a 400', async () => {
      await available(IRL, 5, { suggestedValue: 3, reportedValue: 4 });
      const res = await post(id(5), {
        action: 'validated_above_ai',
        aiLevel: 3,
        validatedLevel: 4,
        reason: 'r',
      });
      expectError(res, 400, 'AI_EVENT_INVALID');
      expect(a.aiUsage.rows).toEqual([]);
    });

    it('validated_above_ai on an impact-area tag is a 400', async () => {
      await available(POVERTY, 6, { suggestedValue: 0, reportedValue: 2 });
      expectError(
        await post(id(6), {
          action: 'validated_above_ai',
          aiLevel: 0,
          validatedLevel: 2,
          reason: 'r',
        }),
        400,
        'AI_EVENT_INVALID',
      );
    });

    it.each([
      ['a reason with a line break', { reason: 'a\nb' }],
      ['a reason of 201 characters', { reason: 'x'.repeat(201) }],
      ['no reason', { reason: undefined }],
      ['a level above 9', { validatedLevel: 10 }],
    ])(
      'validated_above_ai with %s is 400 VALIDATION_FAILED',
      async (_l, over) => {
        const res = await a.send('post', events(code, id(5)), {
          token: policy(),
          body: {
            action: 'validated_above_ai',
            aiLevel: 3,
            validatedLevel: 6,
            reason: 'r',
            ...over,
          },
        });
        expectError(res, 400, 'VALIDATION_FAILED');
      },
    );

    it('a level sent with a usage event is 400 VALIDATION_FAILED (additionalProperties)', async () => {
      const res = await a.send('post', events(code, id(1)), {
        token: policy(),
        body: { action: 'copied', aiLevel: 1 },
      });
      expectError(res, 400, 'VALIDATION_FAILED');
    });

    it('an unknown or unavailable suggestion is a 404', async () => {
      await putItem({
        fieldKey: CLIMATE,
        suggestionId: id(7),
        status: 'unavailable',
        unavailableReason: 'private_link',
      });
      expectError(
        await post(id(99), { action: 'shown' }),
        404,
        'AI_SUGGESTION_NOT_FOUND',
      );
      expectError(
        await post(id(7), { action: 'shown' }),
        404,
        'AI_SUGGESTION_NOT_FOUND',
      );
    });

    it('reads a dashed UUID id (worker builds before 17-nov) as the 32-hex one, and records it either way', async () => {
      const dashed = '04cb6e23-f605-52c9-a32e-ef6b538ecec8';
      const hex = '04cb6e23f60552c9a32eef6b538ecec8';
      // Stored as the old worker wrote it, so outside the item schema on purpose.
      await putItem(
        {
          fieldKey: CLIMATE,
          suggestionId: dashed,
          status: 'available',
          signal: 'red',
          suggestedValue: 0,
          reportedValue: 2,
          explanation: 'The evidence does not mention climate.',
          evidenceQuote: 'trained farmers',
          evidenceSource: 'https://example.org/e.pdf',
          evidenceSourceIndex: 0,
          evidenceHash: 'h',
          quoteVerified: true,
          partialEvidence: false,
          modelId: 'anthropic.claude-haiku-5-5',
          unavailableReason: null,
        },
        false,
      );
      configure([GENDER, CLIMATE, POVERTY, IRL]);
      const views = await getViews();
      expect(
        views.body.data.find(
          (v: { fieldKey: string }) => v.fieldKey === CLIMATE,
        ).suggestionId,
      ).toBe(hex);

      expect((await post(dashed, { action: 'shown' })).status).toBe(204);
      expect((await post(hex, { action: 'copied' })).status).toBe(204);
      expect(
        a.aiUsage.rows
          .filter((r) => r.fieldKey === CLIMATE)
          .map((r) => [r.suggestionId, r.action]),
      ).toEqual([
        [hex, 'shown'],
        [hex, 'copied'],
      ]);
    });

    it('a malformed suggestion id is 400 VALIDATION_FAILED', async () => {
      const res = await a.send('post', events(code, 'not-an-id'), {
        token: policy(),
        body: { action: 'shown' },
      });
      expectError(res, 400, 'VALIDATION_FAILED');
    });

    it('an ADMIN reads but records nothing: 403 ASSESSMENT_READ_ONLY', async () => {
      const res = await post(id(1), { action: 'copied' }, bearer('sub-admin'));
      expectError(res, 403, 'ASSESSMENT_READ_ONLY');
      expect(a.aiUsage.rows).toEqual([]);
    });
  });

  describe('indicative fields (contract 2.0.0)', () => {
    const CATEGORY = 'general.result_type';
    const resultType = (visibility: 'assessed' | 'view_only') => ({
      resultTypeKey: 'policy_change',
      fieldKey: CATEGORY,
      visibility,
      isCore: false,
      isAiInput: false,
    });
    const category = (n: number, over: Record<string, unknown> = {}) =>
      putItem({
        fieldKey: CATEGORY,
        suggestionId: id(n),
        promptVersion: 'v1-1.0.0',
        status: 'available',
        signal: 'indicative',
        valueKind: 'category',
        suggestedValue: 'Knowledge Product',
        reportedValue: 'policy_change',
        explanation: 'The evidence describes a published report.',
        evidenceQuote: null,
        evidenceSource: 'https://example.org/e.pdf',
        quoteVerified: false,
        modelId: 'anthropic.claude-haiku-5-5',
        ...over,
      });

    it('answers the suggested category with no colour and no quote, on its own prompt version', async () => {
      configure([GENDER], [resultType('assessed')]);
      await available(GENDER, 1);
      await category(2);
      const res = await getViews();
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([
        expect.objectContaining({ fieldKey: GENDER, valueKind: 'level' }),
        {
          status: 'available',
          fieldKey: CATEGORY,
          suggestionId: id(2),
          signal: 'indicative',
          valueKind: 'category',
          suggestedValue: 'Knowledge Product',
          explanation: 'The evidence describes a published report.',
          evidenceQuote: null,
          quoteVerified: false,
          evidenceSource: 'https://example.org/e.pdf',
          promptVersion: 'v1-1.0.0',
          modelId: 'anthropic.claude-haiku-5-5',
        },
      ]);
    });

    it('ignores a category stored on the scored version (v2): production says v1 for it', async () => {
      configure([], [resultType('assessed')]);
      await category(3, { promptVersion: 'v2-1.0.0' });
      const res = await getViews();
      expect(res.body.data).toEqual([
        { status: 'pending', fieldKey: CATEGORY },
      ]);
    });

    it('shows nothing for result type when it is View only', async () => {
      configure([], [resultType('view_only')]);
      await category(4);
      const res = await getViews();
      expect(res.body.data).toEqual([]);
    });

    it('records shown with the indicative signal and no levels; copied the same way', async () => {
      configure([], [resultType('assessed')]);
      await category(5);
      expect((await post(id(5), { action: 'shown' })).status).toBe(204);
      expect((await post(id(5), { action: 'copied' })).status).toBe(204);
      expect(a.aiUsage.rows).toEqual([
        expect.objectContaining({
          action: 'shown',
          fieldKey: CATEGORY,
          promptVersion: 'v1-1.0.0',
          signal: 'indicative',
          aiLevel: null,
          reportedLevel: null,
        }),
        expect.objectContaining({ action: 'copied', signal: 'indicative' }),
      ]);
    });

    it('refuses validated_above_ai on an indicative field (IRL/IUL only)', async () => {
      configure([], [resultType('assessed')]);
      await category(6);
      const res = await post(id(6), {
        action: 'validated_above_ai',
        aiLevel: 1,
        validatedLevel: 3,
        reason: 'One line.',
      });
      expectError(res, 400, 'AI_EVENT_INVALID');
      expect(a.aiUsage.rows).toEqual([]);
    });
  });

  describe('FR-11 missing reasons (ADMIN)', () => {
    it('counts IRL/IUL validated 2+ above the AI, with and without a reason; counts only', async () => {
      await available(IRL, 5, { suggestedValue: 3, reportedValue: 6 });
      await post(id(5), { action: 'shown' });
      // The assessor validates IRL: the assessment row is created by the write.
      await a.send(
        'put',
        `/timelines/1/results/${code}/assessment/validations`,
        {
          token: policy(),
          body: { validated: true, fieldKeys: [IRL] },
        },
      );

      const before = await a.send(
        'get',
        '/ai-suggestions/analysis/missing-reasons',
        {
          token: bearer('sub-admin'),
        },
      );
      expect(before.status).toBe(200);
      expect(before.body.data).toEqual({
        basis: 'shown',
        fields: [
          {
            fieldKey: IRL,
            promptVersion: PROMPT,
            withReason: 0,
            withoutReason: 1,
          },
        ],
      });

      await post(id(5), {
        action: 'validated_above_ai',
        aiLevel: 3,
        validatedLevel: 6,
        reason: 'Field use shown in the report.',
      });
      const after = await a.send(
        'get',
        '/ai-suggestions/analysis/missing-reasons',
        {
          token: bearer('sub-admin'),
        },
      );
      expect(after.body.data.fields).toEqual([
        {
          fieldKey: IRL,
          promptVersion: PROMPT,
          withReason: 1,
          withoutReason: 0,
        },
      ]);
      expect(after.text).not.toMatch(/sub-|policy|Pia|@/);
    });

    it('is admin only', async () => {
      const res = await a.send(
        'get',
        '/ai-suggestions/analysis/missing-reasons',
        {
          token: policy(),
        },
      );
      expectError(res, 403, 'AUTH_PERMISSION_DENIED');
    });
  });
});
