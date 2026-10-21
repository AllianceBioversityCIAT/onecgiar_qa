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
import { DrizzleCyclesStore, type CyclesStore } from './cycles.store.js';

export const CYCLES_UNIT_OF_WORK = Symbol('CYCLES_UNIT_OF_WORK');

/** The stores of one cycles transaction (design 7.3). */
export interface CyclesRepositories {
  cycles: CyclesStore;
  /**
   * The exactly-once fence (P-1): `markExecuted` bound to THIS transaction, so
   * the mark commits or rolls back with the change. Only that method is
   * exposed: `reserve`, `complete` and `release` belong to the interceptor's
   * own short writes, never to a business transaction.
   */
  idempotency: Pick<IdempotencyStore, 'markExecuted'>;
}

/** Runs `work` in one database transaction: it commits when `work` resolves, rolls back when it throws. */
export interface CyclesUnitOfWork {
  run<T>(work: (repositories: CyclesRepositories) => Promise<T>): Promise<T>;
}

/**
 * One MySQL transaction for a cycles write, in the shape of
 * `DrizzleUsersAdminUnitOfWork`: READ COMMITTED, repositories bound to the
 * transaction, and the idempotency store whose `markExecuted` commits with
 * the change.
 *
 * Lock order (DD-9; design 7.3): target cycle row `FOR UPDATE`, then the
 * active cycle row `FOR UPDATE`, then the writes. Readers never lock.
 */
@Injectable()
export class DrizzleCyclesUnitOfWork implements CyclesUnitOfWork {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    // The clock `CyclesModule` binds for the interceptor's store. Optional so
    // the unit's own specs can build the adapter without a module.
    @Optional()
    @Inject(IDEMPOTENCY_CLOCK)
    private readonly clock: IdempotencyClock = () => new Date(),
  ) {}

  run<T>(work: (repositories: CyclesRepositories) => Promise<T>): Promise<T> {
    return this.db.transaction(
      (tx) =>
        work({
          cycles: new DrizzleCyclesStore(tx),
          idempotency: new DrizzleIdempotencyStore(tx, this.clock),
        }),
      // READ COMMITTED, as the users unit of work: the locking reads that
      // decide an activation are current reads at any level, and a plain read
      // never carries a snapshot from before another transaction's commit.
      { isolationLevel: 'read committed' },
    );
  }
}
