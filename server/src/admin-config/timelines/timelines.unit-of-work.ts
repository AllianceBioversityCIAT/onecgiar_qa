// @akili-spec admin-config/cycle-timelines
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
  DrizzleCyclesStore,
  type CyclesStore,
} from '../cycles/cycles.store.js';
import {
  DrizzleTimelinesStore,
  type TimelinesStore,
} from './timelines.store.js';

export const TIMELINES_UNIT_OF_WORK = Symbol('TIMELINES_UNIT_OF_WORK');

/** The stores of one timelines transaction (design 7.3). */
export interface TimelinesRepositories {
  /** Only the locking read of the cycle row: the create decides under that lock (DD-3). */
  cycles: Pick<CyclesStore, 'findById'>;
  timelines: TimelinesStore;
  /**
   * The exactly-once fence (P-1): `markExecuted` bound to THIS transaction, so
   * the mark commits or rolls back with the timeline. Only that method is
   * exposed: `reserve`, `complete` and `release` belong to the interceptor's
   * own short writes, never to a business transaction.
   */
  idempotency: Pick<IdempotencyStore, 'markExecuted'>;
}

/** Runs `work` in one database transaction: it commits when `work` resolves, rolls back when it throws. */
export interface TimelinesUnitOfWork {
  run<T>(work: (repositories: TimelinesRepositories) => Promise<T>): Promise<T>;
}

/**
 * One MySQL transaction for a timelines write, in the shape of
 * `DrizzleCyclesUnitOfWork`: READ COMMITTED, repositories bound to the
 * transaction, and the idempotency store whose `markExecuted` commits with the
 * change.
 *
 * Lock order (DD-9; design 7.3): the cycle row `FOR UPDATE` first, then the
 * writes. It is the same row an activation locks, so a create and an activation
 * of one cycle serialize. Readers never lock.
 */
@Injectable()
export class DrizzleTimelinesUnitOfWork implements TimelinesUnitOfWork {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    // The clock `TimelinesModule` binds for the interceptor's store. Optional
    // so the unit's own specs can build the adapter without a module.
    @Optional()
    @Inject(IDEMPOTENCY_CLOCK)
    private readonly clock: IdempotencyClock = () => new Date(),
  ) {}

  run<T>(
    work: (repositories: TimelinesRepositories) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(
      (tx) =>
        work({
          cycles: new DrizzleCyclesStore(tx),
          timelines: new DrizzleTimelinesStore(tx),
          idempotency: new DrizzleIdempotencyStore(tx, this.clock),
        }),
      // READ COMMITTED, as the cycles and users units of work: the locking
      // read of the cycle is a current read at any level, and a plain read
      // never carries a snapshot from before another transaction's commit.
      { isolationLevel: 'read committed' },
    );
  }
}
