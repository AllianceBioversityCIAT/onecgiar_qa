// @akili-spec assessment/step-1-assessment
import { readFileSync } from 'node:fs';
import type { OpenAPIObject } from '@nestjs/swagger';
import type request from 'supertest';
import {
  applicableFields,
  shapeCatalog,
} from '../src/admin-config/field-config/field-config-catalog.js';
import type { ConfigItem } from '../src/admin-config/field-config/field-config-diff.js';
import type { FieldVisibility } from '../src/admin-config/field-config/field-config-rules.js';
import type { FeedLabels } from '../src/ingestion/results-feed.port.js';
import { buildOpenApiDocument } from '../src/common/openapi.js';
import {
  bearer,
  buildAssessmentApp,
  type AssessmentApp,
} from './support/assessment-app.js';
import { defaultFakeSteps } from './support/in-memory-assessment.js';
import { runRealLoad } from './support/real-load-writer.js';

// GET /timelines/:timelineId/results/:resultCode/assessment over real HTTP
// (design 6; FR-1, FR-8, FR-9, NFR-2). Guards, pipe, envelope and OpenAPI are
// the real ones; the stores, the catalog, the snapshot store and the clock are
// fakes. The snapshot is written by the real LoadRunner, so the `snapshot_sk`
// of every membership here is the runner's own (`SNAP#…`). Expected values are
// written out, not imported.

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

const path = (code: number | string, timelineId = 1) =>
  `/timelines/${timelineId}/results/${code}/assessment`;
const policy = () => bearer('sub-policy');

function expectError(res: request.Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(res.body).toMatchObject({
    success: false,
    error: { status, code },
    meta: { requestId: res.headers['x-request-id'] },
  });
}

describe('GET assessment view (e2e)', () => {
  let a: AssessmentApp;
  let nextMembership = 1;

  /** The result is loaded by the real runner; its snapshot and key are copied into the app's world. */
  async function seed(
    resultId: number,
    values: Record<string, unknown>,
    extra: Partial<Parameters<typeof a.world.memberships.push>[0]> = {},
    labels?: FeedLabels,
  ) {
    const real = await runRealLoad([
      { resultId, values, ...(labels === undefined ? {} : { labels }) },
    ]);
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
      snapshotSk: written.snapshotSk,
      ...extra,
    });
    return written.resultCode;
  }

  /** Version 1 is what a timeline resolves to AND what an assessment pinned, unless a test says otherwise. */
  const configure = (
    overrides: Record<string, FieldVisibility> = {},
    fallback: FieldVisibility = 'view_only',
    extraItems: ConfigItem[] = [],
  ) => {
    const items: ConfigItem[] = [
      ...applicable.map((fieldKey) => ({
        resultTypeKey: 'policy_change',
        fieldKey,
        visibility: overrides[fieldKey] ?? fallback,
        isCore: false,
        isAiInput: false,
      })),
      ...extraItems,
    ];
    a.world.fieldConfigItems['policy_change'] = items;
    a.world.versionItems[1] = { policy_change: items };
  };

  beforeEach(async () => {
    a = await buildAssessmentApp();
    a.world.timelines.push(
      { id: 1, name: 'Official', kind: 'official', steps: defaultFakeSteps() },
      { id: 2, name: 'Other', kind: 'additional', steps: defaultFakeSteps() },
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
    configure();
  });

  afterEach(async () => {
    await a.app.close();
  });

  describe('authentication and parameters', () => {
    it('401 without a token', async () => {
      const res = await a.send('get', path(5001), { token: null });
      expectError(res, 401, 'AUTH_TOKEN_INVALID');
    });

    it.each([
      ['a result code that is not a number', path('abc')],
      ['a zero result code', path(0)],
      ['a timeline id that is not a number', path(5001, 'x' as never)],
      ['a round outside 1 to 2', `${path(5001)}?round=3`],
      ['an unknown query field', `${path(5001)}?foo=1`],
    ])('400 VALIDATION_FAILED for %s', async (_label, url) => {
      const res = await a.send('get', url, { token: policy() });
      expectError(res, 400, 'VALIDATION_FAILED');
    });
  });

  describe('FR-8: the view', () => {
    it('answers the envelope with the header, the sections in catalog order and the writable flag', async () => {
      const code = await seed(1001, { 'general.title': 'A real title' });

      const res = await a.send('get', path(code), { token: policy() });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        success: true,
        meta: { requestId: res.headers['x-request-id'] },
      });
      expect(res.body.meta.page).toBeUndefined();
      expect(res.body.data.header).toEqual({
        resultCode: 5001,
        title: 'A real title',
        program: { id: 1, code: 'SP01', name: 'Breeding' },
        resultType: { key: 'policy_change', label: 'policy_change' },
        timeline: { id: 1, name: 'Official' },
        step: { position: 1, name: 'Step 1' },
        status: 'pending',
      });
      expect(res.body.data.sections.map((s: { key: string }) => s.key)).toEqual(
        [
          'general_information',
          'theory_of_change',
          'contributors_partners',
          'geographic_location',
          'policy_change_info',
          'evidence',
        ],
      );
      expect(res.body.data.writable).toBe(true);
      expect(res.body.data.readOnlyReason).toBeNull();
      expect(res.body.data.assessment).toBeNull();
      expect(res.body.data.other).toEqual([]);
      // FR-11: an author is shown by nickname only, no e-mail anywhere in the body.
      expect(res.text).not.toContain('@');
    });

    it('gives each field the labels Reporting keyed by control list, through the real runner and the real catalog', async () => {
      const code = await seed(
        1001,
        { 'general.primary_program': 3, 'general.title': 'T' },
        {},
        { initiatives: { '3': 'SP03 Apple' }, centers: { '9': 'CIAT' } },
      );

      const res = await a.send('get', path(code), { token: policy() });

      expect(res.status).toBe(200);
      const fields = res.body.data.sections.flatMap(
        (s: { fields: Array<Record<string, unknown>> }) => s.fields,
      );
      const field = (key: string) =>
        fields.find((f: { key: string }) => f.key === key);
      expect(field('general.primary_program')).toMatchObject({
        value: 3,
        labels: { initiatives: { '3': 'SP03 Apple' } },
      });
      expect(field('general.title')).toMatchObject({ labels: null });
      // A list nobody in this result names never reaches the field.
      expect(res.text).not.toContain('CIAT');
    });

    it('lists a snapshot key the catalog lacks under other, and never one the pinned configuration reads Hidden', async () => {
      configure({}, 'view_only', [
        {
          resultTypeKey: 'policy_change',
          fieldKey: 'removed.hidden',
          visibility: 'hidden',
          isCore: false,
          isAiInput: false,
        },
      ]);
      const code = await seed(1001, {
        'general.title': 'T',
        'removed.hidden': 'SECRET-HIDDEN-OTHER',
        'removed.unclassified': 'kept',
      });

      const res = await a.send('get', path(code), { token: policy() });

      expect(res.status).toBe(200);
      expect(res.body.data.other.map((f: { key: string }) => f.key)).toEqual([
        'removed.unclassified',
      ]);
      // The raw body: the value and the key are nowhere in it.
      expect(res.text).not.toContain('SECRET-HIDDEN-OTHER');
      expect(res.text).not.toContain('removed.hidden');
    });

    it('an ADMIN reads it, read only, with the reason', async () => {
      const code = await seed(1001, { 'general.title': 'T' });
      const res = await a.send('get', path(code), {
        token: bearer('sub-admin'),
      });
      expect(res.status).toBe(200);
      expect(res.body.data.writable).toBe(false);
      expect(res.body.data.readOnlyReason).toBe('admin_read_only');
    });

    it('409 ASSESSMENT_NO_FIELD_CONFIG when the timeline resolves to no configuration, never a guessed page', async () => {
      const code = await seed(1001, { 'general.title': 'T' });
      a.world.noFieldConfigVersion = true;
      const res = await a.send('get', path(code), { token: policy() });
      expectError(res, 409, 'ASSESSMENT_NO_FIELD_CONFIG');
      expect(res.body.data).toBeUndefined();
    });

    it('503 SERVICE_UNAVAILABLE when the catalog cannot be read', async () => {
      const code = await seed(1001, { 'general.title': 'T' });
      a.catalogSource.down = true;
      const res = await a.send('get', path(code), { token: policy() });
      expectError(res, 503, 'SERVICE_UNAVAILABLE');
    });
  });

  describe('FR-9: hidden fields are absent from the response body', () => {
    it('shows toc.entries read only with all 3 contributions, and no other hidden field appears at all', async () => {
      configure({ 'toc.entries': 'hidden', 'general.description': 'hidden' });
      const entries = [
        { id: 1, name: 'One' },
        { id: 2, name: 'Two' },
        { id: 3, name: 'Three' },
      ];
      const code = await seed(1001, {
        'toc.entries': entries,
        'general.description': 'SECRET-HIDDEN-VALUE',
        'general.title': 'T',
      });

      const res = await a.send('get', path(code), { token: policy() });

      expect(res.status).toBe(200);
      const fields = res.body.data.sections.flatMap(
        (s: { fields: Array<Record<string, unknown>> }) => s.fields,
      );
      expect(
        fields.find((f: { key: string }) => f.key === 'toc.entries'),
      ).toMatchObject({
        mode: 'view',
        value: entries,
        validated: false,
        comments: [],
      });
      expect(
        fields.some((f: { key: string }) => f.key === 'general.description'),
      ).toBe(false);
      // The raw body, not the parsed field list: the value is nowhere in it.
      expect(res.text).not.toContain('SECRET-HIDDEN-VALUE');
      expect(res.text).not.toContain('general.description');
    });
  });

  describe('FR-1: out of scope is the same 404 as a missing code', () => {
    it('answers a byte-equal 404 for an out-of-scope result, a missing code, another timeline and a caller with no role', async () => {
      const outOfScope = await seed(
        1001,
        { 'general.title': 'T' },
        { programId: 2 },
      );
      // A grant to one program only, so program 2 is outside it.
      await a.programScope(a.users.policy.id, [1]);
      const inOtherTimeline = await seed(
        1002,
        { 'general.title': 'T' },
        { timelineId: 2 },
      );

      const missing = await a.send('get', path(999999), { token: policy() });
      expectError(missing, 404, 'ASSESSMENT_NOT_FOUND');
      // Same status and body but for the per-request fields.
      const strip = (res: request.Response) => {
        const body = structuredClone(res.body) as {
          meta?: { requestId?: string; timestamp?: string };
        };
        delete body.meta;
        return JSON.stringify([res.status, body]);
      };

      for (const res of [
        await a.send('get', path(outOfScope), { token: policy() }),
        await a.send('get', path(inOtherTimeline, 2), { token: policy() }),
        await a.send('get', path(inOtherTimeline), { token: policy() }),
        await a.send('get', path(outOfScope, 77), { token: policy() }),
        await a.send('get', path(outOfScope), { token: bearer('sub-guest') }),
      ]) {
        expectError(res, 404, 'ASSESSMENT_NOT_FOUND');
        expect(strip(res)).toBe(strip(missing));
      }
    });

    it('never answers 403 for an out-of-scope result', async () => {
      const code = await seed(1001, { 'general.title': 'T' }, { programId: 2 });
      await a.programScope(a.users.policy.id, [1]);
      const res = await a.send('get', path(code), { token: policy() });
      expect(res.status).toBe(404);
    });
  });

  describe('NFR-2: a bounded number of statements', () => {
    it('runs 8 statements for a result with no assessment row yet: effectiveFor is five, as in production', async () => {
      const code = await seed(1001, { 'general.title': 'T' });
      a.world.resetStatements();

      const res = await a.send('get', path(code), { token: policy() });

      expect(res.status).toBe(200);
      // timelines, load probe, membership, then the 5 of `effectiveFor`.
      expect(a.world.statements).toBe(8);
    });

    it('runs 6 statements for a result with an assessment, validations and comments: the pinned version is one read', async () => {
      const code = await seed(1001, { 'general.title': 'T' });
      a.world.assessments.push({
        id: 70,
        membershipId: a.world.memberships[0]!.id,
        stepPosition: 1,
        status: 'pending',
      });
      for (let i = 0; i < 40; i++) {
        a.world.comments.push({
          assessmentId: 70,
          authorId: a.users.policy.id,
          state: 'open',
        });
        a.world.validations.push({
          assessmentId: 70,
          fieldKey: `field.${i}`,
          validated: true,
        });
      }
      a.world.resetStatements();

      const res = await a.send('get', path(code), { token: policy() });

      expect(res.status).toBe(200);
      // timelines, load probe, membership (with the pinned version's id), the
      // pinned version's items, validations, comments. The fake configuration
      // counts what production runs: `effectiveFor` is five, `versionItems` one.
      expect(a.world.statements).toBe(6);
    });
  });

  describe('OpenAPI', () => {
    it('documents the route, its envelope and its error codes', () => {
      const document: OpenAPIObject = buildOpenApiDocument(a.app);
      const operation =
        document.paths[
          '/api/v1/timelines/{timelineId}/results/{resultCode}/assessment'
        ]?.get;
      expect(operation).toBeDefined();
      expect(Object.keys(operation!.responses)).toEqual(
        expect.arrayContaining(['200', '400', '401', '404', '409', '503']),
      );
      expect(JSON.stringify(document.components?.schemas)).toContain(
        'AssessmentViewModel',
      );
    });
  });
});
