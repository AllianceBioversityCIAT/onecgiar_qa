// @akili-spec assessment/step-1-assessment
import { readFileSync } from 'node:fs';
import type request from 'supertest';
import {
  applicableFields,
  shapeCatalog,
} from '../src/admin-config/field-config/field-config-catalog.js';
import type { ConfigItem } from '../src/admin-config/field-config/field-config-diff.js';
import type { RomeMinute } from '../src/admin-config/rome-date.js';
import {
  bearer,
  buildAssessmentApp,
  withoutRequestMeta,
  type AssessmentApp,
} from './support/assessment-app.js';
import { defaultFakeSteps } from './support/in-memory-assessment.js';

// The ends over real HTTP (T-11; design 6; FR-14 to FR-17, FR-21):
// `PUT …/assessment/validations` ending the assessment by itself, and
// `POST …/assessment/finish`. Guards, pipe, filter, envelope and OpenAPI are
// the real ones; the stores, the unit of work, the catalog and the clock are
// fakes.

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
const ASSESSED = applicable.slice(0, 12);
const VIEW_ONLY = applicable.slice(12, 17);
const CORE = ASSESSED.slice(0, 3);
const NON_CORE = ASSESSED[3]!;

const base = (code: number | string = 5001, timelineId: number | string = 1) =>
  `/timelines/${timelineId}/results/${code}/assessment`;
const validationsPath = (code: number | string = 5001) =>
  `${base(code)}/validations`;
const finishPath = (code: number | string = 5001) => `${base(code)}/finish`;
const policy = () => bearer('sub-policy');
const minute = (value: string) => value as RomeMinute;

function expectError(res: request.Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(res.body).toMatchObject({
    success: false,
    error: { status, code },
    meta: { requestId: res.headers['x-request-id'] },
  });
  expect(JSON.stringify(res.body)).not.toMatch(/@/);
}

const window = () => [
  {
    position: 1,
    name: 'Step 1',
    audience: 'assessors' as const,
    opensAt: minute('2026-11-12T09:00'),
    closesAt: minute('2026-11-20T17:30'),
  },
  ...defaultFakeSteps().slice(1),
];

describe('the ends of an assessment (e2e)', () => {
  let a: AssessmentApp;

  async function start(core: readonly string[] = CORE) {
    a = await buildAssessmentApp(new Date('2026-11-13T10:00:00Z'));
    a.world.timelines.push({
      id: 1,
      name: 'Official',
      kind: 'official',
      steps: window(),
    });
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
    );
    const items: ConfigItem[] = applicable.map((fieldKey) => ({
      resultTypeKey: 'policy_change',
      fieldKey,
      visibility: ASSESSED.includes(fieldKey)
        ? 'assessed'
        : VIEW_ONLY.includes(fieldKey)
          ? 'view_only'
          : 'hidden',
      isCore: core.includes(fieldKey),
      isAiInput: false,
    }));
    a.world.fieldConfigItems['policy_change'] = items;
    a.world.versionItems[1] = { policy_change: items };
    a.world.memberships.push({
      id: 1,
      timelineId: 1,
      resultCode: 5001,
      title: 'A title',
      programId: 1,
      resultTypeKey: 'policy_change',
      resultId: 777,
    });
  }

  afterEach(async () => {
    await a.app.close();
  });

  describe('FR-14: the validation that turns the last core field green', () => {
    beforeEach(async () => {
      await start();
    });

    it('ends quality_assessed in the answer, with Assessed by the caller, and queues one qaed release', async () => {
      await a.send('put', validationsPath(), {
        token: policy(),
        body: { validated: true, fieldKeys: [CORE[0], CORE[1]] },
      });
      const res = await a.send('put', validationsPath(), {
        token: policy(),
        body: { validated: true, fieldKeys: [CORE[2]] },
      });

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        status: 'quality_assessed',
        assessedBy: { id: a.users.policy.id, nickname: 'Pia' },
        finishedAt: '2026-11-13T10:00:00.000Z',
      });
      expect(JSON.stringify(res.body)).not.toMatch(/@/);
      expect(a.world.releases).toHaveLength(1);
      expect(a.world.releases[0]).toMatchObject({
        outcome: 'qaed',
        resultId: 777,
      });
      expect(a.world.audits.map((x) => x.action)).toEqual([
        'validate',
        'validate',
        'end_quality_assessed',
      ]);
    });

    it('a later validation, comment or finish answers 409 ASSESSMENT_FINISHED', async () => {
      await a.send('put', validationsPath(), {
        token: policy(),
        body: { validated: true, fieldKeys: [...CORE] },
      });
      const validate = await a.send('put', validationsPath(), {
        token: bearer('sub-policy2'),
        body: { validated: false, fieldKeys: [CORE[0]] },
      });
      const comment = await a.send('post', `${base()}/comments`, {
        token: bearer('sub-policy2'),
        body: { fieldKey: NON_CORE, body: 'Late' },
        key: 'late-1',
      });
      const finish = await a.send('post', finishPath(), {
        token: bearer('sub-policy2'),
      });
      expectError(validate, 409, 'ASSESSMENT_FINISHED');
      expectError(comment, 409, 'ASSESSMENT_FINISHED');
      expectError(finish, 409, 'ASSESSMENT_FINISHED');
      expect(a.world.releases).toHaveLength(1);
    });
  });

  describe('FR-15: POST finish', () => {
    it('401 without a token', async () => {
      await start();
      const res = await a.send('post', finishPath(), { token: null });
      expectError(res, 401, 'AUTH_TOKEN_INVALID');
    });

    it('Return: answers 200 with status returned, Assessed by the caller, and queues one not_qaed release', async () => {
      await start();
      await a.send('put', validationsPath(), {
        token: policy(),
        body: { validated: true, fieldKeys: [CORE[1], CORE[2]] },
      });
      // The comment create reads a snapshot, which the comments e2e covers; here the row is given.
      a.world.comments.push({
        id: 4001,
        assessmentId: a.world.assessments[0]!.id,
        authorId: a.users.policy.id,
        state: 'open',
        fieldKey: CORE[0],
        body: 'The title is vague',
      });

      const res = await a.send('post', finishPath(), { token: policy() });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        success: true,
        meta: { requestId: res.headers['x-request-id'] },
        data: {
          status: 'returned',
          assessedBy: { id: a.users.policy.id, nickname: 'Pia' },
          finishedAt: '2026-11-13T10:00:00.000Z',
        },
      });
      expect(a.world.releases.map((r) => r.outcome)).toEqual(['not_qaed']);
      expect(a.world.audits.filter((x) => x.action === 'end_returned')).toHaveLength(1);
      expect(a.world.comments.every((c) => c.visibleToProgramAt != null)).toBe(true);
    });

    it('409 ASSESSMENT_CORE_UNCOMMENTED carries the field keys in the response body, and stores nothing', async () => {
      await start();
      const res = await a.send('post', finishPath(), { token: policy() });
      expectError(res, 409, 'ASSESSMENT_CORE_UNCOMMENTED');
      expect(res.body.error.fields).toEqual([...CORE]);
      expect(a.world.assessments).toEqual([]);
      expect(a.world.releases).toEqual([]);
    });

    it('with no core field it ends quality_assessed', async () => {
      await start([]);
      const res = await a.send('post', finishPath(), { token: policy() });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('quality_assessed');
      expect(a.world.releases.map((r) => r.outcome)).toEqual(['qaed']);
    });

    it('five concurrent finishes over HTTP: one 200 and four 409 ASSESSMENT_FINISHED', async () => {
      await start([]);
      a.world.assessments.push({
        id: 1,
        membershipId: 1,
        stepPosition: 1,
        status: 'pending',
        fieldConfigVersion: 1,
      });
      a.world.holdLockUntil = 5;
      const tokens = [
        policy(),
        bearer('sub-policy2'),
        policy(),
        bearer('sub-policy2'),
        policy(),
      ];
      const responses = await Promise.all(
        tokens.map((token) => a.send('post', finishPath(), { token })),
      );
      expect(responses.filter((r) => r.status === 200)).toHaveLength(1);
      const refused = responses.filter((r) => r.status === 409);
      expect(refused).toHaveLength(4);
      for (const res of refused) {
        expect(res.body.error.code).toBe('ASSESSMENT_FINISHED');
      }
      expect(a.world.releases).toHaveLength(1);
      expect(
        a.world.audits.filter((x) => x.action.startsWith('end_')),
      ).toHaveLength(1);
    });

    it('403 ASSESSMENT_READ_ONLY for an ADMIN with no reviewer row', async () => {
      await start();
      const res = await a.send('post', finishPath(), {
        token: bearer('sub-admin'),
      });
      expectError(res, 403, 'ASSESSMENT_READ_ONLY');
    });

    it('the same 404 for a result that does not exist and one outside the scope', async () => {
      await start();
      // The caller sees program 1 only; result 5002 is in program 2.
      await a.programScope(a.users.policy.id, [1]);
      a.world.memberships.push({
        id: 2,
        timelineId: 1,
        resultCode: 5002,
        title: 'Another program',
        programId: 2,
        resultTypeKey: 'policy_change',
        resultId: 778,
      });
      const outOfScope = await a.send('post', finishPath(5002), {
        token: policy(),
      });
      const missing = await a.send('post', finishPath(9999), {
        token: policy(),
      });
      expectError(outOfScope, 404, 'ASSESSMENT_NOT_FOUND');
      expectError(missing, 404, 'ASSESSMENT_NOT_FOUND');
      // The WHOLE body, but for the two values that are per request.
      const shape = (res: request.Response) => ({
        status: res.status,
        body: withoutRequestMeta(res.body),
      });
      expect(shape(missing)).toEqual(shape(outOfScope));
      expect(a.world.assessments).toEqual([]);
    });

    it('400 VALIDATION_FAILED for a result code that is not a number', async () => {
      await start();
      const res = await a.send('post', finishPath('abc'), { token: policy() });
      expectError(res, 400, 'VALIDATION_FAILED');
    });

    it('409 ASSESSMENT_STEP_CLOSED once the step closed', async () => {
      await start();
      a.world.timelines[0]!.steps = defaultFakeSteps().map((step) => ({
        ...step,
        opensAt: minute('2025-01-01T00:00'),
        closesAt: minute('2025-01-31T23:59'),
      }));
      const res = await a.send('post', finishPath(), { token: policy() });
      expectError(res, 409, 'ASSESSMENT_STEP_CLOSED');
    });
  });
});
