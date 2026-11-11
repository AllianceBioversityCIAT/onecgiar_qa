// @akili-spec assessment/step-1-assessment
import { Inject, Injectable } from '@nestjs/common';
import {
  DrizzleIdempotencyStore,
  IDEMPOTENCY_CLOCK,
  type IdempotencyClock,
  type IdempotencyStore,
} from '../common/idempotency/idempotency.store.js';
import { DRIZZLE } from '../database/drizzle/drizzle.constants.js';
import type { DrizzleDB } from '../database/drizzle/drizzle.module.js';
import {
  DrizzleLoadsStore,
  type LoadsStore,
} from '../ingestion/loads.store.js';
import {
  DrizzleAssessmentWriteStore,
  type AssessmentWriteStore,
} from './assessment.store.js';
import {
  DrizzleReleaseWriteStore,
  type ReleaseWriteStore,
} from './release.store.js';

export const ASSESSMENT_UNIT_OF_WORK = Symbol('ASSESSMENT_UNIT_OF_WORK');

/** The stores of one assessment transaction (design 5, 7.5). */
export interface AssessmentRepositories {
  /** Bound to THIS transaction: the validations and the audit row commit or roll back together. */
  assessments: AssessmentWriteStore;
  /**
   * The exactly-once fence of a keyed create (P-17): `markExecuted` bound to
   * THIS transaction, so the mark commits with the comment, or never.
   */
  idempotency: Pick<IdempotencyStore, 'markExecuted'>;
  /** The release ack (T-12, design 7.6): the release row and the assessment lock, bound to THIS transaction. */
  releases: ReleaseWriteStore;
  /**
   * The membership ends of the release ack (FR-18, P-1): `endAsReleasedQaed`
   * and `endAsReturned`, bound to THIS transaction so the end commits with the
   * release row, or never.
   */
  loads: Pick<LoadsStore, 'endAsReleasedQaed' | 'endAsReturned'>;
}

/** Runs `work` in one database transaction: it commits when `work` resolves, rolls back when it throws. */
export interface AssessmentUnitOfWork {
  run<T>(
    work: (repositories: AssessmentRepositories) => Promise<T>,
  ): Promise<T>;
}

/**
 * One MySQL transaction for an assessment write, in the shape of
 * `FieldConfigUnitOfWork`: READ COMMITTED (the locking reads are current reads
 * at any level, and a plain read never carries a snapshot from before another
 * transaction's commit), and the store bound to the transaction.
 *
 * Lock order (design 5, extending admin-config DD-9): the timeline row
 * `FOR SHARE` (`lockTimelineShared`, the lock a timeline edit waits on, since
 * an edit takes the timeline `FOR UPDATE`), then the `result_assessments` row
 * `FOR UPDATE` (`ensureAssessment` then `lockAssessment`), then the validations
 * and the audit row beneath it. A comment is written in the same order: the
 * comment row, its `comment_events` row, the audit row, and the key mark; a
 * withdraw takes the assessment row too (it does NOT refuse an ended one), so a
 * finish that counts the non-withdrawn comments (T-11) waits for it. A load takes the timeline `FOR UPDATE` and never
 * touches an assessment row; nothing takes an assessment row first and then a
 * timeline, so there is no cycle (P-38). The service issues the calls in that
 * order; the store never reorders them. A deadlock (1213) reruns the work, at
 * most `DEADLOCK_ATTEMPTS` times: concurrent first writes and concurrent ends
 * can deadlock, and the victim is rolled back whole.
 */
@Injectable()
export class DrizzleAssessmentUnitOfWork implements AssessmentUnitOfWork {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    // The clock the module binds for the interceptor's store (the only time source, NFR-4).
    @Inject(IDEMPOTENCY_CLOCK) private readonly clock: IdempotencyClock,
  ) {}

  async run<T>(
    work: (repositories: AssessmentRepositories) => Promise<T>,
  ): Promise<T> {
    // A deadlock victim is rolled back whole, so the work runs again from the
    // top on a new transaction. Bounded: a deadlock that keeps coming is thrown.
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.db.transaction(
          (tx) =>
            work({
              assessments: new DrizzleAssessmentWriteStore(tx),
              idempotency: new DrizzleIdempotencyStore(tx, this.clock),
              releases: new DrizzleReleaseWriteStore(tx),
              loads: new DrizzleLoadsStore(tx),
            }),
          { isolationLevel: 'read committed' },
        );
      } catch (error) {
        if (attempt >= DEADLOCK_ATTEMPTS || !isDeadlock(error)) throw error;
      }
    }
  }
}

/** How many times the work runs before a deadlock is thrown. */
export const DEADLOCK_ATTEMPTS = 3;

/**
 * True for a MySQL deadlock (ER_LOCK_DEADLOCK, errno 1213), raised directly or
 * as the `cause` of a drizzle wrapper. A lock wait timeout (1205) and every
 * other error are not retried: only a deadlock leaves the work safe to repeat.
 */
function isDeadlock(error: unknown): boolean {
  for (
    let current: unknown = error, depth = 0;
    current instanceof Error && depth < 3;
    current = (current as Error & { cause?: unknown }).cause, depth++
  ) {
    const { code, errno } = current as Error & {
      code?: unknown;
      errno?: unknown;
    };
    if (code === 'ER_LOCK_DEADLOCK' || errno === 1213) return true;
  }
  return false;
}
