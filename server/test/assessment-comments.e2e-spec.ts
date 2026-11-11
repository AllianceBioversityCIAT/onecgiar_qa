// @akili-spec assessment/step-1-assessment
import { readFileSync } from 'node:fs';
import type request from 'supertest';
import {
  applicableFields,
  shapeCatalog,
} from '../src/admin-config/field-config/field-config-catalog.js';
import type { ConfigItem } from '../src/admin-config/field-config/field-config-diff.js';
import type { RomeMinute } from '../src/admin-config/rome-date.js';
import type { FeedLabels } from '../src/ingestion/results-feed.port.js';
import {
  bearer,
  buildAssessmentApp,
  withoutRequestMeta,
  type AssessmentApp,
} from './support/assessment-app.js';
import { runRealLoad } from './support/real-load-writer.js';

// POST …/assessment/comments and POST /assessment-comments/:id/withdraw over
// real HTTP (design 6; FR-2, FR-11, FR-13, FR-16, FR-19, FR-21, NFR-7, P-17).
// Guards, pipe, envelope, the idempotency interceptor and OpenAPI are the real
// ones; the stores, the unit of work, the catalog and the clock are fakes. The
// snapshots are written by the real LoadRunner.

const catalog = shapeCatalog(
  JSON.parse(
    readFileSync(
      new URL(
        '../src/admin-config/field-config/fixtures/reporting-qa-catalog-2026.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ),
);
const applicable = applicableFields(catalog, 'policy_change').map((f) => f.key);
const TITLE = 'general.title';
const PROGRAM = 'general.primary_program';
const OTHER = applicable.find((k) => ![TITLE, PROGRAM].includes(k))!;
const VIEW_ONLY = 'general.description';

const createPath = (code: number | string = 5001, timelineId: number | string = 1) =>
  `/timelines/${timelineId}/results/${code}/assessment/comments`;
const withdrawPath = (id: number | string) =>
  `/assessment-comments/${id}/withdraw`;
const policy = () => bearer('sub-policy');
const policy2 = () => bearer('sub-policy2');
const minute = (value: string) => value as RomeMinute;

const STEPS = [
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
    opensAt: minute('2026-11-23T09:00'),
    closesAt: minute('2026-11-27T17:30'),
  },
  {
    position: 3,
    name: 'Step 3',
    audience: 'lead_assessors' as const,
    opensAt: minute('2026-12-01T00:00'),
    closesAt: minute('2026-12-05T23:59'),
  },
];
const IN_STEP_1 = new Date('2026-11-13T10:00:00Z');

function expectError(res: request.Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(res.body).toMatchObject({
    success: false,
    error: { status, code },
    meta: { requestId: res.headers['x-request-id'] },
  });
  // A refusal tells nothing of the people involved.
  expect(JSON.stringify(res.body)).not.toMatch(/@/);
}

/** Everything of an answer that does not depend on the request: status and body without the per-request meta. */
const shape = (res: request.Response) => ({
  status: res.status,
  body: withoutRequestMeta(res.body),
});

describe('assessment comments (e2e)', () => {
  let a: AssessmentApp;

  async function start(at: Date = IN_STEP_1) {
    a = await buildAssessmentApp(at);
    a.world.timelines.push(
      { id: 1, name: 'Official', kind: 'official', steps: STEPS },
      { id: 2, name: 'Other', kind: 'additional', steps: STEPS },
    );
    for (const user of [a.users.policy, a.users.policy2]) {
      a.world.timelineUsers.push({
        timelineId: 1,
        userId: user.id,
        roleCode: 'ASSESSOR',
      });
    }
    a.world.users.push(
      { id: a.users.policy.id, nickname: 'Pia' },
      { id: a.users.policy2.id, nickname: 'Pablo' },
      { id: a.users.admin.id, nickname: 'Ada' },
    );
    const items: ConfigItem[] = applicable.map((fieldKey) => ({
      resultTypeKey: 'policy_change',
      fieldKey,
      visibility: [TITLE, PROGRAM, OTHER].includes(fieldKey)
        ? 'assessed'
        : fieldKey === VIEW_ONLY
          ? 'view_only'
          : 'hidden',
      isCore: false,
      isAiInput: false,
    }));
    a.world.fieldConfigItems['policy_change'] = items;
    a.world.versionItems[1] = { policy_change: items };
  }

  /** A membership whose snapshot the real runner wrote; its key and snapshot are copied into the app. */
  let nextMembership = 1;
  async function seed(
    values: Record<string, unknown>,
    options: { loadId?: number; round?: number; labels?: FeedLabels } = {},
  ) {
    const real = await runRealLoad(
      [
        {
          resultId: 1001,
          values,
          ...(options.labels === undefined ? {} : { labels: options.labels }),
        },
      ],
      { loadId: options.loadId ?? 1 },
    );
    const written = real.memberships[0]!;
    for (const snapshot of await real.snapshots.history(written.resultCode)) {
      await a.snapshots.put(snapshot);
    }
    a.world.memberships.push({
      id: nextMembership++,
      timelineId: 1,
      resultCode: written.resultCode,
      title: null,
      programId: 1,
      resultTypeKey: 'policy_change',
      round: options.round ?? 1,
      snapshotSk: written.snapshotSk,
    });
  }

  afterEach(async () => {
    await a.app.close();
  });

  describe('authentication and the body', () => {
    beforeEach(async () => {
      await start();
      await seed({ [TITLE]: 'T' });
    });

    it('401 without a token, on both routes', async () => {
      expectError(
        await a.send('post', createPath(), {
          token: null,
          body: { fieldKey: TITLE, body: 'x' },
        }),
        401,
        'AUTH_TOKEN_INVALID',
      );
      expectError(
        await a.send('post', withdrawPath(7000), { token: null }),
        401,
        'AUTH_TOKEN_INVALID',
      );
    });

    it.each([
      ['a result code that is not a number', createPath('abc'), { fieldKey: TITLE, body: 'x' }],
      ['a missing fieldKey', createPath(), { body: 'x' }],
      ['a fieldKey that is not a string', createPath(), { fieldKey: 1, body: 'x' }],
      ['a fieldKey over 200 characters', createPath(), { fieldKey: 'k'.repeat(201), body: 'x' }],
      ['a missing body', createPath(), { fieldKey: TITLE }],
      ['a body that is not a string', createPath(), { fieldKey: TITLE, body: 5 }],
      ['an empty body', createPath(), { fieldKey: TITLE, body: '' }],
      ['a body of spaces only (trimmed to nothing)', createPath(), { fieldKey: TITLE, body: '   \n  ' }],
      ['a body over 2,000 characters', createPath(), { fieldKey: TITLE, body: 'a'.repeat(2001) }],
      ['2,001 characters made of emoji (counted as characters, not as UTF-16 units)', createPath(), { fieldKey: TITLE, body: '😀'.repeat(2001) }],
      ['an unknown body field', createPath(), { fieldKey: TITLE, body: 'x', extra: 1 }],
    ])('400 VALIDATION_FAILED for %s', async (_label, url, body) => {
      const res = await a.send('post', url, { token: policy(), body });
      expectError(res, 400, 'VALIDATION_FAILED');
      expect(a.world.comments).toEqual([]);
      expect(a.world.audits).toEqual([]);
    });

    it('names the property that failed: body for a bad body, fieldKey for a bad key', async () => {
      const badBody = await a.send('post', createPath(), {
        token: policy(),
        body: { fieldKey: TITLE, body: '  ' },
      });
      expect(badBody.body.error.fields).toEqual([
        { field: 'body', code: 'REQUIRED', message: 'This field is required.' },
      ]);
      const tooLong = await a.send('post', createPath(), {
        token: policy(),
        body: { fieldKey: TITLE, body: 'a'.repeat(2001) },
      });
      expect(tooLong.body.error.fields).toMatchObject([
        { field: 'body', code: 'TOO_LONG' },
      ]);
    });

    it.each([
      ['1 character', 'a'],
      ['2,000 characters', 'a'.repeat(2000)],
      ['2,000 emoji (4,000 UTF-16 units)', '😀'.repeat(2000)],
    ])('201 for a body of %s', async (_label, body) => {
      const res = await a.send('post', createPath(), {
        token: policy(),
        body: { fieldKey: TITLE, body },
      });
      expect(res.status).toBe(201);
      expect(res.body.data.body).toBe(body);
    });

    it('stores the body trimmed', async () => {
      const res = await a.send('post', createPath(), {
        token: policy(),
        body: { fieldKey: TITLE, body: '  Needs a source\n' },
      });
      expect(res.status).toBe(201);
      expect(res.body.data.body).toBe('Needs a source');
      expect(a.world.comments[0]!.body).toBe('Needs a source');
    });

    it.each([
      ['a comment id that is not a number', withdrawPath('abc')],
      ['a zero comment id', withdrawPath(0)],
    ])('400 VALIDATION_FAILED for %s', async (_label, url) => {
      expectError(
        await a.send('post', url, { token: policy() }),
        400,
        'VALIDATION_FAILED',
      );
    });
  });

  describe('FR-11: create', () => {
    beforeEach(async () => {
      await start();
    });

    it('Value at the time of writing: round 1 says "Old title" after a round-2 membership with "New title" exists', async () => {
      await seed({ [TITLE]: 'Old title' }, { loadId: 1, round: 1 });
      await seed({ [TITLE]: 'New title' }, { loadId: 2, round: 2 });
      // The fixture: two memberships of one result, two snapshot keys, two titles.
      expect(a.world.memberships.map((m) => m.resultCode)).toEqual([5001, 5001]);
      expect(a.world.memberships[0]!.snapshotSk).not.toBe(
        a.world.memberships[1]!.snapshotSk,
      );

      const res = await a.send('post', createPath(), {
        token: policy(),
        body: { fieldKey: TITLE, body: 'Check the wording' },
      });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        success: true,
        meta: { requestId: res.headers['x-request-id'] },
        data: {
          fieldKey: TITLE,
          author: { id: a.users.policy.id, nickname: 'Pia' },
          body: 'Check the wording',
          state: 'open',
          stepPosition: 1,
          round: 1,
          valueCopy: { value: 'Old title' },
          valueTruncated: false,
          createdAt: '2026-11-13T10:00:00.000Z',
          withdrawnAt: null,
        },
      });
      expect(JSON.stringify(res.body)).not.toMatch(/@/);
      expect(a.world.comments[0]!.valueCopy).toEqual({ value: 'Old title' });
    });

    it('keeps the labels the snapshot had, for the field list only', async () => {
      await seed(
        { [PROGRAM]: 3 },
        { labels: { initiatives: { '3': 'SP03 Apple' }, centers: { '1': 'X' } } },
      );
      const res = await a.send('post', createPath(), {
        token: policy(),
        body: { fieldKey: PROGRAM, body: 'Is this right?' },
      });
      expect(res.status).toBe(201);
      expect(res.body.data.valueCopy).toEqual({
        value: 3,
        labels: { initiatives: { '3': 'SP03 Apple' } },
      });
    });

    it('NFR-7: a value over 64 KiB is stored cut, with value_truncated', async () => {
      await seed({ [TITLE]: 'x'.repeat(200_000) });
      const res = await a.send('post', createPath(), {
        token: policy(),
        body: { fieldKey: TITLE, body: 'Far too long' },
      });
      expect(res.status).toBe(201);
      expect(res.body.data.valueTruncated).toBe(true);
      expect(
        Buffer.byteLength(JSON.stringify(res.body.data.valueCopy)),
      ).toBeLessThanOrEqual(65_536);
    });

    it('400 VALIDATION_FAILED on fieldKey for a View only field, a Hidden one and an unknown one', async () => {
      await seed({ [TITLE]: 'T' });
      for (const key of [VIEW_ONLY, applicable[applicable.length - 1]!, 'no.such_field']) {
        const res = await a.send('post', createPath(), {
          token: policy(),
          body: { fieldKey: key, body: 'x' },
        });
        expectError(res, 400, 'VALIDATION_FAILED');
        expect(res.body.error.fields).toEqual([
          {
            field: 'fieldKey',
            code: 'INVALID',
            message: 'This value is not valid.',
          },
        ]);
      }
      expect(a.world.comments).toEqual([]);
    });

    it('FR-21: one comment_add audit row and one comment event, with no body and no value', async () => {
      await seed({ [TITLE]: 'Secret value' });
      const res = await a.send('post', createPath(), {
        token: policy(),
        body: { fieldKey: TITLE, body: 'Secret body' },
      });
      expect(a.world.audits).toEqual([
        {
          assessmentId: 1000,
          actorId: a.users.policy.id,
          action: 'comment_add',
          fieldKeys: [TITLE],
          commentId: res.body.data.id,
          requestId: res.headers['x-request-id'],
          at: IN_STEP_1,
        },
      ]);
      expect(a.world.commentEvents).toMatchObject([
        { commentId: res.body.data.id, fromState: null, toState: 'open' },
      ]);
      expect(JSON.stringify([a.world.audits, a.world.commentEvents])).not.toContain(
        'Secret',
      );
    });

    it('the comment shows in the assessment view, and a withdrawn one shows its state', async () => {
      await seed({ [TITLE]: 'T' });
      const created = await a.send('post', createPath(), {
        token: policy(),
        body: { fieldKey: TITLE, body: 'Hello' },
      });
      const view = (await a.send('get', '/timelines/1/results/5001/assessment', {
        token: policy(),
      })) as request.Response;
      const comments = (key: request.Response) =>
        key.body.data.sections
          .flatMap((s: { fields: Array<{ key: string; comments: unknown[] }> }) => s.fields)
          .find((f: { key: string }) => f.key === TITLE).comments;
      expect(comments(view)).toMatchObject([
        { id: created.body.data.id, body: 'Hello', state: 'open' },
      ]);

      await a.send('post', withdrawPath(created.body.data.id), { token: policy() });
      const after = await a.send('get', '/timelines/1/results/5001/assessment', {
        token: policy(),
      });
      expect(comments(after)).toMatchObject([
        { id: created.body.data.id, state: 'withdrawn' },
      ]);
    });
  });

  describe('FR-2, FR-16, FR-1: the window, the end, and who may write', () => {
    it.each([
      ['08:59 Rome', '2026-11-12T07:59:00Z', 409],
      ['09:00 Rome', '2026-11-12T08:00:00Z', 201],
      ['17:30 Rome', '2026-11-20T16:30:00Z', 201],
      ['17:31 Rome', '2026-11-20T16:31:00Z', 409],
    ])('at %s the create answers %i', async (_label, instant, status) => {
      await start(new Date(instant));
      await seed({ [TITLE]: 'T' });
      const res = await a.send('post', createPath(), {
        token: policy(),
        body: { fieldKey: TITLE, body: 'x' },
      });
      if (status === 409) {
        expectError(res, 409, 'ASSESSMENT_STEP_CLOSED');
        expect(a.world.comments).toEqual([]);
        expect(a.world.audits).toEqual([]);
      } else {
        expect(res.status).toBe(201);
        expect(a.world.comments).toHaveLength(1);
      }
    });

    it('409 ASSESSMENT_FINISHED once the assessment ended', async () => {
      await start();
      await seed({ [TITLE]: 'T' });
      a.world.assessments.push({
        id: 7,
        membershipId: a.world.memberships[0]!.id,
        stepPosition: 1,
        status: 'returned',
      });
      expectError(
        await a.send('post', createPath(), {
          token: policy(),
          body: { fieldKey: TITLE, body: 'x' },
        }),
        409,
        'ASSESSMENT_FINISHED',
      );
      expect(a.world.comments).toEqual([]);
    });

    it('403 ASSESSMENT_READ_ONLY for an ADMIN with no reviewer row', async () => {
      await start();
      await seed({ [TITLE]: 'T' });
      expectError(
        await a.send('post', createPath(), {
          token: bearer('sub-admin'),
          body: { fieldKey: TITLE, body: 'x' },
        }),
        403,
        'ASSESSMENT_READ_ONLY',
      );
      expect(a.world.comments).toEqual([]);
    });

    it('the same bytes for a code that does not exist, a result outside the scope, another timeline and a caller with no row; no address in any of them', async () => {
      await start();
      await seed({ [TITLE]: 'T' });
      await a.programScope(a.users.policy.id, [2]); // the membership is program 1
      const body = { fieldKey: TITLE, body: 'x' };
      const outOfScope = await a.send('post', createPath(5001), { token: policy(), body });
      const missing = await a.send('post', createPath(9999), { token: policy(), body });
      const otherTimeline = await a.send('post', createPath(5001, 2), { token: policy(), body });
      const noRow = await a.send('post', createPath(5001), { token: bearer('sub-other'), body });

      expectError(outOfScope, 404, 'ASSESSMENT_NOT_FOUND');
      expect(shape(missing)).toEqual(shape(outOfScope));
      expect(shape(otherTimeline)).toEqual(shape(outOfScope));
      expect(shape(noRow)).toEqual(shape(outOfScope));
      for (const res of [outOfScope, missing, otherTimeline, noRow]) {
        expect(JSON.stringify(res.body)).not.toMatch(/@/);
      }
      expect(a.world.comments).toEqual([]);
    });

    it('a finished assessment seen from outside the scope is the same 404 as a missing code', async () => {
      await start();
      await seed({ [TITLE]: 'T' });
      a.world.assessments.push({
        id: 7,
        membershipId: a.world.memberships[0]!.id,
        stepPosition: 1,
        status: 'quality_assessed',
      });
      await a.programScope(a.users.policy.id, [2]);
      const body = { fieldKey: TITLE, body: 'x' };
      const finished = await a.send('post', createPath(5001), { token: policy(), body });
      const missing = await a.send('post', createPath(9999), { token: policy(), body });
      expectError(finished, 404, 'ASSESSMENT_NOT_FOUND');
      expect(shape(finished)).toEqual(shape(missing));
    });
  });

  describe('P-17: idempotent create', () => {
    beforeEach(async () => {
      await start();
      await seed({ [TITLE]: 'T' });
    });
    const body = { fieldKey: TITLE, body: 'Once only' };

    it('the same key twice returns the first comment and writes nothing the second time', async () => {
      const first = await a.send('post', createPath(), {
        token: policy(),
        key: 'key-1',
        body,
      });
      const second = await a.send('post', createPath(), {
        token: policy(),
        key: 'key-1',
        body,
      });
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.headers['idempotency-replayed']).toBe('true');
      expect(second.body.data).toEqual(first.body.data);
      expect(a.world.comments).toHaveLength(1);
      expect(a.world.audits).toHaveLength(1);
      expect(a.world.commentEvents).toHaveLength(1);
      expect(a.world.marks).toEqual([
        { key: 'key-1', targetId: first.body.data.id },
      ]);
    });

    it('the same key with another body is 422 IDEMPOTENCY_KEY_REUSED and writes nothing', async () => {
      await a.send('post', createPath(), { token: policy(), key: 'key-2', body });
      const res = await a.send('post', createPath(), {
        token: policy(),
        key: 'key-2',
        body: { fieldKey: TITLE, body: 'Another' },
      });
      expectError(res, 422, 'IDEMPOTENCY_KEY_REUSED');
      expect(a.world.comments).toHaveLength(1);
    });

    it('the crash window: the answer was never stored, and a retry gets the same comment, re-read, with one row', async () => {
      const crash = vi
        .spyOn(a.idempotency, 'complete')
        .mockRejectedValueOnce(new Error('the process died after the commit'));
      const first = await a.send('post', createPath(), {
        token: policy(),
        key: 'key-3',
        body,
      });
      crash.mockRestore();
      expect(first.status).toBe(201);
      // The key is `executed` with no answer: only the mark inside the transaction put it there.
      expect(a.idempotency.peek(a.users.policy.id, 'key-3')).toMatchObject({
        state: 'executed',
        targetUserId: first.body.data.id,
      });

      const retry = await a.send('post', createPath(), {
        token: policy(),
        key: 'key-3',
        body,
      });

      expect(retry.status).toBe(201);
      expect(retry.headers['idempotency-replayed']).toBe('true');
      expect(retry.body.data).toEqual(first.body.data);
      expect(a.world.comments).toHaveLength(1);
      expect(a.world.audits).toHaveLength(1);
    });

    it('a create without a key is not remembered: two sends are two comments', async () => {
      await a.send('post', createPath(), { token: policy(), body });
      await a.send('post', createPath(), { token: policy(), body });
      expect(a.world.comments).toHaveLength(2);
      expect(a.world.marks).toEqual([]);
    });
  });

  describe('FR-13: withdraw', () => {
    async function withComment(at: Date = IN_STEP_1) {
      await start(at);
      await seed({ [TITLE]: 'T' });
      a.world.assessments.push({
        id: 70,
        membershipId: a.world.memberships[0]!.id,
        stepPosition: 1,
        status: 'pending',
      });
      a.world.comments.push({
        id: 700,
        assessmentId: 70,
        authorId: a.users.policy.id,
        state: 'open',
        fieldKey: TITLE,
        body: 'Secret body',
        createdAt: new Date('2026-11-13T09:00:00.000Z'),
        valueCopy: { value: 'T' },
      });
    }

    it('the author withdraws: 200 with the withdrawn comment, one event, one audit row', async () => {
      await withComment();
      const res = await a.send('post', withdrawPath(700), { token: policy() });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        success: true,
        meta: { requestId: res.headers['x-request-id'] },
        data: {
          id: 700,
          state: 'withdrawn',
          author: { id: a.users.policy.id, nickname: 'Pia' },
          withdrawnAt: '2026-11-13T10:00:00.000Z',
        },
      });
      expect(JSON.stringify(res.body)).not.toMatch(/@/);
      expect(a.world.commentEvents).toMatchObject([
        { commentId: 700, fromState: 'open', toState: 'withdrawn' },
      ]);
      expect(a.world.audits).toMatchObject([
        {
          action: 'comment_withdraw',
          commentId: 700,
          fieldKeys: [TITLE],
          requestId: res.headers['x-request-id'],
        },
      ]);
      expect(JSON.stringify(a.world.audits)).not.toContain('Secret');
    });

    it('Not someone else comment: 403 for B, then A withdraws, and a second withdraw is 409', async () => {
      await withComment();
      const other = await a.send('post', withdrawPath(700), { token: policy2() });
      expectError(other, 403, 'ASSESSMENT_NOT_COMMENT_AUTHOR');
      expect(a.world.comments[0]!.state).toBe('open');

      expect((await a.send('post', withdrawPath(700), { token: policy() })).status).toBe(200);
      const again = await a.send('post', withdrawPath(700), { token: policy() });
      expectError(again, 409, 'ASSESSMENT_COMMENT_NOT_OPEN');
      expect(a.world.commentEvents).toHaveLength(1);
      expect(a.world.audits).toHaveLength(1);
    });

    it('403 for an ADMIN who did not write it', async () => {
      await withComment();
      expectError(
        await a.send('post', withdrawPath(700), { token: bearer('sub-admin') }),
        403,
        'ASSESSMENT_NOT_COMMENT_AUTHOR',
      );
    });

    it('the same bytes for a comment that does not exist and one outside the caller scope; no address', async () => {
      await withComment();
      const noRow = await a.send('post', withdrawPath(700), { token: bearer('sub-other') });
      await a.programScope(a.users.policy.id, [2]);
      const outOfScope = await a.send('post', withdrawPath(700), { token: policy() });
      const missing = await a.send('post', withdrawPath(424242), { token: policy() });
      expectError(missing, 404, 'ASSESSMENT_NOT_FOUND');
      expect(shape(outOfScope)).toEqual(shape(missing));
      expect(shape(noRow)).toEqual(shape(missing));
      for (const res of [missing, outOfScope, noRow]) {
        expect(JSON.stringify(res.body)).not.toMatch(/@/);
      }
      expect(a.world.comments[0]!.state).toBe('open');
    });

    it.each([
      ['step 1 is open', '2026-11-13T10:00:00Z', 200],
      ['step 2 is open', '2026-11-24T10:00:00Z', 200],
      ['between the steps', '2026-11-21T10:00:00Z', 409],
      ['after every step', '2026-12-20T10:00:00Z', 409],
    ])('OQ-8: while %s the withdraw answers %i', async (_label, instant, status) => {
      await withComment(new Date(instant));
      const res = await a.send('post', withdrawPath(700), { token: policy() });
      if (status === 409) {
        expectError(res, 409, 'ASSESSMENT_STEP_CLOSED');
        expect(a.world.comments[0]!.state).toBe('open');
      } else {
        expect(res.status).toBe(200);
      }
    });

    it.each(['accepted', 'disagreed', 'clarification_requested'] as const)(
      'OQ-8: 409 ASSESSMENT_COMMENT_NOT_OPEN once the program answered (%s)',
      async (state) => {
        await withComment();
        a.world.comments[0]!.state = state;
        expectError(
          await a.send('post', withdrawPath(700), { token: policy() }),
          409,
          'ASSESSMENT_COMMENT_NOT_OPEN',
        );
        expect(a.world.comments[0]!.state).toBe(state);
      },
    );

    it('a withdraw after the end is allowed and the assessment stays ended', async () => {
      await withComment();
      a.world.assessments[0]!.status = 'quality_assessed';
      const res = await a.send('post', withdrawPath(700), { token: policy() });
      expect(res.status).toBe(200);
      expect(a.world.assessments[0]!.status).toBe('quality_assessed');
    });
  });
});
