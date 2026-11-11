// @akili-spec assessment/step-1-assessment
import { readFileSync } from 'node:fs';
import {
  applicableFields,
  shapeCatalog,
} from '../src/admin-config/field-config/field-config-catalog.js';
import type { ConfigItem } from '../src/admin-config/field-config/field-config-diff.js';
import type { RomeMinute } from '../src/admin-config/rome-date.js';
import {
  FeedError,
  type FeedRelease,
  type FeedReleaseQuery,
} from '../src/ingestion/results-feed.port.js';
import {
  bearer,
  buildAssessmentApp,
  type AssessmentApp,
} from './support/assessment-app.js';
import { defaultFakeSteps } from './support/in-memory-assessment.js';

// The release outbox over real HTTP (T-12; design 6, 7.6; FR-18, NFR-6):
// the admin routes, the end answered while Reporting is down or never answers,
// and the retry. Guards, pipe, filter, envelope and OpenAPI are the real ones;
// the stores, the unit of work, the feed and the clock are fakes. The clock is
// fixed, so a lease never runs out by itself: a test that needs the retry
// moves the row's lease to the past, the way a minute passing would.

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

const minute = (value: string) => value as RomeMinute;
const finishPath = '/timelines/1/results/5001/assessment/finish';
const policy = () => bearer('sub-policy');
const admin = () => bearer('sub-admin');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const unavailable = () => new FeedError('unavailable', 503);
const releasedAll = (q: FeedReleaseQuery): FeedRelease => ({
  phaseYear: q.phaseYear,
  released: q.items.map((item) => ({
    resultId: item.resultId,
    resultCode: 5001,
    outcome: item.outcome,
  })),
  notReleased: [],
});

describe('the release outbox (e2e)', () => {
  let a: AssessmentApp;

  /** An open step 1, one membership, and a configuration with NO core field: Finish ends it quality_assessed (OQ-2). */
  async function start() {
    a = await buildAssessmentApp(new Date('2026-11-13T10:00:00Z'));
    a.world.timelines.push({
      id: 1,
      name: 'Official',
      kind: 'official',
      steps: [
        {
          position: 1,
          name: 'Step 1',
          audience: 'assessors',
          opensAt: minute('2026-11-12T09:00'),
          closesAt: minute('2026-11-20T17:30'),
        },
        ...defaultFakeSteps().slice(1),
      ],
    });
    a.world.timelineUsers.push({
      timelineId: 1,
      userId: a.users.policy.id,
      roleCode: 'ASSESSOR',
    });
    a.world.users.push({ id: a.users.policy.id, nickname: 'Pia' });
    const items: ConfigItem[] = applicable.map((fieldKey) => ({
      resultTypeKey: 'policy_change',
      fieldKey,
      visibility: ASSESSED.includes(fieldKey) ? 'assessed' : 'hidden',
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
      resultId: 777,
    });
  }

  afterEach(async () => {
    await a.app.close();
  });

  describe('Reporting down (FR-18 scenario)', () => {
    beforeEach(start);

    it('answers the end 200 while Reporting returns 503, keeps the release pending and the membership active, then sends it on the retry', async () => {
      a.feed.script(
        'release',
        unavailable(),
        unavailable(),
        unavailable(),
        releasedAll,
      );

      const finished = await a.send('post', finishPath, { token: policy() });

      // The end is answered whatever Reporting does (NFR-6).
      expect(finished.status).toBe(200);
      expect(finished.body.data.status).toBe('quality_assessed');
      // The dispatch ran after the answer and used its three attempts.
      await vi.waitFor(() => expect(a.feed.callsOf('release')).toHaveLength(3));
      await vi.waitFor(() =>
        expect(a.world.releases[0]!.status).toBe('pending'),
      );
      expect(a.world.memberships[0]!.ended).toBeUndefined();

      const pending = await a.send('get', '/assessment-releases', {
        token: admin(),
      });
      expect(pending.status).toBe(200);
      expect(pending.body.data).toEqual([
        {
          id: expect.any(Number),
          timeline: { id: 1, name: 'Official' },
          resultCode: 5001,
          outcome: 'qaed',
          status: 'pending',
          attempts: 1,
          reason: null,
          createdAt: '2026-11-13T10:00:00.000Z',
        },
      ]);

      // A minute passes: the lease is over.
      a.world.releaseMeta.get(a.world.releases[0]!.assessmentId)!.leaseUntil =
        new Date('2026-11-13T09:59:00Z');
      const retry = await a.send('post', '/assessment-releases/retry', {
        token: admin(),
      });

      expect(retry.status).toBe(200);
      expect(retry.body.data).toEqual({
        attempted: 1,
        sent: 1,
        refused: 0,
        stillPending: 0,
      });
      expect(a.world.releases[0]!.status).toBe('sent');
      expect(a.world.memberships[0]).toMatchObject({
        ended: true,
        endReason: 'released_qaed',
      });
      expect(a.feed.callsOf('release')).toHaveLength(4);
      const after = await a.send('get', '/assessment-releases', {
        token: admin(),
      });
      expect(after.body.data).toEqual([]);
    });
  });

  describe('NFR-6: the end answers before the feed resolves', () => {
    beforeEach(start);

    it('answers 200 while Reporting never answers', async () => {
      let calls = 0;
      a.feed.release = () => {
        calls += 1;
        return new Promise<FeedRelease>(() => undefined);
      };

      const answered = await Promise.race([
        a.send('post', finishPath, { token: policy() }),
        sleep(2000).then(() => 'hung' as const),
      ]);

      expect(answered).not.toBe('hung');
      if (answered === 'hung') return;
      expect(answered.status).toBe(200);
      expect(answered.body.data.status).toBe('quality_assessed');
      await vi.waitFor(() => expect(calls).toBe(1));
      expect(a.world.releases[0]!.status).toBe('pending');
    });
  });

  describe('a refusal (FR-18)', () => {
    beforeEach(start);

    it('lists a not_submitted release as refused with its reason and leaves the membership active', async () => {
      a.feed.script('release', (q: FeedReleaseQuery) => ({
        phaseYear: q.phaseYear,
        released: [],
        notReleased: [
          { resultId: 777, resultCode: 5001, reason: 'not_submitted' },
        ],
      }));

      await a.send('post', finishPath, { token: policy() });
      await vi.waitFor(() =>
        expect(a.world.releases[0]!.status).toBe('refused'),
      );

      const refused = await a.send(
        'get',
        '/assessment-releases?status=refused',
        {
          token: admin(),
        },
      );
      expect(refused.status).toBe(200);
      expect(refused.body.data).toMatchObject([
        { resultCode: 5001, status: 'refused', reason: 'not_submitted' },
      ]);
      expect(a.world.memberships[0]!.ended).toBeUndefined();
      expect(a.world.audits.map((x) => x.action)).toEqual([
        'end_quality_assessed',
        'release_refused',
      ]);
      // A refused row is not retried: the sweep finds nothing due.
      const retry = await a.send('post', '/assessment-releases/retry', {
        token: admin(),
      });
      expect(retry.body.data).toEqual({
        attempted: 0,
        sent: 0,
        refused: 0,
        stillPending: 0,
      });
    });
  });

  describe('the admin routes', () => {
    beforeEach(start);

    it('answer 403 to an assessor and 401 without a token', async () => {
      for (const [method, path] of [
        ['get', '/assessment-releases'],
        ['post', '/assessment-releases/retry'],
      ] as const) {
        const denied = await a.send(method, path, { token: policy() });
        expect(denied.status).toBe(403);
        expect(denied.body).toMatchObject({
          success: false,
          error: { status: 403, code: 'AUTH_PERMISSION_DENIED' },
        });
        const anonymous = await a.send(method, path, { token: null });
        expect(anonymous.status).toBe(401);
      }
      expect(a.feed.callsOf('release')).toEqual([]);
    });

    it('rejects a status other than pending or refused', async () => {
      const res = await a.send('get', '/assessment-releases?status=sent', {
        token: admin(),
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('lists pending by default, and the retry of nothing due answers zeros', async () => {
      const list = await a.send('get', '/assessment-releases', {
        token: admin(),
      });
      expect(list.status).toBe(200);
      expect(list.body.data).toEqual([]);
      const retry = await a.send('post', '/assessment-releases/retry', {
        token: admin(),
      });
      expect(retry.status).toBe(200);
      expect(retry.body.data).toEqual({
        attempted: 0,
        sent: 0,
        refused: 0,
        stillPending: 0,
      });
    });
  });
});
