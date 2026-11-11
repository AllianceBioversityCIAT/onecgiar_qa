// @akili-spec assessment/step-1-assessment
import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CATALOG_TIMEOUT_MS,
} from '../users/catalogs/catalog-http.js';
import {
  FeedError,
  type FeedRelease,
  type FeedReleaseQuery,
  type ResultsFeed,
} from '../ingestion/results-feed.port.js';
import {
  InMemoryAssessmentUnitOfWork,
  InMemoryAssessmentWorld,
  InMemoryReleaseStore,
  type FakeMembership,
} from '../../test/support/in-memory-assessment.js';
import { FakeResultsFeed } from '../../test/support/fake-results-feed.js';
import type { ReleaseStore } from './release.store.js';
import {
  RELEASE_LEASE_MS,
  ReleaseService,
  WORST_CASE_SEND_MS,
} from './release.service.js';

// The release outbox (T-12; FR-18, NFR-3, design 7.6) over the fake unit of
// work. Expected values come from the scenarios of requirements.md and are
// written out. The fake feed FAILS (503) before it succeeds in every retry
// test: a feed that answers well on the first call would never run the retry
// path (the task's disqualifier).

const START = new Date('2026-11-13T10:00:00Z');
const ENDED_BY = 10;

const unavailable = () => new FeedError('unavailable', 503);

/** Reporting's answer to a release: every item released as asked. */
const releasedAll = (q: FeedReleaseQuery): FeedRelease => ({
  phaseYear: q.phaseYear,
  released: q.items.map((item) => ({
    resultId: item.resultId,
    resultCode: item.resultId + 1000,
    outcome: item.outcome,
  })),
  notReleased: [],
});

/** Reporting's answer when every item is refused for `reason`. */
const notReleasedAll =
  (reason: string) =>
  (q: FeedReleaseQuery): FeedRelease => ({
    phaseYear: q.phaseYear,
    released: [],
    notReleased: q.items.map((item) => ({
      resultId: item.resultId,
      resultCode: item.resultId + 1000,
      reason,
    })),
  });

function setup(
  wrap: (store: InMemoryReleaseStore, clock: { now: Date }) => ReleaseStore = (
    store,
  ) => store,
) {
  const world = new InMemoryAssessmentWorld();
  world.timelines.push({
    id: 1,
    name: 'Official',
    kind: 'official',
    steps: [],
  });
  world.timelines.push({ id: 2, name: 'Extra', kind: 'additional', steps: [] });
  const clock = { now: START };
  const feed = new FakeResultsFeed();
  const pauses: number[] = [];
  const service = new ReleaseService(
    wrap(new InMemoryReleaseStore(world), clock),
    feed,
    new InMemoryAssessmentUnitOfWork(world),
    () => clock.now,
    (ms) => {
      pauses.push(ms);
      return Promise.resolve();
    },
  );
  let next = 1;
  /** A finished assessment whose release is queued: the state right after an end commits. */
  const queue = (
    outcome: 'qaed' | 'not_qaed',
    extra: Partial<FakeMembership> = {},
  ) => {
    const id = next++;
    const membership: FakeMembership = {
      id,
      timelineId: 1,
      resultCode: 5000 + id,
      title: null,
      programId: 1,
      resultTypeKey: 'policy_change',
      resultId: 9000 + id,
      phaseYear: 2026,
      ...extra,
    };
    world.memberships.push(membership);
    world.assessments.push({
      id: 100 + id,
      membershipId: id,
      stepPosition: 1,
      status: outcome === 'qaed' ? 'quality_assessed' : 'returned',
      finishedBy: ENDED_BY,
      finishedAt: START,
    });
    world.releases.push({
      assessmentId: 100 + id,
      timelineResultId: id,
      resultId: membership.resultId!,
      phaseYear: membership.phaseYear!,
      outcome,
      at: START,
      status: 'pending',
    });
    return membership;
  };
  const row = (membership: FakeMembership) =>
    world.releases.find((r) => r.timelineResultId === membership.id)!;
  return { world, clock, feed, pauses, service, queue, row };
}

/** A feed whose `release` waits for the test: the deferred interleaving. */
function deferredFeed() {
  const calls: FeedReleaseQuery[] = [];
  const resolvers: Array<() => void> = [];
  const feed = {
    release: (q: FeedReleaseQuery) => {
      calls.push(q);
      return new Promise<FeedRelease>((resolve) => {
        resolvers.push(() => resolve(releasedAll(q)));
      });
    },
  } as unknown as ResultsFeed;
  return {
    feed,
    calls,
    answerAll: () => {
      for (const resolve of resolvers.splice(0)) resolve();
    },
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('ReleaseService.dispatch (design 7.6)', () => {
  describe('Reporting down (FR-18 scenario)', () => {
    it('keeps the row pending after three 503s, keeps the attempt, waits 1 s then 4 s, and ends nothing', async () => {
      const { world, feed, pauses, service, queue, row } = setup();
      const membership = queue('not_qaed');
      feed.script('release', unavailable());

      const result = await service.dispatch();

      expect(feed.callsOf('release')).toHaveLength(3);
      expect(pauses).toEqual([1000, 4000]);
      expect(result).toEqual({
        attempted: 1,
        sent: 0,
        refused: 0,
        stillPending: 1,
      });
      expect(row(membership).status).toBe('pending');
      expect(world.metaOf(row(membership)).attempts).toBe(1);
      // The membership is ended only once the release is acknowledged.
      expect(membership.ended).toBeUndefined();
      expect(world.audits).toEqual([]);
    });

    it('sends the row on the next retry once Reporting answers, and ends the membership then', async () => {
      const { world, clock, feed, service, queue, row } = setup();
      const membership = queue('not_qaed');
      feed.script(
        'release',
        unavailable(),
        unavailable(),
        unavailable(),
        releasedAll,
      );

      await service.dispatch();
      expect(row(membership).status).toBe('pending');

      // Still leased a moment later: not due, not sent again.
      clock.now = new Date(START.getTime() + 30_000);
      expect(await service.dispatch()).toEqual({
        attempted: 0,
        sent: 0,
        refused: 0,
        stillPending: 0,
      });
      expect(feed.callsOf('release')).toHaveLength(3);

      // The lease (60 s) has passed.
      clock.now = new Date(START.getTime() + 61_000);
      const result = await service.dispatch();

      expect(result).toEqual({
        attempted: 1,
        sent: 1,
        refused: 0,
        stillPending: 0,
      });
      expect(row(membership).status).toBe('sent');
      expect(world.metaOf(row(membership)).attempts).toBe(2);
      expect(membership).toMatchObject({ ended: true, endReason: 'returned' });
    });

    it('stays pending at once on a 401 or a 400 without retrying, keeping the attempt', async () => {
      for (const error of [
        new FeedError('unauthorized', 401),
        new FeedError('rejected', 400),
      ]) {
        const { world, feed, pauses, service, queue, row } = setup();
        const membership = queue('qaed');
        feed.script('release', error);

        const result = await service.dispatch();

        expect(feed.callsOf('release')).toHaveLength(1);
        expect(pauses).toEqual([]);
        expect(result.stillPending).toBe(1);
        expect(row(membership).status).toBe('pending');
        expect(world.metaOf(row(membership)).attempts).toBe(1);
        expect(membership.ended).toBeUndefined();
      }
    });

    it('never throws: a feed that fails in a way no retry helps leaves the row pending', async () => {
      const { feed, service, queue, row } = setup();
      const membership = queue('qaed');
      feed.script('release', new Error('socket hang up'));

      await expect(service.dispatch()).resolves.toMatchObject({
        stillPending: 1,
      });
      expect(row(membership).status).toBe('pending');
    });
  });

  describe('the ack', () => {
    it('released: qaed becomes sent and the membership ends released_qaed; not_qaed ends returned; each with its audit row', async () => {
      const { world, feed, service, queue, row } = setup();
      const qaed = queue('qaed');
      const notQaed = queue('not_qaed');
      feed.script('release', releasedAll);

      const result = await service.dispatch();

      expect(result).toEqual({
        attempted: 2,
        sent: 2,
        refused: 0,
        stillPending: 0,
      });
      expect(feed.callsOf('release')).toEqual([
        {
          phaseYear: 2026,
          items: [
            { resultId: qaed.resultId, outcome: 'qaed' },
            { resultId: notQaed.resultId, outcome: 'not_qaed' },
          ],
        },
      ]);
      expect(row(qaed).status).toBe('sent');
      expect(row(notQaed).status).toBe('sent');
      expect(world.metaOf(row(qaed)).sentAt).toEqual(START);
      expect(world.metaOf(row(qaed)).reason).toBeNull();
      expect(qaed).toMatchObject({ ended: true, endReason: 'released_qaed' });
      expect(notQaed).toMatchObject({ ended: true, endReason: 'returned' });
      // FR-21: one `release_sent` row per release, by the person who ended the assessment, ids only.
      expect(world.audits).toEqual([
        {
          assessmentId: 101,
          actorId: ENDED_BY,
          action: 'release_sent',
          fieldKeys: null,
          commentId: null,
          requestId: `release-${world.metaOf(row(qaed)).id}`,
          at: START,
        },
        {
          assessmentId: 102,
          actorId: ENDED_BY,
          action: 'release_sent',
          fieldKeys: null,
          commentId: null,
          requestId: `release-${world.metaOf(row(notQaed)).id}`,
          at: START,
        },
      ]);
    });

    it('takes the timeline FOR SHARE, then the assessment FOR UPDATE, before it settles the row and ends the membership (design 5)', async () => {
      const { world, feed, service, queue } = setup();
      queue('qaed');
      queue('not_qaed', { timelineId: 2 });
      feed.script('release', releasedAll);

      await service.dispatch();

      expect(world.writeLog).toEqual([
        'claimDue',
        'lockTimelineShared',
        'lockTimelineShared',
        'lockReleaseAssessment',
        'settleRelease',
        'endAsReleasedQaed',
        'insertAudit',
        'lockReleaseAssessment',
        'settleRelease',
        'endAsReturned',
        'insertAudit',
        'claimDue',
      ]);
    });

    it('acknowledges a batch in ONE transaction', async () => {
      const { world, feed, service, queue } = setup();
      queue('qaed');
      queue('qaed');
      queue('not_qaed');
      feed.script('release', releasedAll);

      await service.dispatch();

      expect(world.transactions).toBe(1);
    });

    it('not_in_qa on a retry counts as sent with its reason, and the membership ends (the first send reached Reporting, its ack was lost)', async () => {
      const { world, clock, feed, service, queue, row } = setup();
      const qaed = queue('qaed');
      const notQaed = queue('not_qaed');
      // The first dispatch gets no answer (503 three times); Reporting has the release all the same, so the repeat answers not_in_qa.
      feed.script(
        'release',
        unavailable(),
        unavailable(),
        unavailable(),
        notReleasedAll('not_in_qa'),
      );

      expect(await service.dispatch()).toMatchObject({ stillPending: 2 });
      expect(row(qaed).status).toBe('pending');

      clock.now = new Date(START.getTime() + 61_000);
      const result = await service.dispatch();

      expect(result).toEqual({
        attempted: 2,
        sent: 2,
        refused: 0,
        stillPending: 0,
      });
      expect(row(qaed).status).toBe('sent');
      expect(world.metaOf(row(qaed)).reason).toBe('not_in_qa');
      expect(world.metaOf(row(qaed)).sentAt).toEqual(
        new Date('2026-11-13T10:01:01Z'),
      );
      expect(qaed).toMatchObject({ ended: true, endReason: 'released_qaed' });
      expect(notQaed).toMatchObject({ ended: true, endReason: 'returned' });
      expect(world.audits.map((a) => a.action)).toEqual([
        'release_sent',
        'release_sent',
      ]);
    });

    it('not_submitted, not_found and other_phase are refused with their reason, and the membership stays active', async () => {
      for (const reason of ['not_submitted', 'not_found', 'other_phase']) {
        const { world, feed, service, queue, row } = setup();
        const membership = queue('qaed');
        feed.script('release', notReleasedAll(reason));

        const result = await service.dispatch();

        expect(result).toEqual({
          attempted: 1,
          sent: 0,
          refused: 1,
          stillPending: 0,
        });
        expect(row(membership).status).toBe('refused');
        expect(world.metaOf(row(membership)).reason).toBe(reason);
        expect(world.metaOf(row(membership)).sentAt).toBeNull();
        expect(membership.ended).toBeUndefined();
        expect(world.audits.map((a) => a.action)).toEqual(['release_refused']);
      }
    });

    it('does not take a refused row again, and a mixed answer settles each row on its own', async () => {
      const { world, feed, service, queue, row } = setup();
      const ok = queue('qaed');
      const refused = queue('qaed');
      feed.script('release', (q: FeedReleaseQuery) => ({
        phaseYear: q.phaseYear,
        released: [{ resultId: ok.resultId!, resultCode: 1, outcome: 'qaed' }],
        notReleased: [
          {
            resultId: refused.resultId!,
            resultCode: 2,
            reason: 'not_submitted',
          },
        ],
      }));

      await service.dispatch();
      expect(row(ok).status).toBe('sent');
      expect(row(refused).status).toBe('refused');

      world.releaseMeta.get(row(refused).assessmentId)!.leaseUntil = null;
      expect(await service.dispatch()).toEqual({
        attempted: 0,
        sent: 0,
        refused: 0,
        stillPending: 0,
      });
      expect(feed.callsOf('release')).toHaveLength(1);
    });

    it('ends a round-2 membership as released_qaed, and leaves a round-2 returned one active (round 1 only, P-1)', async () => {
      const { feed, service, queue, row } = setup();
      const qaed = queue('qaed', { round: 2 });
      const returned = queue('not_qaed', { round: 2 });
      feed.script('release', releasedAll);

      await service.dispatch();

      expect(qaed).toMatchObject({ ended: true, endReason: 'released_qaed' });
      // The release is sent; `endAsReturned` is a no-op on a round-2 row.
      expect(row(returned).status).toBe('sent');
      expect(returned.ended).toBeUndefined();
    });

    it('leaves an item Reporting did not answer pending', async () => {
      const { feed, service, queue, row } = setup();
      const membership = queue('qaed');
      feed.script('release', (q: FeedReleaseQuery) => ({
        phaseYear: q.phaseYear,
        released: [],
        notReleased: [],
      }));

      const result = await service.dispatch();

      expect(result.stillPending).toBe(1);
      expect(row(membership).status).toBe('pending');
    });

    it('rolls the whole batch back when the ack transaction fails, leaves the rows pending and does not throw', async () => {
      const { world, feed, service, queue, row } = setup();
      const first = queue('qaed');
      const second = queue('not_qaed');
      feed.script('release', releasedAll);
      world.beforeLockTimeline = () => {
        throw new Error('connection lost');
      };

      const result = await service.dispatch();

      expect(result).toEqual({
        attempted: 2,
        sent: 0,
        refused: 0,
        stillPending: 2,
      });
      expect(row(first).status).toBe('pending');
      expect(row(second).status).toBe('pending');
      expect(first.ended).toBeUndefined();
      expect(world.audits).toEqual([]);
    });

    it('writes nothing for a row another dispatcher settled while this one was sending', async () => {
      const { world, feed, service, queue, row } = setup();
      const membership = queue('qaed');
      feed.script('release', (q: FeedReleaseQuery) => {
        // The lease ran out and a second dispatcher acknowledged the row first.
        row(membership).status = 'sent';
        return releasedAll(q);
      });

      const result = await service.dispatch();

      expect(result).toEqual({
        attempted: 1,
        sent: 0,
        refused: 0,
        stillPending: 1,
      });
      expect(membership.ended).toBeUndefined();
      expect(world.audits).toEqual([]);
    });
  });

  describe('batches (P-4)', () => {
    it('51 due rows are sent in two calls of at most 50', async () => {
      const { feed, service, queue } = setup();
      for (let i = 0; i < 51; i++) queue('qaed');
      feed.script('release', releasedAll);

      const result = await service.dispatch();

      expect(
        feed
          .callsOf('release')
          .map((q) => (q as FeedReleaseQuery).items.length),
      ).toEqual([50, 1]);
      expect(result).toEqual({
        attempted: 51,
        sent: 51,
        refused: 0,
        stillPending: 0,
      });
    });

    it('sends one call per phase year', async () => {
      const { feed, service, queue } = setup();
      queue('qaed', { phaseYear: 2026 });
      queue('qaed', { phaseYear: 2025 });
      queue('not_qaed', { phaseYear: 2026 });
      feed.script('release', releasedAll);

      await service.dispatch();

      const calls = feed.callsOf('release') as FeedReleaseQuery[];
      expect(
        calls
          .map((q) => [q.phaseYear, q.items.length] as const)
          .sort((x, y) => x[0] - y[0]),
      ).toEqual([
        [2025, 1],
        [2026, 2],
      ]);
    });
  });

  describe('one claim is one batch', () => {
    it('a result in two memberships of one year goes to two calls, never twice in one (P-4)', async () => {
      const { feed, service, queue } = setup();
      queue('qaed', { resultId: 4242 });
      queue('qaed', { resultId: 4242, timelineId: 2 });
      feed.script('release', releasedAll);

      const result = await service.dispatch();

      const calls = feed.callsOf('release') as FeedReleaseQuery[];
      expect(calls.map((q) => q.items.length)).toEqual([1, 1]);
      expect(result.attempted).toBe(2);
    });

    it('a bounded sweep runs at most maxRounds batches and leaves the rest due', async () => {
      const { feed, service, queue, row } = setup();
      const rows = [2021, 2022, 2023, 2024].map((year) =>
        queue('qaed', { phaseYear: year }),
      );
      feed.script('release', releasedAll);

      const result = await service.dispatch({ maxRounds: 3 });

      expect(feed.callsOf('release')).toHaveLength(3);
      expect(result).toMatchObject({ attempted: 3, sent: 3 });
      expect(row(rows[3]!).status).toBe('pending');
      expect(await service.dispatch()).toMatchObject({ attempted: 1, sent: 1 });
    });
  });

  describe('what the ack could not do is on the log line', () => {
    let lines: Array<Record<string, unknown>>;
    beforeEach(() => {
      lines = [];
      vi.spyOn(Logger.prototype, 'log').mockImplementation((line: unknown) => {
        lines.push(JSON.parse(String(line)) as Record<string, unknown>);
      });
    });
    afterEach(() => vi.restoreAllMocks());

    it('names already_ended, not_round_1 and no_actor, and still settles the row', async () => {
      const { world, feed, service, queue, row } = setup();
      const ended = queue('qaed', { ended: true, endReason: 'returned' });
      const round2 = queue('not_qaed', { round: 2 });
      const anonymous = queue('qaed');
      world.assessments.find(
        (a) => a.membershipId === anonymous.id,
      )!.finishedBy = null;
      feed.script('release', releasedAll);

      await service.dispatch();

      const notes = Object.fromEntries(
        lines.map((l) => [l.assessmentId, l.note]),
      );
      expect(notes).toEqual({
        [100 + ended.id]: 'already_ended',
        [100 + round2.id]: 'not_round_1',
        [100 + anonymous.id]: 'no_actor',
      });
      expect(row(anonymous).status).toBe('sent');
      expect(world.audits.map((a) => a.assessmentId)).toEqual([
        100 + ended.id,
        100 + round2.id,
      ]);
    });
  });

  describe('two dispatchers (FR-18: AND IT MUST NOT send two releases for one end)', () => {
    it('sends one release for the row while both are in flight, and the second finds nothing due', async () => {
      const { world, service: _unused, queue, clock } = setup();
      const { feed, calls, answerAll } = deferredFeed();
      const service = new ReleaseService(
        new InMemoryReleaseStore(world),
        feed,
        new InMemoryAssessmentUnitOfWork(world),
        () => clock.now,
        () => Promise.resolve(),
      );
      const membership = queue('qaed');

      const first = service.dispatch();
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      // The first is waiting on Reporting; the second runs now.
      const second = await Promise.race([
        service.dispatch(),
        sleep(100).then(() => 'hung'),
      ]);

      expect(second).toEqual({
        attempted: 0,
        sent: 0,
        refused: 0,
        stillPending: 0,
      });
      expect(calls).toHaveLength(1);

      answerAll();
      expect(await first).toMatchObject({ attempted: 1, sent: 1 });
      expect(calls).toHaveLength(1);
      expect(membership).toMatchObject({
        ended: true,
        endReason: 'released_qaed',
      });
      expect(world.audits.map((a) => a.action)).toEqual(['release_sent']);
    });
  });

  describe('a lease that runs out during a slow round (FR-18, NFR-3)', () => {
    it('sends each row once: the first batch takes longer than the lease, a second dispatcher starts during the second send', async () => {
      const { world, clock, queue } = setup();
      const calls: FeedReleaseQuery[] = [];
      const resolvers: Array<() => void> = [];
      const feed = {
        release: (q: FeedReleaseQuery) => {
          calls.push(q);
          if (calls.length === 1) {
            // Reporting is slow: the first batch uses 40 s.
            clock.now = new Date(clock.now.getTime() + 40_000);
            return Promise.resolve(releasedAll(q));
          }
          return new Promise<FeedRelease>((resolve) => {
            resolvers.push(() => resolve(releasedAll(q)));
          });
        },
      } as unknown as ResultsFeed;
      const service = new ReleaseService(
        new InMemoryReleaseStore(world),
        feed,
        new InMemoryAssessmentUnitOfWork(world),
        () => clock.now,
        () => Promise.resolve(),
      );
      const early = queue('qaed', { phaseYear: 2025 });
      const late = queue('qaed', { phaseYear: 2026 });

      const first = service.dispatch();
      await vi.waitFor(() => expect(calls).toHaveLength(2));
      // 61 s after the start: any lease taken at the start has run out.
      clock.now = new Date(START.getTime() + 61_000);
      const second = await Promise.race([
        service.dispatch(),
        sleep(100).then(() => 'hung' as const),
      ]);

      expect(second).toEqual({
        attempted: 0,
        sent: 0,
        refused: 0,
        stillPending: 0,
      });
      expect(calls.map((q) => q.phaseYear)).toEqual([2025, 2026]);

      for (const resolve of resolvers.splice(0)) resolve();
      expect(await first).toMatchObject({ attempted: 2, sent: 2 });
      expect(early).toMatchObject({ ended: true });
      expect(late).toMatchObject({ ended: true });
      expect(world.audits.map((a) => a.action)).toEqual([
        'release_sent',
        'release_sent',
      ]);
    });

    it('keeps the worst-case time of one send below the lease', () => {
      expect(WORST_CASE_SEND_MS).toBeLessThan(RELEASE_LEASE_MS);
      // 3 tries of the 10 s feed timeout, plus 1 s and 4 s waits spread 20 % up.
      expect(WORST_CASE_SEND_MS).toBe(3 * 10_000 + 5_000 * 1.2);
    });
  });

  describe('hardening of the claim (T-14)', () => {
    /** The pool wait before the claim's transaction: the clock moves between the service's decision and the transaction's first statement. */
    const slowPool = (waitMs: number) => (
      store: InMemoryReleaseStore,
      clock: { now: Date },
    ): ReleaseStore => ({
      list: (status) => store.list(status),
      claimDue: (...args) => {
        clock.now = new Date(clock.now.getTime() + waitMs);
        return store.claimDue(...args);
      },
    });
    /** Time that passes AFTER the claim committed and before the send starts (a slow ack of the previous round, a busy event loop). */
    const lateAfterClaim = (lateMs: number) => (
      store: InMemoryReleaseStore,
      clock: { now: Date },
    ): ReleaseStore => ({
      list: (status) => store.list(status),
      claimDue: async (...args) => {
        const rows = await store.claimDue(...args);
        clock.now = new Date(clock.now.getTime() + lateMs);
        return rows;
      },
    });

    it('measures the lease from the clock read INSIDE the claim, after a pool wait', async () => {
      const { world, feed, service, queue, row } = setup(slowPool(30_000));
      const membership = queue('qaed');
      feed.script('release', releasedAll);

      await service.dispatch();

      // The service decided at START; the transaction began 30 s later: the lease runs from there.
      expect(world.metaOf(row(membership)).leaseUntil).toEqual(
        new Date(START.getTime() + 30_000 + RELEASE_LEASE_MS),
      );
    });

    it('sends when exactly the worst-case send still fits in the lease', async () => {
      const { feed, service, queue, row } = setup(
        lateAfterClaim(RELEASE_LEASE_MS - WORST_CASE_SEND_MS),
      );
      const membership = queue('qaed');
      feed.script('release', releasedAll);

      await service.dispatch();

      expect(feed.callsOf('release')).toHaveLength(1);
      expect(row(membership).status).toBe('sent');
    });

    it('skips a claimed batch whose lease can no longer cover a worst-case send: nothing is sent, the rows stay pending and the next dispatch after the lease sends them', async () => {
      const { world, clock, feed, service, queue, row } = setup(
        lateAfterClaim(RELEASE_LEASE_MS - WORST_CASE_SEND_MS + 1),
      );
      const membership = queue('qaed');
      feed.script('release', releasedAll);
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});

      const result = await service.dispatch();

      expect(feed.callsOf('release')).toHaveLength(0);
      expect(result).toEqual({
        attempted: 1,
        sent: 0,
        refused: 0,
        stillPending: 1,
      });
      expect(row(membership).status).toBe('pending');
      expect(JSON.parse(String(warn.mock.calls[0]![0]))).toEqual({
        event: 'assessment_release',
        outcome: 'lease_short',
        phaseYear: 2026,
        rows: 1,
      });
      warn.mockRestore();

      // The lease runs out and the row is due again.
      clock.now = new Date(START.getTime() + 2 * RELEASE_LEASE_MS);
      const later = await new ReleaseService(
        new InMemoryReleaseStore(world),
        feed,
        new InMemoryAssessmentUnitOfWork(world),
        () => clock.now,
      ).dispatch();
      expect(later.sent).toBe(1);
      expect(row(membership).status).toBe('sent');
    });

    it('takes the feed timeout from the one the feed client uses, not a copy', () => {
      expect(WORST_CASE_SEND_MS).toBe(3 * CATALOG_TIMEOUT_MS + 5_000 * 1.2);
    });

    it('tries the next due phase year when every row of the oldest year is locked by another dispatcher', async () => {
      const { world, feed, service, queue, row } = setup();
      const old = queue('qaed', { phaseYear: 2025 });
      const current = queue('qaed', { phaseYear: 2026 });
      feed.script('release', releasedAll);
      // Another dispatcher holds the 2025 row (`SKIP LOCKED` leaves it out).
      world.lockedReleaseIds.add(world.metaOf(row(old)).id);

      const result = await service.dispatch();

      expect(feed.callsOf('release')).toHaveLength(1);
      expect(feed.callsOf('release')[0]!.phaseYear).toBe(2026);
      expect(result.sent).toBe(1);
      expect(row(current).status).toBe('sent');
      // The locked row was neither sent nor leased by this dispatch.
      expect(row(old).status).toBe('pending');
      expect(world.metaOf(row(old))).toMatchObject({
        attempts: 0,
        leaseUntil: null,
      });
    });
  });

  describe('the fake claims as MySQL does (T-14)', () => {
    it('applies the limit BEFORE the result-id dedupe, so a duplicate inside the limit leaves a shorter batch', async () => {
      const { world, queue } = setup();
      queue('qaed', { resultId: 7001 });
      queue('not_qaed', { resultId: 7001 });
      queue('qaed', { resultId: 7003 });

      const rows = await new InMemoryReleaseStore(world).claimDue(
        () => START,
        RELEASE_LEASE_MS,
        2,
      );

      // `limit 2` reads rows 1 and 2; they share a result id, so one is kept. Row 3 waits for the next claim.
      expect(rows.map((r) => r.resultId)).toEqual([7001]);
    });

    it('stops counting attempts at 255 (a tinyint)', async () => {
      const { world, queue, row } = setup();
      const membership = queue('qaed');
      world.metaOf(row(membership)).attempts = 255;

      const rows = await new InMemoryReleaseStore(world).claimDue(
        () => START,
        RELEASE_LEASE_MS,
        50,
      );

      expect(rows[0]!.attempts).toBe(255);
      expect(world.metaOf(row(membership)).attempts).toBe(255);
    });
  });

  describe('the log line (FR-21, NFR-5)', () => {
    let lines: Array<Record<string, unknown>>;
    beforeEach(() => {
      lines = [];
      for (const level of ['log', 'warn', 'error'] as const) {
        vi.spyOn(Logger.prototype, level).mockImplementation(
          (line: unknown) => {
            lines.push(JSON.parse(String(line)) as Record<string, unknown>);
          },
        );
      }
    });
    afterEach(() => vi.restoreAllMocks());

    it('is event assessment_release and carries ids and a reason word only', async () => {
      const { feed, service, queue } = setup();
      queue('qaed');
      queue('qaed');
      feed.script('release', (q: FeedReleaseQuery) => ({
        phaseYear: q.phaseYear,
        released: [
          { resultId: q.items[0]!.resultId, resultCode: 1, outcome: 'qaed' },
        ],
        notReleased: [
          {
            resultId: q.items[1]!.resultId,
            resultCode: 2,
            reason: 'not_submitted',
          },
        ],
      }));

      await service.dispatch();

      expect(lines.map((l) => l.event)).toEqual([
        'assessment_release',
        'assessment_release',
      ]);
      expect(lines).toEqual([
        {
          event: 'assessment_release',
          outcome: 'sent',
          releaseId: 500,
          assessmentId: 101,
        },
        {
          event: 'assessment_release',
          outcome: 'refused',
          releaseId: 501,
          assessmentId: 102,
          reason: 'not_submitted',
        },
      ]);
    });

    it('names a failed send by phase year, the kind of failure and the row count, never a body or a message', async () => {
      const { feed, service, queue } = setup();
      queue('qaed');
      feed.script('release', unavailable());

      await service.dispatch();

      expect(lines).toEqual([
        {
          event: 'assessment_release',
          outcome: 'send_failed',
          phaseYear: 2026,
          kind: 'unavailable',
          rows: 1,
        },
      ]);
    });
  });
});
