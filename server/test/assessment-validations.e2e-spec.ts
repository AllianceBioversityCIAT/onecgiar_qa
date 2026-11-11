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
  type AssessmentApp,
} from './support/assessment-app.js';
import { defaultFakeSteps } from './support/in-memory-assessment.js';

// PUT /timelines/:timelineId/results/:resultCode/assessment/validations over
// real HTTP (design 6; FR-2, FR-10, FR-16, FR-21). Guards, pipe, envelope and
// OpenAPI are the real ones; the stores, the unit of work, the catalog and the
// clock are fakes. The write reads no snapshot, so none is seeded.

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

const path = (code: number | string = 5001, timelineId: number | string = 1) =>
  `/timelines/${timelineId}/results/${code}/assessment/validations`;
const policy = () => bearer('sub-policy');
const minute = (value: string) => value as RomeMinute;

function expectError(res: request.Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(res.body).toMatchObject({
    success: false,
    error: { status, code },
    meta: { requestId: res.headers['x-request-id'] },
  });
}

/** Step 1 of timeline 1 on the minutes a test names (09:00 to 17:30, never the fake's whole-month default). */
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

describe('PUT assessment validations (e2e)', () => {
  let a: AssessmentApp;

  async function start(at = new Date('2026-11-13T10:00:00Z')) {
    a = await buildAssessmentApp(at);
    a.world.timelines.push(
      { id: 1, name: 'Official', kind: 'official', steps: window() },
      { id: 2, name: 'Other', kind: 'additional', steps: window() },
    );
    a.world.timelineUsers.push({
      timelineId: 1,
      userId: a.users.policy.id,
      roleCode: 'ASSESSOR',
    });
    a.world.users.push(
      { id: a.users.policy.id, nickname: 'Pia' },
      { id: a.users.admin.id, nickname: 'Ada' },
    );
    const items: ConfigItem[] = applicable.map((fieldKey) => ({
      resultTypeKey: 'policy_change',
      fieldKey,
      visibility: ASSESSED.includes(fieldKey)
        ? 'assessed'
        : VIEW_ONLY.includes(fieldKey)
          ? 'view_only'
          : 'hidden',
      isCore: false,
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
    });
  }

  afterEach(async () => {
    await a.app.close();
  });

  describe('authentication and the body', () => {
    beforeEach(async () => {
      await start();
    });

    it('401 without a token', async () => {
      const res = await a.send('put', path(), {
        token: null,
        body: { validated: true, all: true },
      });
      expectError(res, 401, 'AUTH_TOKEN_INVALID');
    });

    it.each([
      ['a result code that is not a number', path('abc'), { validated: true, all: true }],
      ['a validated flag that is missing', path(), { all: true }],
      ['a validated flag that is not a boolean', path(), { validated: 'yes', all: true }],
      ['neither fieldKeys nor all', path(), { validated: true }],
      ['both fieldKeys and all', path(), { validated: true, all: true, fieldKeys: [ASSESSED[0]] }],
      ['all that is not true', path(), { validated: true, all: false }],
      ['an empty fieldKeys', path(), { validated: true, fieldKeys: [] }],
      ['more than 200 fieldKeys', path(), { validated: true, fieldKeys: Array.from({ length: 201 }, (_, i) => `k.${i}`) }],
      ['a fieldKeys item that is not a string', path(), { validated: true, fieldKeys: [1] }],
      ['an unknown body field', path(), { validated: true, all: true, extra: 1 }],
    ])('400 VALIDATION_FAILED for %s', async (_label, url, body) => {
      const res = await a.send('put', url, { token: policy(), body });
      expectError(res, 400, 'VALIDATION_FAILED');
      expect(a.world.validations).toEqual([]);
    });
  });

  describe('FR-10: validate and check all', () => {
    beforeEach(async () => {
      await start();
    });

    it('validates fields and answers the summary with every validation row', async () => {
      const res = await a.send('put', path(), {
        token: policy(),
        body: { validated: true, fieldKeys: [ASSESSED[0], ASSESSED[1]] },
      });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        success: true,
        meta: { requestId: res.headers['x-request-id'] },
        data: {
          status: 'pending',
          assessedBy: null,
          finishedAt: null,
          validations: [
            { fieldKey: ASSESSED[0], validated: true },
            { fieldKey: ASSESSED[1], validated: true },
          ],
        },
      });
      expect(a.world.audits).toHaveLength(1);
      expect(a.world.audits[0]).toMatchObject({
        actorId: a.users.policy.id,
        action: 'validate',
        fieldKeys: [ASSESSED[0], ASSESSED[1]],
        requestId: res.headers['x-request-id'],
      });
    });

    it('check all marks the 12 Assessed fields and no other', async () => {
      const res = await a.send('put', path(), {
        token: policy(),
        body: { validated: true, all: true },
      });
      expect(res.status).toBe(200);
      expect(
        res.body.data.validations.map((v: { fieldKey: string }) => v.fieldKey).sort(),
      ).toEqual([...ASSESSED].sort());
      expect(a.world.audits.map((x) => x.action)).toEqual(['check_all']);
    });

    it('writing the same state again answers 200 and adds no audit row', async () => {
      const body = { validated: true, fieldKeys: [ASSESSED[0]] };
      await a.send('put', path(), { token: policy(), body });
      const res = await a.send('put', path(), { token: policy(), body });
      expect(res.status).toBe(200);
      expect(a.world.audits).toHaveLength(1);
    });

    it('400 VALIDATION_FAILED naming a View only field, and nothing is stored', async () => {
      const res = await a.send('put', path(), {
        token: policy(),
        body: { validated: true, fieldKeys: [VIEW_ONLY[0]] },
      });
      expectError(res, 400, 'VALIDATION_FAILED');
      expect(res.body.error.fields).toEqual([
        {
          field: VIEW_ONLY[0],
          code: 'INVALID',
          message: 'This value is not valid.',
        },
      ]);
      expect(a.world.validations).toEqual([]);
      expect(a.world.audits).toEqual([]);
    });
  });

  describe('FR-2: the window', () => {
    it.each([
      ['08:59 Rome', '2026-11-12T07:59:00Z', 409],
      ['09:00 Rome', '2026-11-12T08:00:00Z', 200],
      ['17:30 Rome', '2026-11-20T16:30:00Z', 200],
      ['17:31 Rome', '2026-11-20T16:31:00Z', 409],
    ])('at %s the write answers %i', async (_label, instant, status) => {
      await start(new Date(instant));
      const res = await a.send('put', path(), {
        token: policy(),
        body: { validated: true, fieldKeys: [ASSESSED[0]] },
      });
      if (status === 409) {
        expectError(res, 409, 'ASSESSMENT_STEP_CLOSED');
        expect(a.world.validations).toEqual([]);
        expect(a.world.audits).toEqual([]);
      } else {
        expect(res.status).toBe(200);
        expect(a.world.validations).toHaveLength(1);
      }
    });
  });

  describe('FR-16, FR-1: after the end, and who may write', () => {
    beforeEach(async () => {
      await start();
    });

    it('409 ASSESSMENT_FINISHED once the assessment ended', async () => {
      a.world.assessments.push({
        id: 7,
        membershipId: 1,
        stepPosition: 1,
        status: 'quality_assessed',
      });
      const res = await a.send('put', path(), {
        token: policy(),
        body: { validated: true, all: true },
      });
      expectError(res, 409, 'ASSESSMENT_FINISHED');
      expect(a.world.validations).toEqual([]);
    });

    it('403 ASSESSMENT_READ_ONLY for an ADMIN with no reviewer row', async () => {
      const res = await a.send('put', path(), {
        token: bearer('sub-admin'),
        body: { validated: true, all: true },
      });
      expectError(res, 403, 'ASSESSMENT_READ_ONLY');
      expect(a.world.validations).toEqual([]);
    });

    it('the same 404 for a code that does not exist and for a result outside the scope', async () => {
      await a.programScope(a.users.policy.id, [2]); // the membership is program 1
      const outOfScope = await a.send('put', path(5001), {
        token: policy(),
        body: { validated: true, all: true },
      });
      const missing = await a.send('put', path(9999), {
        token: policy(),
        body: { validated: true, all: true },
      });
      const otherTimeline = await a.send('put', path(5001, 2), {
        token: policy(),
        body: { validated: true, all: true },
      });
      expectError(outOfScope, 404, 'ASSESSMENT_NOT_FOUND');
      const shape = (res: request.Response) => ({
        status: res.status,
        error: res.body.error,
      });
      expect(shape(missing)).toEqual(shape(outOfScope));
      expect(shape(otherTimeline)).toEqual(shape(outOfScope));
      expect(a.world.validations).toEqual([]);
    });

    it('the same 404 for a user with no reviewer row on the timeline', async () => {
      const res = await a.send('put', path(), {
        token: bearer('sub-other'),
        body: { validated: true, all: true },
      });
      expectError(res, 404, 'ASSESSMENT_NOT_FOUND');
    });
  });
});
