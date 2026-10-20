import type {
  IdempotencyClock,
  IdempotencyRow,
  IdempotencyStore,
  Reservation,
  ReserveInput,
  ReserveOutcome,
  StoredAnswer,
} from '../../src/common/idempotency/idempotency.store.js';
import {
  IDEMPOTENCY_LEASE_MS,
  IDEMPOTENCY_PURGE_BATCH,
  IDEMPOTENCY_RETENTION_MS,
} from '../../src/common/idempotency/idempotency.store.js';
import { IdempotencyFenceLostError } from '../../src/common/idempotency/idempotency.errors.js';

/** A controllable clock for lease and retention tests. */
export class FakeClock {
  constructor(private current = new Date('2026-10-20T10:00:00.000Z')) {}
  readonly now: IdempotencyClock = () => new Date(this.current);
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

/** Lets other pending work run: the statement boundary of a real database round trip. */
export const roundTrip = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

const rowId = (actorId: number, key: string) => `${actorId}\u0000${key}`;

/**
 * In-memory `IdempotencyStore` (the core T-4 fake pattern for this table).
 *
 * What it emulates: the primary key (`actor_id`, `idem_key`, exact and
 * case-sensitive, like ascii_bin) raising a duplicate on a second insert, and
 * every conditional UPDATE/DELETE being ONE atomic compare-and-set evaluated
 * when it is applied, not when it was issued. Each statement first waits a
 * round trip (`roundTrip`), so racing callers interleave between their
 * statements exactly as separate connections do; only the single statement is
 * atomic. It does NOT serialize whole operations, so a flow that reads then
 * writes without a conditional write races here as it would on MySQL.
 *
 * What it does not emulate: row locks held by an open business transaction
 * (T-4 extends `InMemoryDatabase` for that) and real MySQL (P-12, T-8).
 */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly table = new Map<string, IdempotencyRow>();
  private failure: Error | undefined;
  private tokens = 0;
  /** Count of statements that changed a row (for "executes nothing" checks). */
  writes = 0;

  constructor(
    private readonly clock: IdempotencyClock,
    private readonly newToken: () => string = () => `token-${++this.tokens}`,
  ) {}

  /** The next statement fails with `error` (the database is down). */
  failNext(error: Error): void {
    this.failure = error;
  }

  /** Test-only raw read of a row, whoever owns it. */
  peek(actorId: number, key: string): IdempotencyRow | undefined {
    const row = this.table.get(rowId(actorId, key));
    return row && structuredClone(row);
  }

  /** Test-only insert of a row as it would exist after earlier traffic. */
  seed(row: IdempotencyRow): void {
    this.table.set(rowId(row.actorId, row.idemKey), structuredClone(row));
  }

  private async statement<T>(apply: () => T): Promise<T> {
    await roundTrip();
    if (this.failure) {
      const error = this.failure;
      this.failure = undefined;
      throw error;
    }
    return apply();
  }

  async reserve(input: ReserveInput): Promise<ReserveOutcome> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const ownerToken = this.newToken();
      const inserted = await this.statement(() => {
        const id = rowId(input.actorId, input.key);
        if (this.table.has(id)) return false;
        const now = this.clock();
        this.table.set(id, {
          actorId: input.actorId,
          idemKey: input.key,
          fingerprint: input.fingerprint,
          state: 'in_progress',
          ownerToken,
          leaseUntil: new Date(now.getTime() + IDEMPOTENCY_LEASE_MS),
          routeStatus: input.routeStatus,
          targetUserId: null,
          responseStatus: null,
          responseBody: null,
          createdAt: now,
          expiresAt: new Date(now.getTime() + IDEMPOTENCY_RETENTION_MS),
        });
        this.writes++;
        return true;
      });
      if (inserted) {
        return {
          kind: 'reserved',
          reservation: { actorId: input.actorId, key: input.key, ownerToken },
        };
      }
      const existing = await this.find(input.actorId, input.key);
      if (!existing) continue;
      if (existing.expiresAt.getTime() > this.clock().getTime()) {
        return { kind: 'existing', row: existing };
      }
      await this.statement(() => {
        const current = this.table.get(rowId(input.actorId, input.key));
        if (
          current &&
          current.ownerToken === existing.ownerToken &&
          current.expiresAt.getTime() <= this.clock().getTime()
        ) {
          this.table.delete(rowId(input.actorId, input.key));
          this.writes++;
        }
      });
    }
    throw new Error('Could not reserve the idempotency key');
  }

  async find(actorId: number, key: string) {
    return this.statement(() => this.peek(actorId, key));
  }

  async takeOver(actorId: number, key: string, expectedOwnerToken: string) {
    const ownerToken = this.newToken();
    // The caller's clock is read when it issues the statement, as the adapter
    // does, so racers on instances with different clocks race faithfully.
    const now = this.clock();
    return this.statement(() => {
      const row = this.table.get(rowId(actorId, key));
      if (
        !row ||
        row.state !== 'in_progress' ||
        row.ownerToken !== expectedOwnerToken ||
        row.leaseUntil.getTime() > now.getTime()
      ) {
        return undefined;
      }
      row.ownerToken = ownerToken;
      row.leaseUntil = new Date(now.getTime() + IDEMPOTENCY_LEASE_MS);
      this.writes++;
      return { actorId, key, ownerToken };
    });
  }

  async markExecuted(reservation: Reservation, targetUserId: number) {
    const changed = await this.statement(() => {
      const row = this.table.get(rowId(reservation.actorId, reservation.key));
      if (
        !row ||
        row.state !== 'in_progress' ||
        row.ownerToken !== reservation.ownerToken
      ) {
        return false;
      }
      row.state = 'executed';
      row.targetUserId = targetUserId;
      this.writes++;
      return true;
    });
    if (!changed) throw new IdempotencyFenceLostError();
  }

  async complete(reservation: Reservation, answer: StoredAnswer) {
    return this.statement(() => {
      const row = this.table.get(rowId(reservation.actorId, reservation.key));
      if (
        !row ||
        row.state === 'completed' ||
        row.ownerToken !== reservation.ownerToken
      ) {
        return false;
      }
      row.state = 'completed';
      row.responseStatus = answer.status;
      row.responseBody = structuredClone(answer.body);
      this.writes++;
      return true;
    });
  }

  async release(reservation: Reservation) {
    return this.statement(() => {
      const id = rowId(reservation.actorId, reservation.key);
      const row = this.table.get(id);
      if (
        !row ||
        row.state !== 'in_progress' ||
        row.ownerToken !== reservation.ownerToken
      ) {
        return false;
      }
      this.table.delete(id);
      this.writes++;
      return true;
    });
  }

  async purgeExpired(limit = IDEMPOTENCY_PURGE_BATCH) {
    return this.statement(() => {
      const now = this.clock().getTime();
      const expired = [...this.table.entries()]
        .filter(([, row]) => row.expiresAt.getTime() <= now)
        .sort(([, a], [, b]) => a.expiresAt.getTime() - b.expiresAt.getTime())
        .slice(0, limit);
      for (const [id] of expired) this.table.delete(id);
      this.writes += expired.length;
      return expired.length;
    });
  }
}
