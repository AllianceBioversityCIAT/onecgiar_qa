// @akili-spec assessment/step-1-assessment
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { DRIZZLE } from '../database/drizzle/drizzle.constants.js';
import type { DrizzleDB } from '../database/drizzle/drizzle.module.js';
import {
  assessmentReleases,
  type AssessmentRelease,
} from '../database/drizzle/schema/assessment-releases.js';
import { resultAssessments } from '../database/drizzle/schema/result-assessments.js';
import { timelineResults } from '../database/drizzle/schema/timeline-results.js';
import { timelines } from '../database/drizzle/schema/timelines.js';

// Ports of the release outbox (design 5, 7.6; FR-18, NFR-3). `ReleaseStore` runs
// on the pool (the claim opens its own transaction, the admin list is a read);
// `ReleaseWriteStore` is bound to the ack transaction by the assessment unit of
// work, so the locks it takes live as long as that transaction.

export const RELEASE_STORE = Symbol('RELEASE_STORE');

/** A release row the claim leased to this dispatcher, with the timeline its membership belongs to (the lock order needs it). */
export interface DueRelease {
  id: number;
  assessmentId: number;
  timelineId: number;
  timelineResultId: number;
  resultId: number;
  phaseYear: number;
  outcome: AssessmentRelease['outcome'];
  /** Counts this claim. */
  attempts: number;
}

/** One row of the admin list (design 6). */
export interface ReleaseListItem {
  id: number;
  timeline: { id: number; name: string };
  resultCode: number;
  outcome: AssessmentRelease['outcome'];
  status: AssessmentRelease['status'];
  attempts: number;
  reason: string | null;
  createdAt: Date;
}

export type ReleaseListStatus = 'pending' | 'refused';

/** The most rows the admin list answers. */
export const RELEASE_LIST_LIMIT = 500;

export interface ReleaseStore {
  /**
   * The claim (design 7.6 step 1), ONE transaction, ONE send batch: the rows
   * are of the one phase year of the oldest due row, with no result id twice,
   * at most `limit`. The due ids are read `FOR UPDATE SKIP LOCKED` (so a second dispatcher never takes a row the
   * first one holds), then ONE conditional `UPDATE ... SET lease_until, attempts
   * = attempts + 1 WHERE id IN (...) AND status = 'pending' AND (lease_until IS
   * NULL OR lease_until < now)`, then the leased rows are read back. A row is
   * due when it is `pending` and its lease is null or past. At most `limit`.
   */
  claimDue(now: Date, leaseUntil: Date, limit: number): Promise<DueRelease[]>;
  /** One statement: the `pending` or `refused` rows, oldest first, at most `RELEASE_LIST_LIMIT`. */
  list(status: ReleaseListStatus): Promise<ReleaseListItem[]>;
}

/** The assessment row as the ack reads it under its lock: who ended it is the actor of the release audit row. */
export interface LockedReleaseAssessment {
  id: number;
  finishedBy: number | null;
}

export interface ReleaseSettle {
  id: number;
  status: 'sent' | 'refused';
  /** `not_in_qa` for a repeated release that counts as sent; the refusal reason; null for a plain `released`. */
  reason: string | null;
  at: Date;
}

/** The statements of one ack, bound to ONE transaction (design 5: timeline `FOR SHARE`, then the assessment `FOR UPDATE`, then the rows under it). */
export interface ReleaseWriteStore {
  /** One statement: the assessment row `FOR UPDATE`. */
  lockAssessment(
    assessmentId: number,
  ): Promise<LockedReleaseAssessment | undefined>;
  /**
   * One conditional statement: `UPDATE assessment_releases SET status, reason,
   * sent_at WHERE id = ? AND status = 'pending'`. `false` when it matched
   * nothing (another dispatcher settled it): the database decides.
   */
  settle(settle: ReleaseSettle): Promise<boolean>;
}

// ---- Drizzle adapters --------------------------------------------------------

const r = assessmentReleases;
const t = timelineResults;

/** The columns of a due row; the timeline comes from the membership the release belongs to. */
const dueColumns = {
  id: r.id,
  assessmentId: r.assessmentId,
  timelineId: t.timelineId,
  timelineResultId: r.timelineResultId,
  resultId: r.resultId,
  phaseYear: r.phaseYear,
  outcome: r.outcome,
  attempts: r.attempts,
};

/** Due: `pending`, with no lease or one that has passed. */
const dueCondition = (now: Date) =>
  and(eq(r.status, 'pending'), or(isNull(r.leaseUntil), lt(r.leaseUntil, now)));

type ReleaseDb = Pick<DrizzleDB, 'select' | 'update' | 'transaction'>;

/** Drizzle adapter of `ReleaseStore`, on the pool. The `build*` methods are public so a spec can read each statement's SQL. */
@Injectable()
export class DrizzleReleaseStore implements ReleaseStore {
  constructor(@Inject(DRIZZLE) private readonly db: ReleaseDb) {}

  /** The phase year of the oldest due row: the one year a claim takes. */
  buildOldestDue(now: Date) {
    return this.db
      .select({ phaseYear: r.phaseYear })
      .from(r)
      .where(dueCondition(now))
      .orderBy(asc(r.id))
      .limit(1);
  }

  /** The due ids of one phase year, locked: a row another dispatcher holds is skipped, never waited for. */
  buildDueSelect(now: Date, limit: number, phaseYear: number) {
    return this.db
      .select({ id: r.id, resultId: r.resultId })
      .from(r)
      .where(and(dueCondition(now), eq(r.phaseYear, phaseYear)))
      .orderBy(asc(r.id))
      .limit(limit)
      .for('update', { skipLocked: true });
  }

  /** The claim: ONE conditional UPDATE. The lease condition is what keeps a leased row from being taken twice. */
  buildClaimUpdate(ids: readonly number[], now: Date, leaseUntil: Date) {
    return this.db
      .update(r)
      .set({
        leaseUntil,
        // `attempts` is a tinyint: the count stops at 255 instead of failing the claim.
        attempts: sql`least(${r.attempts} + 1, 255)`,
      })
      .where(
        and(
          inArray(r.id, [...ids]),
          eq(r.status, 'pending'),
          or(isNull(r.leaseUntil), lt(r.leaseUntil, now)),
        ),
      );
  }

  buildLeasedRows(ids: readonly number[]) {
    return this.db
      .select(dueColumns)
      .from(r)
      .innerJoin(t, eq(t.id, r.timelineResultId))
      .where(inArray(r.id, [...ids]))
      .orderBy(asc(r.id));
  }

  async claimDue(
    now: Date,
    leaseUntil: Date,
    limit: number,
  ): Promise<DueRelease[]> {
    return await this.db.transaction(
      async (tx) => {
        const bound = new DrizzleReleaseStore(tx);
        // ONE claim is ONE send batch: one phase year, no result id twice,
        // so the lease always outlasts the single send it covers (NFR-3).
        const [oldest] = await bound.buildOldestDue(now);
        if (oldest === undefined) return [];
        const locked = await bound.buildDueSelect(now, limit, oldest.phaseYear);
        const seen = new Set<number>();
        const ids = locked
          .filter((row) => !seen.has(row.resultId) && seen.add(row.resultId))
          .map((row) => row.id);
        if (ids.length === 0) return [];
        // The rows are locked by the read above, so the UPDATE matches every one of them: anything else is a defect, and rolling back beats sending rows that are not leased.
        const [header] = await bound.buildClaimUpdate(ids, now, leaseUntil);
        if (header.affectedRows !== ids.length) {
          throw new Error('release_claim_mismatch');
        }
        return await bound.buildLeasedRows(ids);
      },
      { isolationLevel: 'read committed' },
    );
  }

  buildList(status: ReleaseListStatus) {
    return this.db
      .select({
        id: r.id,
        timelineId: timelines.id,
        timelineName: timelines.name,
        resultCode: t.resultCode,
        outcome: r.outcome,
        status: r.status,
        attempts: r.attempts,
        reason: r.reason,
        createdAt: r.createdAt,
      })
      .from(r)
      .innerJoin(t, eq(t.id, r.timelineResultId))
      .innerJoin(timelines, eq(timelines.id, t.timelineId))
      .where(eq(r.status, status))
      .orderBy(asc(r.id))
      .limit(RELEASE_LIST_LIMIT);
  }

  async list(status: ReleaseListStatus): Promise<ReleaseListItem[]> {
    const rows = await this.buildList(status);
    return rows.map(({ timelineId, timelineName, ...row }) => ({
      ...row,
      timeline: { id: timelineId, name: timelineName },
    }));
  }
}

type ReleaseWriteDb = Pick<DrizzleDB, 'select' | 'update'>;

/** Drizzle adapter of `ReleaseWriteStore`, built ON a transaction by the unit of work. */
export class DrizzleReleaseWriteStore implements ReleaseWriteStore {
  constructor(private readonly db: ReleaseWriteDb) {}

  buildAssessmentLock(assessmentId: number) {
    return this.db
      .select({
        id: resultAssessments.id,
        finishedBy: resultAssessments.finishedBy,
      })
      .from(resultAssessments)
      .where(eq(resultAssessments.id, assessmentId))
      .limit(1)
      .for('update');
  }

  async lockAssessment(
    assessmentId: number,
  ): Promise<LockedReleaseAssessment | undefined> {
    const [row] = await this.buildAssessmentLock(assessmentId);
    return row;
  }

  /** The settle: ONE conditional UPDATE, so the database decides which dispatcher acknowledges the row. */
  buildSettle(settle: ReleaseSettle) {
    return this.db
      .update(r)
      .set({
        status: settle.status,
        reason: settle.reason,
        sentAt: settle.status === 'sent' ? settle.at : null,
      })
      .where(and(eq(r.id, settle.id), eq(r.status, 'pending')));
  }

  async settle(settle: ReleaseSettle): Promise<boolean> {
    const [header] = await this.buildSettle(settle);
    return header.affectedRows > 0;
  }
}
