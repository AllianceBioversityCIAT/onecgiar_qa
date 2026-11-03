import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { and, eq, inArray, lte } from 'drizzle-orm';
import { DRIZZLE } from '../../database/drizzle/drizzle.constants.js';
import type { DrizzleDB } from '../../database/drizzle/drizzle.module.js';
import {
  idempotencyKeys,
  type IdempotencyKey,
} from '../../database/drizzle/schema/idempotency-keys.js';
import {
  IdempotencyFenceLostError,
  isDuplicateKeyError,
} from './idempotency.errors.js';

export const IDEMPOTENCY_STORE = Symbol('IDEMPOTENCY_STORE');
export const IDEMPOTENCY_CLOCK = Symbol('IDEMPOTENCY_CLOCK');
/** Optional override of the owner-token generator (tests); defaults to `randomUUID`. */
export const IDEMPOTENCY_TOKEN_FACTORY = Symbol('IDEMPOTENCY_TOKEN_FACTORY');

/**
 * In-flight lease (DD-3): longer than the slowest write (~30 s cold create,
 * P-9) with margin. A constant, not an env var (design 9).
 */
export const IDEMPOTENCY_LEASE_MS = 120_000;
/** How long an answer is remembered (D2, FR-7). */
export const IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1000;
/** Expired rows one `purgeExpired` call may delete (NFR-5: bounded, never a table sweep). */
export const IDEMPOTENCY_PURGE_BATCH = 50;

// Bounded retries of the reserve insert: a duplicate whose row was deleted
// (released, purged) before it could be read, or an expired row swept away.
const RESERVE_ATTEMPTS = 3;

export type IdempotencyClock = () => Date;
export type IdempotencyRow = IdempotencyKey;

/**
 * What the request that owns a key holds. `ownerToken` is the fence (DD-3):
 * every write after `reserve` is conditioned on it, so a request that lost the
 * key to a take-over can neither commit nor overwrite anything.
 */
export interface Reservation {
  actorId: number;
  key: string;
  ownerToken: string;
}

export interface ReserveInput {
  actorId: number;
  key: string;
  /** sha256 hex from `requestFingerprint` (FR-4). */
  fingerprint: string;
  /** Success status of the route, for a replay after a crash between commit and answer (FR-2). */
  routeStatus: number;
}

export type ReserveOutcome =
  | { kind: 'reserved'; reservation: Reservation }
  /** The key already has a live row; the caller decides: reuse, replay, in flight, take over. */
  | { kind: 'existing'; row: IdempotencyRow };

export interface StoredAnswer {
  status: number;
  /** `data` of a success, or `{ code, fields }` of a refusal. */
  body: unknown;
}

/**
 * The persistence port of the idempotency interceptor and of the users-admin
 * unit of work (design 4, 7). Every method is keyed by `actorId`: another
 * admin's key is another row and no method can reach it (FR-6, FR-9).
 *
 * Errors of the database (down, deadlock, timeout) propagate untouched: the
 * caller must refuse the write rather than run it without the guarantee
 * (NFR-4; the 503 mapping belongs to the interceptor).
 */
export interface IdempotencyStore {
  /**
   * Inserts an `in_progress` row owned by a fresh token (primary-key insert;
   * a duplicate returns the existing row). A row past its retention that was
   * not purged yet is removed and the key is reserved as new (FR-7).
   */
  reserve(input: ReserveInput): Promise<ReserveOutcome>;
  /** The admin's own row for the key, if any. */
  find(actorId: number, key: string): Promise<IdempotencyRow | undefined>;
  /**
   * Compare-and-set take-over of an abandoned key: only an `in_progress` row
   * whose lease expired and whose `owner_token` is still `expectedOwnerToken`.
   * Resolves the new reservation, or `undefined` when another request got
   * there first or the row is not takeable (the caller answers 409).
   */
  takeOver(
    actorId: number,
    key: string,
    expectedOwnerToken: string,
  ): Promise<Reservation | undefined>;
  /**
   * The exactly-once fence (design 7): `in_progress` -> `executed`, only while
   * this reservation still owns the row. No row matched = ownership was lost:
   * throws `IdempotencyFenceLostError` so the surrounding transaction rolls
   * back. Meant to run inside the business transaction (bind the adapter to
   * the transaction handle), so the mark and the change commit together.
   */
  markExecuted(reservation: Reservation, targetUserId: number): Promise<void>;
  /**
   * Stores the answer (`executed` or `in_progress` -> `completed`), only for
   * the owner and never over a stored answer. False when it was not the owner.
   */
  complete(reservation: Reservation, answer: StoredAnswer): Promise<boolean>;
  /**
   * Frees the key after a server failure (DD-5): deletes the row only while it
   * is still `in_progress` and owned by this reservation. An `executed` row
   * stays: its change is committed and a replay must find the mark.
   */
  release(reservation: Reservation): Promise<boolean>;
  /** Deletes up to `limit` rows past their retention, oldest first. Resolves the count. */
  purgeExpired(limit?: number): Promise<number>;
}

type IdempotencyDb = Pick<DrizzleDB, 'select' | 'insert' | 'update' | 'delete'>;

/**
 * Drizzle adapter of `IdempotencyStore`. `db` is the pool for the interceptor's
 * own short writes, or a transaction handle (`new DrizzleIdempotencyStore(tx,
 * clock)`) when `markExecuted` must commit with a business change.
 *
 * Every conditional write is a single UPDATE/DELETE whose WHERE carries the
 * ownership test, so MySQL decides the race row by row (P-12: that MySQL
 * serializes these statements and raises 1062 on a concurrent insert is
 * UNVERIFIED until the HITL step on `qadb`, T-8). `affectedRows` is reliable
 * here because each UPDATE changes the row (a new token or a new state).
 */
@Injectable()
export class DrizzleIdempotencyStore implements IdempotencyStore {
  constructor(
    @Inject(DRIZZLE) private readonly db: IdempotencyDb,
    @Inject(IDEMPOTENCY_CLOCK) private readonly clock: IdempotencyClock,
    @Optional()
    @Inject(IDEMPOTENCY_TOKEN_FACTORY)
    private readonly newToken: () => string = randomUUID,
  ) {}

  async reserve(input: ReserveInput): Promise<ReserveOutcome> {
    for (let attempt = 0; attempt < RESERVE_ATTEMPTS; attempt++) {
      const now = this.clock();
      const ownerToken = this.newToken();
      try {
        await this.db.insert(idempotencyKeys).values({
          actorId: input.actorId,
          idemKey: input.key,
          fingerprint: input.fingerprint,
          state: 'in_progress',
          ownerToken,
          leaseUntil: new Date(now.getTime() + IDEMPOTENCY_LEASE_MS),
          routeStatus: input.routeStatus,
          createdAt: now,
          expiresAt: new Date(now.getTime() + IDEMPOTENCY_RETENTION_MS),
        });
        return {
          kind: 'reserved',
          reservation: { actorId: input.actorId, key: input.key, ownerToken },
        };
      } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
      }
      const existing = await this.find(input.actorId, input.key);
      if (!existing) continue; // released or purged in between: insert again
      if (existing.expiresAt.getTime() > this.clock().getTime()) {
        return { kind: 'existing', row: existing };
      }
      // Past retention but not purged yet: the key is new again (FR-7). Only
      // this exact stale row goes, so a row another request just created is
      // never deleted.
      await this.db
        .delete(idempotencyKeys)
        .where(
          and(
            eq(idempotencyKeys.actorId, input.actorId),
            eq(idempotencyKeys.idemKey, input.key),
            eq(idempotencyKeys.ownerToken, existing.ownerToken),
            lte(idempotencyKeys.expiresAt, this.clock()),
          ),
        );
    }
    throw new Error('Could not reserve the idempotency key');
  }

  async find(actorId: number, key: string) {
    const [row] = await this.db
      .select()
      .from(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.actorId, actorId),
          eq(idempotencyKeys.idemKey, key),
        ),
      )
      .limit(1);
    return row;
  }

  async takeOver(actorId: number, key: string, expectedOwnerToken: string) {
    const now = this.clock();
    const ownerToken = this.newToken();
    const [header] = await this.db
      .update(idempotencyKeys)
      .set({
        ownerToken,
        leaseUntil: new Date(now.getTime() + IDEMPOTENCY_LEASE_MS),
      })
      .where(
        and(
          eq(idempotencyKeys.actorId, actorId),
          eq(idempotencyKeys.idemKey, key),
          eq(idempotencyKeys.state, 'in_progress'),
          eq(idempotencyKeys.ownerToken, expectedOwnerToken),
          lte(idempotencyKeys.leaseUntil, now),
        ),
      );
    return header.affectedRows > 0 ? { actorId, key, ownerToken } : undefined;
  }

  async markExecuted(reservation: Reservation, targetUserId: number) {
    const [header] = await this.db
      .update(idempotencyKeys)
      .set({ state: 'executed', targetUserId })
      .where(
        and(
          eq(idempotencyKeys.actorId, reservation.actorId),
          eq(idempotencyKeys.idemKey, reservation.key),
          eq(idempotencyKeys.state, 'in_progress'),
          eq(idempotencyKeys.ownerToken, reservation.ownerToken),
        ),
      );
    if (header.affectedRows === 0) throw new IdempotencyFenceLostError();
  }

  async complete(reservation: Reservation, answer: StoredAnswer) {
    const [header] = await this.db
      .update(idempotencyKeys)
      .set({
        state: 'completed',
        responseStatus: answer.status,
        responseBody: answer.body ?? null,
      })
      .where(
        and(
          eq(idempotencyKeys.actorId, reservation.actorId),
          eq(idempotencyKeys.idemKey, reservation.key),
          eq(idempotencyKeys.ownerToken, reservation.ownerToken),
          inArray(idempotencyKeys.state, ['in_progress', 'executed']),
        ),
      );
    return header.affectedRows > 0;
  }

  async release(reservation: Reservation) {
    const [header] = await this.db
      .delete(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.actorId, reservation.actorId),
          eq(idempotencyKeys.idemKey, reservation.key),
          eq(idempotencyKeys.state, 'in_progress'),
          eq(idempotencyKeys.ownerToken, reservation.ownerToken),
        ),
      );
    return header.affectedRows > 0;
  }

  async purgeExpired(limit = IDEMPOTENCY_PURGE_BATCH) {
    const [header] = await this.db
      .delete(idempotencyKeys)
      .where(lte(idempotencyKeys.expiresAt, this.clock()))
      .orderBy(idempotencyKeys.expiresAt)
      .limit(limit);
    return header.affectedRows;
  }
}
