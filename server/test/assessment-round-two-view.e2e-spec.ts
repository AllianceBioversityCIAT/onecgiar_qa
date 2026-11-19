// @akili-spec escalation/round-2
import { PutItemCommand } from '@aws-sdk/client-dynamodb';
import type { OpenAPIObject } from '@nestjs/swagger';
import { vi } from 'vitest';
import { buildOpenApiDocument } from '../src/common/openapi.js';
import { assertAiSchema, toAttributeMap } from './support/ai-contract.js';
import {
  bearer,
  buildAssessmentApp,
  type AssessmentApp,
} from './support/assessment-app.js';
import { ASSESSED, resultPath } from './support/assessment-seed.js';
import { InMemoryAssessmentStore } from './support/in-memory-assessment.js';
import { runRealLoad } from './support/real-load-writer.js';
import {
  addTwoRounds,
  IN_LEAD_STEP,
  plantProgramResponse,
  plantRoundOneComment,
  seedRoundTwoWorld,
} from './support/round-two-fixture.js';

// The round-2 view of the Lead over real HTTP (P2-3912 T-6): FR-3 `actionable`,
// FR-4 the round-1 thread, FR-5 `updated`, FR-6 AI for the Lead, FR-7 carried
// greens, NFR-1 a constant statement count. The round-2 membership is the one
// the real load runner wrote the second time (`runRealLoad`, load 2), never a
// hand-typed key. Expected values are written out from the spec scenarios.
// Steps: assessors 12-20 Nov, programs 21-23 Nov, lead assessors 24-27 Nov 2026.

const CARRIED = ASSESSED[1]!; // green in round 1, uncommented, unchanged
const CHANGED = ASSESSED[2]!; // green in round 1, in changed_fields
const COMMENTED = ASSESSED[3]!; // grey in round 1, with a round-1 comment
const PLAIN = ASSESSED[4]!; // Assessed, not core
const CORE = [CARRIED, CHANGED, COMMENTED];
// An AI-eligible field (production list), core as well, for FR-6.
const AI_FIELD = 'general.gender_tag';

const lead = () => bearer('sub-lead');
const admin = () => bearer('sub-admin');

interface ThreadItem {
  commentId: number;
  author: { id: number; nickname: string | null };
  createdAt: string;
  body: string;
  valueCopy: { value: unknown };
  state: string;
  response?: {
    id: number;
    kind: string;
    body: string | null;
    respondedBy: { name: string };
    respondedAt: string;
  };
  clarifications: Array<{
    requestId: number;
    question: string;
    requestedAt: string;
    answer: { body: string; answeredAt: string } | null;
  }>;
  decision?: { decision: string; body: string | null };
  decidable: boolean;
  choices: string[];
}

interface ViewField {
  key: string;
  validated: boolean;
  effectiveValidated: boolean;
  carried: boolean;
  actionable: boolean;
  updated: boolean;
  thread: ThreadItem[];
}

const fieldsOf = (body: {
  data: { sections: Array<{ fields: ViewField[] }>; other: ViewField[] };
}): Record<string, ViewField> =>
  Object.fromEntries(
    [...body.data.sections.flatMap((s) => s.fields), ...body.data.other].map(
      (f) => [f.key, f],
    ),
  );

describe('Round-2 view of the Lead (e2e)', () => {
  let a: AssessmentApp;
  let resultCode: number;
  let roundOneAssessmentId: number;
  let roundTwoSnapKey: string;

  /** A round-1 comment of the step-1 assessment with the given state. */
  const comment = (
    id: number,
    over: Partial<(typeof a.world.comments)[number]> = {},
  ) =>
    plantRoundOneComment(a, roundOneAssessmentId, id, {
      fieldKey: COMMENTED,
      ...over,
    });

  const respond = (
    id: number,
    commentId: number,
    kind: 'request_clarification' | 'disagree' | 'accept',
    body: string | null,
    day: number,
  ) => plantProgramResponse(a, id, commentId, kind, body, day);

  const open = (code = resultCode, token = lead()) =>
    a.send('get', resultPath('', code), { token });

  beforeEach(async () => {
    a = await buildAssessmentApp(IN_LEAD_STEP);
    // Round 1: CARRIED and CHANGED were green; COMMENTED was grey with a comment.
    const built = await seedRoundTwoWorld(a, {
      core: [...CORE, AI_FIELD],
      changedFields: [CHANGED],
      roundOneGreens: [CARRIED, CHANGED],
    });
    resultCode = built.code;
    roundOneAssessmentId = built.roundOneId;
    roundTwoSnapKey = built.snapKey;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await a.app.close();
  });

  describe('the view in round 2 (design 6)', () => {
    it('answers `round: 2` and keeps the step-1 view members', async () => {
      const res = await open();
      expect(res.status).toBe(200);
      expect(res.body.data.round).toBe(2);
      expect(res.body.data.header).toMatchObject({ resultCode });
      expect(res.body.data.writable).toBe(true);
    });
  });

  describe('FR-3 actionable', () => {
    it('marks the Assessed core fields actionable and every other field not actionable', async () => {
      const fields = fieldsOf((await open()).body);
      expect(
        [CARRIED, CHANGED, COMMENTED, PLAIN].map((k) => fields[k]!.actionable),
      ).toEqual([true, true, true, false]);
      const notActionable = Object.values(fields)
        .filter((f) => ![...CORE, AI_FIELD].includes(f.key))
        .map((f) => f.actionable);
      expect(new Set(notActionable)).toEqual(new Set([false]));
    });
  });

  describe('FR-4 the round-1 thread', () => {
    it('Disagreement with a clarification: shows the comment with both values, the request and answer, the disagreement; decidable with both choices', async () => {
      comment(7001, { state: 'disagreed', authorId: a.users.policy.id });
      respond(3001, 7001, 'request_clarification', 'What do you mean?', 12);
      a.world.clarificationAnswers.push({
        id: 4001,
        commentId: 7001,
        responseId: 3001,
        authorId: a.users.policy.id,
        body: 'The field repeats the acronym.',
        createdAt: new Date('2026-11-13T09:00:00Z'),
      });
      respond(3002, 7001, 'disagree', 'The acronym is the official name.', 14);

      const res = await open();

      expect(res.status).toBe(200);
      const thread = fieldsOf(res.body)[COMMENTED]!.thread;
      expect(thread).toEqual([
        {
          commentId: 7001,
          author: { id: a.users.policy.id, nickname: expect.any(String) },
          createdAt: '2026-11-11T09:00:00.000Z',
          body: 'Round-1 comment 7001',
          valueCopy: { value: 'Value when 7001 was written' },
          valueTruncated: false,
          state: 'disagreed',
          response: {
            id: 3002,
            kind: 'disagree',
            body: 'The acronym is the official name.',
            respondedBy: { name: 'Pat Program' },
            respondedAt: '2026-11-14T09:00:00.000Z',
          },
          clarifications: [
            {
              requestId: 3001,
              question: 'What do you mean?',
              requestedAt: '2026-11-12T09:00:00.000Z',
              answer: {
                body: 'The field repeats the acronym.',
                answeredAt: '2026-11-13T09:00:00.000Z',
              },
            },
          ],
          decidable: true,
          choices: ['agree_program', 'escalate'],
        },
      ]);
    });

    it('shows the current value of the field next to the value copy', async () => {
      comment(7001, { state: 'disagreed', fieldKey: 'general.title' });
      const res = await open();
      const title = res.body.data.sections
        .flatMap(
          (s: { fields: Array<{ key: string; value: unknown }> }) => s.fields,
        )
        .find((f: { key: string }) => f.key === 'general.title');
      // The field value is the round-2 snapshot's, not the copy of round 1.
      expect(title.value).toBe('Re-submitted');
    });

    it('lists the Lead decision on a comment, and never the responder email', async () => {
      comment(7001, { state: 'disagreed' });
      respond(3002, 7001, 'disagree', 'We disagree.', 14);
      a.world.commentDecisions.push({
        commentId: 7001,
        roleCode: 'LEAD_ASSESSOR',
        decision: 'escalate',
        body: 'Needs the leads.',
        decidedAt: new Date('2026-11-25T08:00:00Z'),
      });
      // Another role decision on the same comment is not the Lead's.
      a.world.commentDecisions.push({
        commentId: 7001,
        roleCode: 'TPB',
        decision: 'tpb_agree_program',
        body: 'TPB text',
      });

      const res = await open();

      const thread = fieldsOf(res.body)[COMMENTED]!.thread;
      expect(thread).toHaveLength(1);
      const item = thread[0]!;
      expect(item.decision).toMatchObject({
        decision: 'escalate',
        body: 'Needs the leads.',
      });
      expect(JSON.stringify(res.body)).not.toContain('pat.program@example.org');
      expect(JSON.stringify(res.body)).not.toContain('TPB text');
    });

    it('BUT a withdrawn round-1 comment and a deleted one are not listed', async () => {
      comment(7001, { state: 'disagreed' });
      comment(7002, { state: 'withdrawn', body: 'Withdrawn text never shown' });
      comment(7003, {
        state: 'disagreed',
        body: 'Deleted text never shown',
        deletedAt: new Date('2026-11-24T10:00:00Z'),
      });
      respond(3010, 7002, 'disagree', 'Answer to a withdrawn one', 14);

      const res = await open();

      expect(fieldsOf(res.body)[COMMENTED]!.thread).toMatchObject([
        { commentId: 7001 },
      ]);
      expect(JSON.stringify(res.body)).not.toContain(
        'Withdrawn text never shown',
      );
      expect(JSON.stringify(res.body)).not.toContain(
        'Deleted text never shown',
      );
      expect(JSON.stringify(res.body)).not.toContain(
        'Answer to a withdrawn one',
      );
    });

    it('lists no thread on a non-core field, even with a round-1 comment on it', async () => {
      comment(7001, { fieldKey: PLAIN, state: 'disagreed' });
      const fields = fieldsOf((await open()).body);
      expect(fields[PLAIN]!.thread).toEqual([]);
    });

    it('a decided closed state (accepted) is listed but not decidable', async () => {
      comment(7001, { state: 'accepted' });
      respond(3001, 7001, 'accept', null, 12);
      const thread = fieldsOf((await open()).body)[COMMENTED]!.thread;
      expect(thread).toHaveLength(1);
      const item = thread[0]!;
      expect(item).toMatchObject({
        state: 'accepted',
        response: { kind: 'accept', body: null },
        decidable: false,
        choices: [],
      });
    });

    it('ADMIN reads the same thread, with the responder name, and decides nothing', async () => {
      comment(7001, { state: 'disagreed' });
      respond(3002, 7001, 'disagree', 'We disagree.', 14);

      const res = await open(resultCode, admin());

      expect(res.status).toBe(200);
      expect(res.body.data.round).toBe(2);
      const thread = fieldsOf(res.body)[COMMENTED]!.thread;
      expect(thread).toHaveLength(1);
      const item = thread[0]!;
      expect(item.response!.respondedBy).toEqual({ name: 'Pat Program' });
      expect(item).toMatchObject({ decidable: false, choices: [] });
      expect(JSON.stringify(res.body)).not.toContain('pat.program@example.org');
    });

    it('New round-2 result: a membership with no previous one has an empty thread on every core field', async () => {
      const fresh = await addTwoRounds(
        a,
        { resultId: 2002, previous: false },
        null,
      );

      const res = await open(fresh.code);

      expect(res.status).toBe(200);
      const fields = fieldsOf(res.body);
      expect(CORE.map((k) => fields[k]!.thread)).toEqual([[], [], []]);
    });
  });

  describe('FR-5 updated', () => {
    it('Changed field: changed_fields = [CHANGED] marks it and no other field', async () => {
      const fields = fieldsOf((await open()).body);
      const updated = Object.values(fields)
        .filter((f) => f.updated)
        .map((f) => f.key);
      expect(updated).toEqual([CHANGED]);
    });

    it('BUT on a new round-2 membership (changed_fields NULL) no field is updated', async () => {
      const fresh = await addTwoRounds(
        a,
        { resultId: 2002, previous: false },
        null,
      );
      const fields = fieldsOf((await open(fresh.code)).body);
      expect(Object.values(fields).filter((f) => f.updated)).toEqual([]);
    });
  });

  describe('FR-7 carried greens', () => {
    it('Carried green: green in round 1, uncommented, unchanged shows green before the Lead writes anything', async () => {
      comment(7001, { state: 'disagreed' }); // on COMMENTED only
      const fields = fieldsOf((await open()).body);
      expect(fields[CARRIED]).toMatchObject({
        validated: false,
        effectiveValidated: true,
        carried: true,
      });
    });

    it('BUT a field in changed_fields is not carried', async () => {
      const fields = fieldsOf((await open()).body);
      expect(fields[CHANGED]).toMatchObject({
        effectiveValidated: false,
        carried: false,
      });
    });

    it('a field with a round-1 comment is not carried', async () => {
      a.world.validations.push({
        assessmentId: roundOneAssessmentId,
        fieldKey: COMMENTED,
        validated: true,
      });
      comment(7001, { state: 'disagreed' });
      const fields = fieldsOf((await open()).body);
      expect(fields[COMMENTED]).toMatchObject({
        effectiveValidated: false,
        carried: false,
      });
    });

    it('a new round-2 membership carries nothing', async () => {
      const fresh = await addTwoRounds(
        a,
        { resultId: 2002, previous: false },
        null,
      );
      const fields = fieldsOf((await open(fresh.code)).body);
      expect(
        CORE.map((k) => [fields[k]!.effectiveValidated, fields[k]!.carried]),
      ).toEqual([
        [false, false],
        [false, false],
        [false, false],
      ]);
    });
  });

  describe('NFR-1 a constant number of statements', () => {
    /** Round-1 comments on the two core fields, each with a clarification, its answer, a disagreement and a decision. */
    function plant(count: number, from: number) {
      for (let i = 0; i < count; i++) {
        const id = from + i;
        comment(id, {
          state: 'disagreed',
          fieldKey: i % 2 === 0 ? COMMENTED : CHANGED,
          createdAt: new Date(
            `2026-11-05T09:${String(i).padStart(2, '0')}:00Z`,
          ),
        });
        respond(10_000 + id * 3, id, 'request_clarification', 'Which?', 12);
        a.world.clarificationAnswers.push({
          id: 20_000 + id,
          commentId: id,
          responseId: 10_000 + id * 3,
          authorId: a.users.policy.id,
          body: 'This one.',
          createdAt: new Date('2026-11-13T09:00:00Z'),
        });
        respond(10_000 + id * 3 + 1, id, 'disagree', 'No.', 14);
        a.world.commentDecisions.push({
          commentId: id,
          roleCode: 'LEAD_ASSESSOR',
          decision: 'escalate',
          body: 'Up.',
        });
      }
    }

    /** Every store call the GET makes, counted on the in-memory port of the whole request. */
    async function statementsOfOpen() {
      a.world.resetStatements();
      const thread = vi.spyOn(
        InMemoryAssessmentStore.prototype,
        'findRoundOneThread',
      );
      const res = await open();
      expect(res.status).toBe(200);
      const calls = thread.mock.calls.length;
      thread.mockRestore();
      return { statements: a.world.statements, threadCalls: calls, res };
    }

    it('counts the same statements for 1 round-1 comment and for 30, with the thread read once', async () => {
      plant(1, 7100);
      const one = await statementsOfOpen();
      expect(
        Object.values(fieldsOf(one.res.body)).flatMap((f) => f.thread),
      ).toHaveLength(1);

      plant(29, 7200);
      const many = await statementsOfOpen();
      expect(
        Object.values(fieldsOf(many.res.body)).flatMap((f) => f.thread),
      ).toHaveLength(30);

      expect(many.statements).toBe(one.statements);
      expect(one.threadCalls).toBe(1);
      expect(many.threadCalls).toBe(1);
      // timelines, load probe, membership (with the previous assessment's id),
      // the pinned version's items for the membership with no row yet (five of
      // `effectiveFor`), then the thread and the round-1 validations: 10.
      expect(many.statements).toBe(10);
    });
  });

  describe('FR-6 AI suggestions for the Lead', () => {
    it('answers 200 with the suggestion views of a core field, without the copied/edited mark', async () => {
      await a.aiDynamo.client.send(
        new PutItemCommand({
          TableName: 'cgiar-qa-test',
          Item: toAttributeMap({
            __edb_e__: 'aiSuggestion',
            __edb_v__: '1',
            pk: `RESULT#${resultCode}`,
            sk: `AI#${roundTwoSnapKey}#${AI_FIELD}#v2-1.0.0`,
            resultCode,
            snapKey: roundTwoSnapKey,
            promptVersion: 'v2-1.0.0',
            runId: 'load-1',
            createdAt: '2026-11-20T12:00:00Z',
            fieldKey: AI_FIELD,
            suggestionId: (1).toString(16).padStart(32, '0'),
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
        `/timelines/1/results/${resultCode}/ai-suggestions`,
        { token: lead() },
      );

      expect(res.status).toBe(200);
      for (const view of res.body.data)
        assertAiSchema('ai-suggestion-view', view);
      const views = res.body.data as Array<Record<string, unknown>>;
      const entry = views.find((v) => v.fieldKey === AI_FIELD)!;
      expect(entry.status).toBe('available');
      expect(views.some((v) => 'copied' in v || 'edited' in v)).toBe(false);
    });
  });

  describe('OpenAPI', () => {
    it('documents the additive view members and the thread item, with no email in the response model', () => {
      const document: OpenAPIObject = buildOpenApiDocument(a.app);
      const schemas = (document.components?.schemas ?? {}) as Record<
        string,
        { required?: string[]; properties?: Record<string, unknown> }
      >;
      expect(schemas['AssessmentViewModel']!.required).toContain('round');
      expect(schemas['AssessmentFieldModel']!.required).toEqual(
        expect.arrayContaining([
          'updated',
          'actionable',
          'effectiveValidated',
          'carried',
          'thread',
        ]),
      );
      const item = schemas['AssessmentThreadItemModel']!;
      expect(Object.keys(item.properties!).sort()).toEqual(
        [
          'author',
          'body',
          'choices',
          'clarifications',
          'commentId',
          'createdAt',
          'decidable',
          'decision',
          'response',
          'state',
          'valueCopy',
          'valueTruncated',
        ].sort(),
      );
      expect(Object.keys(schemas['SpResponderModel']!.properties!)).toEqual([
        'name',
      ]);
    });
  });

  describe('round 1 is unchanged (additive members only)', () => {
    it('an ASSESSOR reads `round: 1`, no thread, nothing updated or carried, effectiveValidated = validated, Assessed = actionable', async () => {
      const real = await runRealLoad(
        [{ resultId: 3003, values: { 'general.title': 'Plain round 1' } }],
        { loadId: 99 },
      );
      const written = real.memberships[0]!;
      for (const snapshot of await real.snapshots.history(written.resultCode)) {
        await a.snapshots.put(snapshot);
      }
      a.world.memberships.push({
        id: 600,
        timelineId: 1,
        resultCode: written.resultCode,
        title: 'Plain round 1',
        programId: 1,
        resultTypeKey: 'policy_change',
        snapshotSk: written.snapshotSk,
      });
      a.world.assessments.push({
        id: 600,
        membershipId: 600,
        stepPosition: 1,
        status: 'pending',
      });
      a.world.validations.push({
        assessmentId: 600,
        fieldKey: PLAIN,
        validated: true,
      });
      a.setClock(new Date('2026-11-13T10:00:00Z'));

      const res = await a.send('get', resultPath('', written.resultCode), {
        token: bearer('sub-policy'),
      });

      expect(res.status).toBe(200);
      expect(res.body.data.round).toBe(1);
      const fields = fieldsOf(res.body);
      expect(fields[PLAIN]).toMatchObject({
        validated: true,
        effectiveValidated: true,
        actionable: true,
        updated: false,
        carried: false,
        thread: [],
      });
      expect(
        Object.values(fields).filter(
          (f) => f.updated || f.carried || f.thread.length > 0,
        ),
      ).toEqual([]);
    });
  });
});
