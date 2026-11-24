// @akili-spec admin-config/field-configuration
import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  DrizzleIdempotencyStore,
  IDEMPOTENCY_CLOCK,
  type IdempotencyClock,
  type IdempotencyStore,
} from '../../common/idempotency/idempotency.store.js';
import { DRIZZLE } from '../../database/drizzle/drizzle.constants.js';
import type { DrizzleDB } from '../../database/drizzle/drizzle.module.js';
import {
  DrizzleFieldConfigStore,
  type FieldConfigStore,
} from './field-config.store.js';

export const FIELD_CONFIG_UNIT_OF_WORK = Symbol('FIELD_CONFIG_UNIT_OF_WORK');

/** The stores of one field-configuration transaction (design 7.3). */
export interface FieldConfigRepositories {
  /** The field-configuration store bound to THIS transaction: the draft, its items, the versions and the audit row commit or roll back together. */
  fieldConfig: FieldConfigStore;
  /**
   * The exactly-once fence (P-1): `markExecuted` bound to THIS transaction, so
   * the mark commits or rolls back with the publication. Only that method is
   * exposed: `reserve`, `complete` and `release` belong to the interceptor's
   * own short writes, never to a business transaction.
   */
  idempotency: Pick<IdempotencyStore, 'markExecuted'>;
}

/** Runs `work` in one database transaction: it commits when `work` resolves, rolls back when it throws. */
export interface FieldConfigUnitOfWork {
  run<T>(
    work: (repositories: FieldConfigRepositories) => Promise<T>,
  ): Promise<T>;
}

/**
 * One MySQL transaction for a field-configuration write, in the shape of
 * `DrizzleTimelinesUnitOfWork`: READ COMMITTED, the store bound to the
 * transaction, and the idempotency store whose `markExecuted` commits with the
 * change.
 *
 * Lock order (DD-6; design 7.2, 7.3, P-11): the cycle row `FOR SHARE`
 * (`lockCycleShared`, the lock a timeline edit takes too, so an activation that
 * closes the cycle serializes with the write), then the draft row `FOR UPDATE`
 * (`lockDraft`, or `ensureDraft` then `lockDraft` for a draft edit), then the
 * writes. A publication writes in this order: the conditional `bumpRevision`
 * (the revision is in the WHERE, so the database decides a race), the next
 * number read under the lock, `insertVersion`, `insertVersionItems`,
 * `insertAuditEvent`, and the key mark. All of it goes through `fieldConfig`
 * below, bound to the same transaction, so the audit row commits or rolls back
 * with the version (FR-11) and a lost race writes nothing (FR-8). Readers never
 * lock.
 */
@Injectable()
export class DrizzleFieldConfigUnitOfWork implements FieldConfigUnitOfWork {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    // The clock `FieldConfigModule` binds for the interceptor's store. Optional
    // so the unit's own specs can build the adapter without a module.
    @Optional()
    @Inject(IDEMPOTENCY_CLOCK)
    private readonly clock: IdempotencyClock = () => new Date(),
  ) {}

  run<T>(
    work: (repositories: FieldConfigRepositories) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(
      (tx) =>
        work({
          fieldConfig: new DrizzleFieldConfigStore(tx),
          idempotency: new DrizzleIdempotencyStore(tx, this.clock),
        }),
      // READ COMMITTED, as the cycles and timelines units of work: the locking
      // reads are current reads at any level, and a plain read never carries a
      // snapshot from before another transaction's commit.
      { isolationLevel: 'read committed' },
    );
  }
}
