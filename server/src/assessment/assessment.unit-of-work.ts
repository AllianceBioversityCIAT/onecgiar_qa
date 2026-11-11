// @akili-spec assessment/step-1-assessment
import { Inject, Injectable } from '@nestjs/common';
import { DRIZZLE } from '../database/drizzle/drizzle.constants.js';
import type { DrizzleDB } from '../database/drizzle/drizzle.module.js';
import {
  DrizzleAssessmentWriteStore,
  type AssessmentWriteStore,
} from './assessment.store.js';

export const ASSESSMENT_UNIT_OF_WORK = Symbol('ASSESSMENT_UNIT_OF_WORK');

/** The stores of one assessment transaction (design 5, 7.5). */
export interface AssessmentRepositories {
  /** Bound to THIS transaction: the validations and the audit row commit or roll back together. */
  assessments: AssessmentWriteStore;
}

/** Runs `work` in one database transaction: it commits when `work` resolves, rolls back when it throws. */
export interface AssessmentUnitOfWork {
  run<T>(work: (repositories: AssessmentRepositories) => Promise<T>): Promise<T>;
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
 * and the audit row beneath it. A load takes the timeline `FOR UPDATE` and never
 * touches an assessment row; nothing takes an assessment row first and then a
 * timeline, so there is no cycle (P-38). The service issues the calls in that
 * order; the store never reorders them.
 */
@Injectable()
export class DrizzleAssessmentUnitOfWork implements AssessmentUnitOfWork {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  run<T>(
    work: (repositories: AssessmentRepositories) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(
      (tx) => work({ assessments: new DrizzleAssessmentWriteStore(tx) }),
      { isolationLevel: 'read committed' },
    );
  }
}
