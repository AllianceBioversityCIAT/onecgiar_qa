import { Test } from '@nestjs/testing';
import { drizzle } from 'drizzle-orm/mysql2';
import { describe, expect, it } from 'vitest';
import { DRIZZLE } from '../../database/drizzle/drizzle.constants.js';
import * as schema from '../../database/drizzle/schema/index.js';
import {
  FakeClock,
  InMemoryIdempotencyStore,
} from '../../../test/support/in-memory-idempotency.js';
import { SqlDriver } from '../../../test/support/idempotency-sql-driver.js';
import { IdempotencyFenceLostError } from './idempotency.errors.js';
import {
  DrizzleIdempotencyStore,
  IDEMPOTENCY_LEASE_MS,
  IDEMPOTENCY_PURGE_BATCH,
  IDEMPOTENCY_CLOCK,
  IDEMPOTENCY_RETENTION_MS,
  type IdempotencyStore,
  type Reservation,
  type ReserveInput,
} from './idempotency.store.js';

// Expected values are written out (not derived from the constants under test):
// the lease is 120 s and retention 24 h (design 9, DD-3), the clock starts at
// 2026-10-20T10:00:00Z.
const LEASE_END = '2026-10-20T10:02:00.000Z';
const RETENTION_END = '2026-10-21T10:00:00.000Z';
const LEASE_MS = 120_000;
const DAY_MS = 86_400_000;

interface RowView {
  state: string;
  ownerToken: string;
  fingerprint: string;
  leaseUntil: string;
  expiresAt: string;
  routeStatus: number;
  targetUserId: number | null;
  responseStatus: number | null;
  responseBody: unknown;
}

interface Harness {
  store: IdempotencyStore;
  clock: FakeClock;
  /** Raw row as the backend holds it, bypassing the store's own lookup. */
  peek(actorId: number, key: string): RowView | undefined;
  failNext(error: Error): void;
  /** Statements the SQL backend saw; empty for the in-memory fake. */
  statements: Array<{ sql: string; values: unknown[] }>;
}

const sqlDate = (value: unknown) =>
  new Date(`${String(value).replace(' ', 'T')}Z`).toISOString();

function inMemory(): Harness {
  const clock = new FakeClock();
  const store = new InMemoryIdempotencyStore(clock.now);
  return {
    store,
    clock,
    statements: [],
    failNext: (error) => store.failNext(error),
    peek(actorId, key) {
      const row = store.peek(actorId, key);
      return (
        row && {
          state: row.state,
          ownerToken: row.ownerToken,
          fingerprint: row.fingerprint,
          leaseUntil: row.leaseUntil.toISOString(),
          expiresAt: row.expiresAt.toISOString(),
          routeStatus: row.routeStatus,
          targetUserId: row.targetUserId,
          responseStatus: row.responseStatus,
          responseBody: row.responseBody,
        }
      );
    },
  };
}

function overSql(): Harness {
  const clock = new FakeClock();
  const driver = new SqlDriver();
  const db = drizzle({ client: driver as never, schema, mode: 'default' });
  let tokens = 0;
  const store = new DrizzleIdempotencyStore(
    db,
    clock.now,
    () => `token-${++tokens}`,
  );
  return {
    store,
    clock,
    statements: driver.statements,
    failNext: (error) => driver.failNext(error),
    peek(actorId, key) {
      const raw = driver.raw(actorId, key);
      return (
        raw && {
          state: raw['state'] as string,
          ownerToken: raw['owner_token'] as string,
          fingerprint: raw['fingerprint'] as string,
          leaseUntil: sqlDate(raw['lease_until']),
          expiresAt: sqlDate(raw['expires_at']),
          routeStatus: raw['route_status'] as number,
          targetUserId: (raw['target_user_id'] as number | null) ?? null,
          responseStatus: (raw['response_status'] as number | null) ?? null,
          responseBody:
            raw['response_body'] == null
              ? null
              : JSON.parse(raw['response_body'] as string),
        }
      );
    },
  };
}

// Drizzle wraps a driver failure in a DrizzleQueryError whose `cause` is the
// driver's error: the failure must surface, wrapped or not, never be swallowed.
const causes = (error: unknown): unknown[] => {
  const chain: unknown[] = [];
  for (let e = error; e !== undefined && chain.length < 5;) {
    chain.push(e);
    e = (e as { cause?: unknown } | undefined)?.cause;
  }
  return chain;
};

const FP = 'a'.repeat(64);
const input = (over: Partial<ReserveInput> = {}): ReserveInput => ({
  actorId: 1,
  key: 'key-1',
  fingerprint: FP,
  routeStatus: 201,
  ...over,
});

async function reserved(
  h: Harness,
  over: Partial<ReserveInput> = {},
): Promise<Reservation> {
  const out = await h.store.reserve(input(over));
  if (out.kind !== 'reserved') throw new Error('expected a fresh reservation');
  return out.reservation;
}

// The same behavior is required of the in-memory fake (what T-3/T-4 build on)
// and of the real Drizzle adapter, whose generated SQL runs against the
// SQL-executing driver stub.
describe.each([
  ['in-memory fake', inMemory],
  ['Drizzle adapter over the SQL-executing driver', overSql],
])('IdempotencyStore: %s', (_name, build) => {
  describe('reserve (FR-2, FR-5)', () => {
    it('a new key is reserved in_progress with a fresh owner token, a 120 s lease and 24 h retention', async () => {
      const h = build();

      const out = await h.store.reserve(input({ routeStatus: 201 }));

      expect(out).toEqual({
        kind: 'reserved',
        reservation: { actorId: 1, key: 'key-1', ownerToken: 'token-1' },
      });
      expect(h.peek(1, 'key-1')).toEqual({
        state: 'in_progress',
        ownerToken: 'token-1',
        fingerprint: FP,
        leaseUntil: LEASE_END,
        expiresAt: RETENTION_END,
        routeStatus: 201,
        targetUserId: null,
        responseStatus: null,
        responseBody: null,
      });
    });

    it('a duplicate returns the existing row and changes nothing', async () => {
      const h = build();
      await reserved(h);
      const before = h.peek(1, 'key-1');

      const again = await h.store.reserve(input({ routeStatus: 200 }));

      expect(again.kind).toBe('existing');
      if (again.kind !== 'existing') return;
      expect(again.row).toMatchObject({
        actorId: 1,
        idemKey: 'key-1',
        state: 'in_progress',
        ownerToken: 'token-1',
        fingerprint: FP,
        routeStatus: 201,
      });
      expect(h.peek(1, 'key-1')).toEqual(before);
    });

    it('a duplicate with another fingerprint still returns the stored row, not the new one (the caller decides, FR-4)', async () => {
      const h = build();
      await reserved(h);

      const again = await h.store.reserve(
        input({ fingerprint: 'b'.repeat(64) }),
      );

      expect(again.kind).toBe('existing');
      if (again.kind === 'existing') expect(again.row.fingerprint).toBe(FP);
      expect(h.peek(1, 'key-1')?.fingerprint).toBe(FP);
    });

    it('two concurrent reserves of one new key: exactly one wins, the other sees the winner', async () => {
      const h = build();

      const [a, b, c] = await Promise.all([
        h.store.reserve(input()),
        h.store.reserve(input()),
        h.store.reserve(input()),
      ]);

      const outcomes = [a, b, c];
      const winners = outcomes.filter((o) => o.kind === 'reserved');
      expect(winners).toHaveLength(1);
      const winner = winners[0];
      if (winner?.kind !== 'reserved') throw new Error('unreachable');
      for (const o of outcomes.filter((o) => o.kind === 'existing')) {
        expect(o.row.ownerToken).toBe(winner.reservation.ownerToken);
      }
    });

    it('keys are case-sensitive: two keys differing only by case are two reservations', async () => {
      const h = build();
      await reserved(h, { key: 'Abc' });

      const other = await h.store.reserve(input({ key: 'abc' }));

      expect(other.kind).toBe('reserved');
    });
  });

  describe('scope per admin (FR-6, FR-9)', () => {
    it("another admin with the same key reserves a fresh row and never sees the first admin's", async () => {
      const h = build();
      const first = await reserved(h, { actorId: 1 });
      await h.store.markExecuted(first, 77);
      await h.store.complete(first, { status: 201, body: { id: 77 } });

      const second = await h.store.reserve(input({ actorId: 2 }));

      expect(second.kind).toBe('reserved');
      expect(h.peek(2, 'key-1')?.state).toBe('in_progress');
      expect(h.peek(2, 'key-1')?.responseBody).toBeNull();
      expect(h.peek(1, 'key-1')?.responseBody).toEqual({ id: 77 });
    });

    it("find returns only the asking admin's row", async () => {
      const h = build();
      await reserved(h, { actorId: 1 });

      expect(await h.store.find(2, 'key-1')).toBeUndefined();
      expect(await h.store.find(1, 'key-1')).toMatchObject({ actorId: 1 });
    });

    it("another admin cannot mark, complete, release or take over the first admin's key, even holding its token", async () => {
      const h = build();
      const mine = await reserved(h, { actorId: 1 });
      const stolen: Reservation = { ...mine, actorId: 2 };
      h.clock.advance(LEASE_MS);
      const before = h.peek(1, 'key-1');

      await expect(h.store.markExecuted(stolen, 9)).rejects.toBeInstanceOf(
        IdempotencyFenceLostError,
      );
      expect(await h.store.complete(stolen, { status: 200, body: {} })).toBe(
        false,
      );
      expect(await h.store.release(stolen)).toBe(false);
      expect(
        await h.store.takeOver(2, 'key-1', mine.ownerToken),
      ).toBeUndefined();
      expect(h.peek(1, 'key-1')).toEqual(before);
    });
  });

  describe('take-over of an abandoned key (FR-5, DD-3)', () => {
    it('is refused while the lease is valid', async () => {
      const h = build();
      const owner = await reserved(h);
      h.clock.advance(LEASE_MS - 1);
      const before = h.peek(1, 'key-1');

      expect(
        await h.store.takeOver(1, 'key-1', owner.ownerToken),
      ).toBeUndefined();
      expect(h.peek(1, 'key-1')).toEqual(before);
    });

    it('succeeds once the lease has expired: new owner token, lease renewed from now', async () => {
      const h = build();
      const owner = await reserved(h);
      h.clock.advance(LEASE_MS);

      const taken = await h.store.takeOver(1, 'key-1', owner.ownerToken);

      expect(taken).toEqual({
        actorId: 1,
        key: 'key-1',
        ownerToken: 'token-2',
      });
      expect(h.peek(1, 'key-1')).toMatchObject({
        state: 'in_progress',
        ownerToken: 'token-2',
        leaseUntil: '2026-10-20T10:04:00.000Z',
        fingerprint: FP,
      });
    });

    it('is refused with a token that is not the one on the row', async () => {
      const h = build();
      await reserved(h);
      h.clock.advance(LEASE_MS);

      expect(
        await h.store.takeOver(1, 'key-1', 'not-the-owner'),
      ).toBeUndefined();
      expect(h.peek(1, 'key-1')?.ownerToken).toBe('token-1');
    });

    it('is refused on an executed or completed row even when its lease is long gone', async () => {
      const h = build();
      const executed = await reserved(h, { key: 'executed' });
      await h.store.markExecuted(executed, 5);
      const done = await reserved(h, { key: 'done' });
      await h.store.complete(done, { status: 409, body: { code: 'X' } });
      h.clock.advance(LEASE_MS * 10);

      expect(
        await h.store.takeOver(1, 'executed', executed.ownerToken),
      ).toBeUndefined();
      expect(
        await h.store.takeOver(1, 'done', done.ownerToken),
      ).toBeUndefined();
      expect(h.peek(1, 'executed')?.state).toBe('executed');
      expect(h.peek(1, 'done')?.state).toBe('completed');
    });

    it('is refused when there is no row', async () => {
      const h = build();
      expect(await h.store.takeOver(1, 'ghost', 'token-x')).toBeUndefined();
    });

    it.each([2, 5])(
      '%i concurrent take-overs of one expired key: exactly one wins',
      async (racers) => {
        const h = build();
        const owner = await reserved(h);
        h.clock.advance(LEASE_MS);

        const results = await Promise.all(
          Array.from({ length: racers }, () =>
            h.store.takeOver(1, 'key-1', owner.ownerToken),
          ),
        );

        const winners = results.filter((r) => r !== undefined);
        expect(winners).toHaveLength(1);
        expect(h.peek(1, 'key-1')?.ownerToken).toBe(winners[0]?.ownerToken);
      },
    );

    it('a stale token cannot take over a key that was already taken over, even after the new lease expired too', async () => {
      const h = build();
      const stalled = await reserved(h);
      h.clock.advance(LEASE_MS);
      const second = await h.store.takeOver(1, 'key-1', stalled.ownerToken);
      expect(second).toBeDefined();
      h.clock.advance(LEASE_MS); // the second owner's lease ran out as well

      const late = await h.store.takeOver(1, 'key-1', stalled.ownerToken);

      expect(late).toBeUndefined();
      expect(h.peek(1, 'key-1')?.ownerToken).toBe(second?.ownerToken);
    });

    it('two take-overs racing from instances whose clocks are a lease apart: exactly one wins (the token is the compare)', async () => {
      const h = build();
      const owner = await reserved(h);
      h.clock.advance(LEASE_MS);

      const first = h.store.takeOver(1, 'key-1', owner.ownerToken);
      h.clock.advance(LEASE_MS); // the second caller's clock is 120 s ahead
      const second = h.store.takeOver(1, 'key-1', owner.ownerToken);

      const results = await Promise.all([first, second]);
      expect(results.filter((r) => r !== undefined)).toHaveLength(1);
    });

    it('the old owner is fenced out after a take-over: it cannot mark, complete or release', async () => {
      const h = build();
      const stalled = await reserved(h);
      h.clock.advance(LEASE_MS);
      const winner = await h.store.takeOver(1, 'key-1', stalled.ownerToken);
      expect(winner).toBeDefined();

      await expect(h.store.markExecuted(stalled, 5)).rejects.toBeInstanceOf(
        IdempotencyFenceLostError,
      );
      expect(await h.store.complete(stalled, { status: 201, body: {} })).toBe(
        false,
      );
      expect(await h.store.release(stalled)).toBe(false);
      expect(h.peek(1, 'key-1')).toMatchObject({
        state: 'in_progress',
        ownerToken: winner?.ownerToken,
        targetUserId: null,
      });
    });

    it.each([
      ['markExecuted first in the queue', 'mark-first'],
      ['takeOver first in the queue', 'take-first'],
    ])(
      'the original owner committing and a take-over racing: exactly one of them wins (%s)',
      async (_label, order) => {
        const h = build();
        const owner = await reserved(h);
        h.clock.advance(LEASE_MS);
        const mark = () =>
          h.store.markExecuted(owner, 5).then(
            () => 'marked' as const,
            () => 'fenced' as const,
          );
        const take = () =>
          h.store
            .takeOver(1, 'key-1', owner.ownerToken)
            .then((r) => (r ? ('taken' as const) : ('refused' as const)));

        const results =
          order === 'mark-first'
            ? await Promise.all([mark(), take()])
            : (await Promise.all([take(), mark()])).reverse();

        const [marked, taken] = results as [
          'marked' | 'fenced',
          'taken' | 'refused',
        ];
        expect(
          (marked === 'marked') !== (taken === 'taken'),
          `mark=${marked} take=${taken}`,
        ).toBe(true);
      },
    );
  });

  describe('markExecuted: the exactly-once fence (DD-2, DD-3)', () => {
    it('moves in_progress to executed for the owner and records the target user', async () => {
      const h = build();
      const owner = await reserved(h);

      await h.store.markExecuted(owner, 42);

      expect(h.peek(1, 'key-1')).toMatchObject({
        state: 'executed',
        targetUserId: 42,
        ownerToken: owner.ownerToken,
      });
    });

    it.each([
      [
        "a token that is not the owner's",
        async (h: Harness, o: Reservation) => ({ ...o, ownerToken: 'other' }),
      ],
      [
        'a row that is already executed',
        async (h: Harness, o: Reservation) => {
          await h.store.markExecuted(o, 1);
          return o;
        },
      ],
      [
        'a row that is already completed',
        async (h: Harness, o: Reservation) => {
          await h.store.complete(o, { status: 409, body: {} });
          return o;
        },
      ],
      [
        'a row that was released',
        async (h: Harness, o: Reservation) => {
          await h.store.release(o);
          return o;
        },
      ],
    ])(
      'matching no row (%s) throws the typed fence error and changes nothing',
      async (_label, prepare) => {
        const h = build();
        const owner = await reserved(h);
        const attempt = await prepare(h, owner);
        const before = h.peek(1, 'key-1');

        await expect(h.store.markExecuted(attempt, 99)).rejects.toBeInstanceOf(
          IdempotencyFenceLostError,
        );
        expect(h.peek(1, 'key-1')).toEqual(before);
      },
    );

    it('an expired-but-not-taken-over lease can still mark (fencing is by token, not by clock)', async () => {
      const h = build();
      const owner = await reserved(h);
      h.clock.advance(LEASE_MS * 5);

      await h.store.markExecuted(owner, 7);

      expect(h.peek(1, 'key-1')?.state).toBe('executed');
    });
  });

  describe('complete and release belong to the owner (FR-2, DD-5)', () => {
    it('complete stores the answer after execution', async () => {
      const h = build();
      const owner = await reserved(h);
      await h.store.markExecuted(owner, 42);

      const done = await h.store.complete(owner, {
        status: 201,
        body: { id: 42, email: 'a@b.org' },
      });

      expect(done).toBe(true);
      expect(h.peek(1, 'key-1')).toMatchObject({
        state: 'completed',
        responseStatus: 201,
        responseBody: { id: 42, email: 'a@b.org' },
        targetUserId: 42,
      });
    });

    it('complete stores a refusal straight from in_progress (nothing was executed)', async () => {
      const h = build();
      const owner = await reserved(h);

      const done = await h.store.complete(owner, {
        status: 409,
        body: { code: 'USERS_LAST_ADMIN' },
      });

      expect(done).toBe(true);
      expect(h.peek(1, 'key-1')).toMatchObject({
        state: 'completed',
        responseStatus: 409,
        responseBody: { code: 'USERS_LAST_ADMIN' },
        targetUserId: null,
      });
    });

    it('complete by anyone but the owner changes nothing', async () => {
      const h = build();
      const owner = await reserved(h);
      const before = h.peek(1, 'key-1');

      const done = await h.store.complete(
        { ...owner, ownerToken: 'intruder' },
        { status: 200, body: { hijacked: true } },
      );

      expect(done).toBe(false);
      expect(h.peek(1, 'key-1')).toEqual(before);
    });

    it('a stored answer is never overwritten by a second complete', async () => {
      const h = build();
      const owner = await reserved(h);
      await h.store.complete(owner, { status: 201, body: { first: true } });

      const again = await h.store.complete(owner, {
        status: 500,
        body: { second: true },
      });

      expect(again).toBe(false);
      expect(h.peek(1, 'key-1')?.responseBody).toEqual({ first: true });
    });

    it('release deletes an in_progress row of the owner, and the key is free again', async () => {
      const h = build();
      const owner = await reserved(h);

      expect(await h.store.release(owner)).toBe(true);
      expect(h.peek(1, 'key-1')).toBeUndefined();
      expect((await h.store.reserve(input())).kind).toBe('reserved');
    });

    it('release by anyone but the owner keeps the row', async () => {
      const h = build();
      const owner = await reserved(h);

      expect(await h.store.release({ ...owner, ownerToken: 'intruder' })).toBe(
        false,
      );
      expect(h.peek(1, 'key-1')?.state).toBe('in_progress');
    });

    it('release never deletes an executed row: the change is committed and a replay must find the mark', async () => {
      const h = build();
      const owner = await reserved(h);
      await h.store.markExecuted(owner, 3);

      expect(await h.store.release(owner)).toBe(false);
      expect(h.peek(1, 'key-1')?.state).toBe('executed');
    });

    it('release never deletes a completed row', async () => {
      const h = build();
      const owner = await reserved(h);
      await h.store.complete(owner, { status: 409, body: { code: 'X' } });

      expect(await h.store.release(owner)).toBe(false);
      expect(h.peek(1, 'key-1')?.state).toBe('completed');
    });
  });

  describe('retention (FR-7, FR-9, NFR-5)', () => {
    const reserveAt = async (h: Harness, key: string) => {
      await reserved(h, { key });
    };

    it('purge deletes only expired rows (expires_at <= now), oldest first, up to the batch limit', async () => {
      const h = build();
      await reserveAt(h, 'old-1');
      h.clock.advance(1_000);
      await reserveAt(h, 'old-2');
      h.clock.advance(1_000);
      await reserveAt(h, 'old-3');
      h.clock.advance(DAY_MS); // the three are now past retention
      await reserveAt(h, 'live-1');
      await reserveAt(h, 'live-2');

      const first = await h.store.purgeExpired(2);

      expect(first).toBe(2);
      expect(h.peek(1, 'old-1')).toBeUndefined();
      expect(h.peek(1, 'old-2')).toBeUndefined();
      expect(h.peek(1, 'old-3')).toBeDefined();
      const second = await h.store.purgeExpired(50);
      expect(second).toBe(1);
      expect(h.peek(1, 'old-3')).toBeUndefined();
      expect(h.peek(1, 'live-1')).toBeDefined();
      expect(h.peek(1, 'live-2')).toBeDefined();
      expect(await h.store.purgeExpired(50)).toBe(0);
    });

    it('a row exactly at its expiry is expired; one millisecond before is not', async () => {
      const h = build();
      await reserveAt(h, 'k');
      h.clock.advance(DAY_MS - 1);
      expect(await h.store.purgeExpired(50)).toBe(0);
      h.clock.advance(1);
      expect(await h.store.purgeExpired(50)).toBe(1);
    });

    it('purges expired rows of every state and every admin, but only expired ones', async () => {
      const h = build();
      const a = await reserved(h, { key: 'a', actorId: 1 });
      await h.store.markExecuted(a, 1);
      const b = await reserved(h, { key: 'b', actorId: 2 });
      await h.store.complete(b, { status: 200, body: {} });
      h.clock.advance(DAY_MS);
      await reserved(h, { key: 'fresh', actorId: 2 });

      expect(await h.store.purgeExpired(50)).toBe(2);
      expect(h.peek(1, 'a')).toBeUndefined();
      expect(h.peek(2, 'b')).toBeUndefined();
      expect(h.peek(2, 'fresh')).toBeDefined();
    });

    it('purge is bounded by default too: never more than the batch constant in one call', async () => {
      const h = build();
      const total = IDEMPOTENCY_PURGE_BATCH + 3;
      for (let i = 0; i < total; i++) await reserved(h, { key: `k${i}` });
      h.clock.advance(DAY_MS);

      expect(await h.store.purgeExpired()).toBe(50);
      expect(await h.store.purgeExpired()).toBe(3);
    });

    it('an expired row that was not purged yet behaves as a new key (FR-7), not as a replay', async () => {
      const h = build();
      await reserved(h);
      h.clock.advance(DAY_MS);

      const again = await h.store.reserve(
        input({ fingerprint: 'c'.repeat(64) }),
      );

      expect(again.kind).toBe('reserved');
      if (again.kind !== 'reserved') return;
      expect(again.reservation.ownerToken).not.toBe('token-1');
      expect(h.peek(1, 'key-1')).toMatchObject({
        ownerToken: again.reservation.ownerToken,
        state: 'in_progress',
        fingerprint: 'c'.repeat(64),
        expiresAt: '2026-10-22T10:00:00.000Z',
      });
    });

    it('two concurrent reserves over one expired row: exactly one wins', async () => {
      const h = build();
      await reserved(h);
      h.clock.advance(DAY_MS);

      const outcomes = await Promise.all([
        h.store.reserve(input()),
        h.store.reserve(input()),
      ]);

      expect(outcomes.filter((o) => o.kind === 'reserved')).toHaveLength(1);
      expect(outcomes.filter((o) => o.kind === 'existing')).toHaveLength(1);
    });

    it('the retention and lease constants are the designed values', () => {
      expect(IDEMPOTENCY_LEASE_MS).toBe(120_000);
      expect(IDEMPOTENCY_RETENTION_MS).toBe(86_400_000);
      expect(IDEMPOTENCY_PURGE_BATCH).toBe(50);
    });
  });

  describe('store errors surface (NFR-4)', () => {
    const down = Object.assign(new Error('connect ECONNREFUSED'), {
      code: 'ECONNREFUSED',
    });
    const owner: Reservation = {
      actorId: 1,
      key: 'key-1',
      ownerToken: 'token-1',
    };

    it.each([
      ['reserve', (s: IdempotencyStore) => s.reserve(input())],
      ['find', (s: IdempotencyStore) => s.find(1, 'key-1')],
      ['takeOver', (s: IdempotencyStore) => s.takeOver(1, 'key-1', 'token-1')],
      ['markExecuted', (s: IdempotencyStore) => s.markExecuted(owner, 1)],
      [
        'complete',
        (s: IdempotencyStore) => s.complete(owner, { status: 200, body: {} }),
      ],
      ['release', (s: IdempotencyStore) => s.release(owner)],
      ['purgeExpired', (s: IdempotencyStore) => s.purgeExpired(5)],
    ])(
      '%s rejects with the driver error and is not turned into a result',
      async (_op, run) => {
        const h = build();
        h.failNext(down);

        const error = await run(h.store).then(
          () => undefined,
          (e: unknown) => e,
        );
        expect(causes(error)).toContain(down);
      },
    );

    it('a failing insert is not read as a duplicate key', async () => {
      const h = build();
      h.failNext(
        Object.assign(new Error('deadlock'), {
          code: 'ER_LOCK_DEADLOCK',
          errno: 1213,
        }),
      );

      const error = await h.store.reserve(input()).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(
        causes(error).map((e) => (e as { errno?: number }).errno),
      ).toContain(1213);
      expect(h.peek(1, 'key-1')).toBeUndefined();
    });
  });
});

// The generated SQL itself (requirements 7: "SQL asserted"). These statements
// carry the guarantees, so each is pinned whole: the PK insert (a duplicate is
// MySQL's 1062, never a read-then-insert), the ownership test inside every
// conditional write, the actor in every lookup, and a bounded DELETE.
describe('DrizzleIdempotencyStore: generated SQL', () => {
  const T = '`idempotency_keys`';
  const COLUMNS =
    '`actor_id`, `idem_key`, `fingerprint`, `state`, `owner_token`, `lease_until`, `route_status`, `target_user_id`, `response_status`, `response_body`, `created_at`, `expires_at`';
  const owner: Reservation = { actorId: 4, key: 'k-1', ownerToken: 'tok-9' };

  function adapter() {
    const h = overSql();
    return { store: h.store, clock: h.clock, statements: h.statements };
  }
  const last = (s: Array<{ sql: string; values: unknown[] }>) =>
    s[s.length - 1]!;

  it('reserve is one plain INSERT on the primary key: no upsert, no pre-read', async () => {
    const { store, statements } = adapter();

    await store.reserve(input({ actorId: 4, key: 'k-1', routeStatus: 204 }));

    expect(statements).toHaveLength(1);
    expect(statements[0]).toEqual({
      sql: `insert into ${T} (${COLUMNS}) values (?, ?, ?, ?, ?, ?, ?, default, default, default, ?, ?)`,
      values: [
        4,
        'k-1',
        FP,
        'in_progress',
        'token-1',
        '2026-10-20 10:02:00.000',
        204,
        '2026-10-20 10:00:00.000',
        '2026-10-21 10:00:00.000',
      ],
    });
    expect(statements[0]!.sql).not.toMatch(/on duplicate key|ignore|replace/i);
  });

  it('after a duplicate, the lookup is keyed by actor and key and reads one row', async () => {
    const { store, statements } = adapter();
    await store.reserve(input({ actorId: 4, key: 'k-1' }));

    await store.reserve(input({ actorId: 4, key: 'k-1' }));

    expect(statements.map((s) => s.sql.split(' ')[0])).toEqual([
      'insert',
      'insert',
      'select',
    ]);
    expect(last(statements)).toEqual({
      sql: `select ${COLUMNS} from ${T} where (${T}.\`actor_id\` = ? and ${T}.\`idem_key\` = ?) limit ?`,
      values: [4, 'k-1', 1],
    });
  });

  it('find is the same actor-and-key SELECT', async () => {
    const { store, statements } = adapter();

    await store.find(4, 'k-1');

    expect(last(statements)).toEqual({
      sql: `select ${COLUMNS} from ${T} where (${T}.\`actor_id\` = ? and ${T}.\`idem_key\` = ?) limit ?`,
      values: [4, 'k-1', 1],
    });
  });

  it('take-over is one conditional UPDATE: actor, key, in_progress, the old owner token and an expired lease', async () => {
    const { store, clock, statements } = adapter();
    clock.advance(LEASE_MS);

    await store.takeOver(4, 'k-1', 'tok-9');

    expect(last(statements)).toEqual({
      sql: `update ${T} set \`owner_token\` = ?, \`lease_until\` = ? where (${T}.\`actor_id\` = ? and ${T}.\`idem_key\` = ? and ${T}.\`state\` = ? and ${T}.\`owner_token\` = ? and ${T}.\`lease_until\` <= ?)`,
      values: [
        'token-1',
        '2026-10-20 10:04:00.000',
        4,
        'k-1',
        'in_progress',
        'tok-9',
        '2026-10-20 10:02:00.000',
      ],
    });
  });

  it('markExecuted is one conditional UPDATE on actor, key, in_progress and the owner token', async () => {
    const { store, statements } = adapter();

    await store.markExecuted(owner, 11).catch(() => undefined);

    expect(last(statements)).toEqual({
      sql: `update ${T} set \`state\` = ?, \`target_user_id\` = ? where (${T}.\`actor_id\` = ? and ${T}.\`idem_key\` = ? and ${T}.\`state\` = ? and ${T}.\`owner_token\` = ?)`,
      values: ['executed', 11, 4, 'k-1', 'in_progress', 'tok-9'],
    });
  });

  it('complete is one conditional UPDATE on actor, key, the owner token and a not-yet-completed state', async () => {
    const { store, statements } = adapter();

    await store.complete(owner, { status: 201, body: { id: 11 } });

    expect(last(statements)).toEqual({
      sql: `update ${T} set \`state\` = ?, \`response_status\` = ?, \`response_body\` = ? where (${T}.\`actor_id\` = ? and ${T}.\`idem_key\` = ? and ${T}.\`owner_token\` = ? and ${T}.\`state\` in (?, ?))`,
      values: [
        'completed',
        201,
        '{"id":11}',
        4,
        'k-1',
        'tok-9',
        'in_progress',
        'executed',
      ],
    });
  });

  it('release is one DELETE on actor, key, the owner token and in_progress only', async () => {
    const { store, statements } = adapter();

    await store.release(owner);

    expect(last(statements)).toEqual({
      sql: `delete from ${T} where (${T}.\`actor_id\` = ? and ${T}.\`idem_key\` = ? and ${T}.\`state\` = ? and ${T}.\`owner_token\` = ?)`,
      values: [4, 'k-1', 'in_progress', 'tok-9'],
    });
  });

  it('purge is a bounded DELETE of expired rows, oldest first', async () => {
    const { store, clock, statements } = adapter();
    clock.advance(LEASE_MS);

    await store.purgeExpired(7);

    expect(last(statements)).toEqual({
      sql: `delete from ${T} where ${T}.\`expires_at\` <= ? order by ${T}.\`expires_at\` limit ?`,
      values: ['2026-10-20 10:02:00.000', 7],
    });
  });

  it('purge without a limit still carries the batch bound', async () => {
    const { store, statements } = adapter();

    await store.purgeExpired();

    expect(last(statements).sql).toMatch(/ limit \?$/);
    expect(last(statements).values.at(-1)).toBe(50);
  });

  it('dropping a stale row during reserve deletes only that exact row (actor, key, its token, expired)', async () => {
    const { store, clock, statements } = adapter();
    await store.reserve(input({ actorId: 4, key: 'k-1' }));
    clock.advance(DAY_MS);

    await store.reserve(input({ actorId: 4, key: 'k-1' }));

    const stale = statements.find((s) => s.sql.startsWith('delete'));
    expect(stale).toEqual({
      sql: `delete from ${T} where (${T}.\`actor_id\` = ? and ${T}.\`idem_key\` = ? and ${T}.\`owner_token\` = ? and ${T}.\`expires_at\` <= ?)`,
      values: [4, 'k-1', 'token-1', '2026-10-21 10:00:00.000'],
    });
  });
});

describe('DrizzleIdempotencyStore: dependency injection', () => {
  it('is built by Nest from DRIZZLE and IDEMPOTENCY_CLOCK alone (the token factory is optional)', async () => {
    const clock = new FakeClock();
    const driver = new SqlDriver();
    const db = drizzle({ client: driver as never, schema, mode: 'default' });
    const moduleRef = await Test.createTestingModule({
      providers: [
        DrizzleIdempotencyStore,
        { provide: DRIZZLE, useValue: db },
        { provide: IDEMPOTENCY_CLOCK, useValue: clock.now },
      ],
    }).compile();

    const store = moduleRef.get(DrizzleIdempotencyStore);
    const outcome = await store.reserve({
      actorId: 1,
      key: 'key-1',
      fingerprint: 'f'.repeat(64),
      routeStatus: 201,
    });

    expect(outcome.kind).toBe('reserved');
    if (outcome.kind === 'reserved') {
      expect(outcome.reservation.ownerToken).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
  });
});
