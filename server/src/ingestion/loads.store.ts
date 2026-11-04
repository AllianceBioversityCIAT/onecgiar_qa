// @akili-spec ingestion/step-1-loads
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DRIZZLE } from '../database/drizzle/drizzle.constants.js';
import type { DrizzleDB } from '../database/drizzle/drizzle.module.js';
import { cycles, type CycleStatus } from '../database/drizzle/schema/cycles.js';
import {
  timelineAuditEvents,
  type NewTimelineAuditEvent,
} from '../database/drizzle/schema/timeline-audit-events.js';
import {
  timelineLoads,
  type TimelineLoad,
  type TimelineLoadFailureReason,
  type TimelineLoadScope,
} from '../database/drizzle/schema/timeline-loads.js';
import { timelinePrograms } from '../database/drizzle/schema/timeline-programs.js';
import { timelineResultTypes } from '../database/drizzle/schema/timeline-result-types.js';
import {
  timelineResults,
  type TimelineResultEndReason,
  type TimelineResultKpGroup,
  type TimelineResultStatus,
} from '../database/drizzle/schema/timeline-results.js';
import {
  timelineSteps,
  type TimelineStep,
} from '../database/drizzle/schema/timeline-steps.js';
import {
  timelines,
  type Timeline,
} from '../database/drizzle/schema/timelines.js';
import { users } from '../database/drizzle/schema/users.js';
import type { CycleMembership, LoadSummary } from './load-rules.js';

export const LOADS_STORE = Symbol('LOADS_STORE');

/** The unique keys a load or a membership insert can hit (design 5.1, 5.2, DD-2, DD-3). */
export const LOADS_RUNNING_KEY = 'uq_timeline_loads_running_key';
export const RESULTS_ACTIVE_KEY = 'uq_timeline_results_active_key';
export const RESULTS_TIMELINE_CODE_KEY = 'uq_timeline_results_timeline_code';

/** `IN` lists of `result_code` are cut at this many values per statement (design 7.1 step 3). */
export const RESULT_CODE_CHUNK = 500;

/**
 * A membership's timeline has no steps: corrupt data (FR-9 of *timelines*),
 * never a store outage. The runner tells it apart from a store error so it is
 * not retried.
 */
export class TimelineHasNoStepsError extends Error {
  constructor(readonly timelineId: number) {
    super(`Timeline ${timelineId} has no steps`);
    this.name = 'TimelineHasNoStepsError';
  }
}

/** The cycle row as the start reads it under `FOR SHARE`. */
export interface LockedCycle {
  status: CycleStatus;
  /** `cycles.year`: the load's `phase_year` (design 5.1). */
  year: number;
}

/** A timeline's step 1: the row the load hangs from and the closing minute of the window (FR-2). */
export type StepOne = Pick<TimelineStep, 'id' | 'closesAt'>;

/** A membership of a result code in the cycle, with what the skip rules and the summary need (design 7.1, 7.3). */
export interface CycleMembershipRow extends CycleMembership {
  id: number;
  resultCode: number;
  resultId: number;
  /** The membership status, so a re-run can release a KP that was not released (FR-14). */
  status: TimelineResultStatus;
  /** Name of the membership's timeline, for the summary of other timelines. */
  timelineName: string;
}

/** A load and who started it (the list and the detail of FR-10). The status is as stored: the lease is applied by the reader. */
export interface LoadRow {
  load: TimelineLoad;
  startedBy: { id: number; nickname: string | null };
}

export interface NewLoadValues {
  cycleId: number;
  timelineId: number;
  timelineStepId: number;
  phaseYear: number;
  scope: TimelineLoadScope;
  summary: LoadSummary;
  startedBy: number;
  /** Also written as the first heartbeat. */
  startedAt: Date;
  requestId: string | null;
}

/** How the insert of a load ended: written, or refused by `uq_timeline_loads_running_key` (FR-2). */
export type LoadInsertOutcome =
  { kind: 'created'; loadId: number } | { kind: 'already_running' };

export interface LoadEndValues {
  status: 'completed' | 'failed';
  failureReason: TimelineLoadFailureReason | null;
  finishedAt: Date;
}

export interface LoadProgressValues {
  processed: number;
  summary: LoadSummary;
  heartbeatAt: Date;
}

export interface NewMembershipValues {
  cycleId: number;
  timelineId: number;
  loadId: number;
  resultCode: number;
  resultId: number;
  phaseYear: number;
  programClarisaId: number;
  resultTypeKey: string;
  status: TimelineResultStatus;
  kpGroup: TimelineResultKpGroup | null;
  awaitsStep: number | null;
  snapshotSk: string;
  snapshotHash: string;
  catalogVersion: string;
  createdAt: Date;
}

/** Which unique key refused a membership: the cycle-wide active one, or this timeline's own. */
export type MembershipDuplicateKey = 'active_key' | 'timeline_code';

/** How the insert of a membership ended: written, or refused by one of the two unique keys (FR-4). */
export type MembershipInsertOutcome =
  { kind: 'created' } | { kind: 'duplicate'; key: MembershipDuplicateKey };

/**
 * The persistence port of loads and memberships (design 3, 5, 7.2, 7.3). Rules
 * live in `load-rules.ts` and `LoadsUnitOfWork`. The reads work on the pool or
 * on a transaction; the locking reads and the writes are meant for a
 * transaction (`DrizzleLoadsTransactions`).
 */
export interface LoadsStore {
  /**
   * The memberships of these result codes in the cycle, ended or not, from any
   * timeline, oldest first. `IN` is chunked by 500 (`RESULT_CODE_CHUNK`); one
   * more statement reads the names and last steps of the timelines involved, so
   * the count is `ceil(codes / 500) + 1` and never one per result.
   */
  findMemberships(
    cycleId: number,
    resultCodes: readonly number[],
  ): Promise<CycleMembershipRow[]>;
  /** The loads of a timeline, newest first, with who started each (FR-10). One statement. */
  listByTimeline(timelineId: number): Promise<LoadRow[]>;
  /** One load of that timeline; `undefined` when it does not exist or belongs to another timeline. */
  findLoad(timelineId: number, loadId: number): Promise<LoadRow | undefined>;

  /** `SELECT ... FROM cycles WHERE id = ? FOR SHARE`: the first lock of the start (design 7.2, DD-9). */
  lockCycleShared(cycleId: number): Promise<LockedCycle | undefined>;
  /** `SELECT ... FROM timelines WHERE id = ? FOR UPDATE`: the second lock; the edit takes the same one (P-8). */
  findTimelineForUpdate(timelineId: number): Promise<Timeline | undefined>;
  /** Step 1 of the timeline. A plain read, made under the timeline lock. */
  findStepOne(timelineId: number): Promise<StepOne | undefined>;
  /** The scope rows of the timeline: rows exist only while the matching `all_*` flag is false (DD-6 of *timelines*). */
  findScope(
    timelineId: number,
  ): Promise<{ programIds: number[]; resultTypeKeys: string[] }>;
  /** The running load of the cycle, through `running_key`, `FOR UPDATE`; `undefined` locks nothing. */
  lockRunningLoad(cycleId: number): Promise<TimelineLoad | undefined>;
  /** One load `FOR UPDATE`: the lot and the end serialize on it. */
  lockLoad(loadId: number): Promise<TimelineLoad | undefined>;
  /**
   * One load by id, a PLAIN read (no lock). The lot and the end read from it the
   * cycle and the timeline of the load, which never change, to lock those
   * parents before the load row, in the start's order.
   */
  findLoadById(loadId: number): Promise<TimelineLoad | undefined>;
  /**
   * The running load of the cycle through `running_key`, a PLAIN read (no lock).
   * The start reads whose timeline it is before it locks the row.
   */
  findRunningLoad(cycleId: number): Promise<TimelineLoad | undefined>;
  /**
   * `SELECT id FROM timelines WHERE id = ? FOR SHARE`: the lock InnoDB takes on
   * the parent row of an insert that has this timeline as a foreign key (a
   * membership, an audit row), taken here first so that it never waits behind
   * a load row this transaction already holds.
   */
  lockTimelineShared(timelineId: number): Promise<void>;
  /**
   * `INSERT` a `running` load; a second running load in the cycle
   * (`uq_timeline_loads_running_key`, MySQL 1062) is `already_running`. Any
   * other failure is thrown.
   */
  insertLoad(values: NewLoadValues): Promise<LoadInsertOutcome>;
  /**
   * `UPDATE ... SET status, failure_reason, finished_at WHERE id = ? AND status =
   * 'running'`. `false` = the load was no longer running.
   */
  endLoad(loadId: number, values: LoadEndValues): Promise<boolean>;
  /** `UPDATE timelines SET version = version + 1 WHERE id = ?` (DD-7). Nothing else on the row is written. */
  bumpTimelineVersion(timelineId: number): Promise<void>;
  /** `INSERT` one audit row; append-only, written on the transaction (FR-12). */
  insertAuditEvent(values: NewTimelineAuditEvent): Promise<void>;
  /**
   * `INSERT` one membership; a duplicate on `uq_timeline_results_active_key` or
   * on `uq_timeline_results_timeline_code` (MySQL 1062) is `duplicate`, told
   * apart by the key the driver names (FR-4). Any other failure is thrown.
   */
  insertMembership(
    values: NewMembershipValues,
  ): Promise<MembershipInsertOutcome>;
  /** `UPDATE timeline_loads SET processed, summary, heartbeat_at WHERE id = ?` (design 7.3 step 2.7). */
  recordProgress(loadId: number, values: LoadProgressValues): Promise<void>;
  /**
   * `UPDATE timeline_loads SET total WHERE id = ? AND status = 'running'` (design
   * 7.3 step 1): one statement. `false` = the load was no longer running.
   */
  setTotal(loadId: number, total: number): Promise<boolean>;
  /**
   * `UPDATE timeline_loads SET heartbeat_at WHERE id = ? AND status = 'running'`
   * (design 7.3 step 5, FR-9): one statement, so it takes only the load row.
   * `false` = the load was no longer running, which is how a run learns it was
   * abandoned.
   */
  renewHeartbeat(loadId: number, at: Date): Promise<boolean>;
  /**
   * `UPDATE timeline_results SET ended_at, end_reason WHERE id IN (...) AND
   * ended_at IS NULL`: the only update a membership ever gets. Returns the
   * number of rows that ended.
   */
  endMemberships(
    ids: readonly number[],
    endedAt: Date,
    reason: TimelineResultEndReason,
  ): Promise<number>;
}

/**
 * The text of the MySQL duplicate-key error (1062) in an error chain: the
 * driver error, or the `cause` a wrapper carries. It names the unique key that
 * refused the row, which is how the keys of one table are told apart.
 */
function duplicateKeyText(error: unknown): string | undefined {
  for (
    let current: unknown = error, depth = 0;
    current instanceof Error && depth < 3;
    current = (current as Error & { cause?: unknown }).cause, depth++
  ) {
    const { code, errno, sqlMessage } = current as Error & {
      code?: unknown;
      errno?: unknown;
      sqlMessage?: unknown;
    };
    if (code === 'ER_DUP_ENTRY' || errno === 1062) {
      return typeof sqlMessage === 'string' ? sqlMessage : current.message;
    }
  }
  return undefined;
}

/** The summary as the JSON column takes it (an interface has no index signature). */
const summaryJson = (summary: LoadSummary): Record<string, unknown> => ({
  ...summary,
});

type LoadsDb = Pick<DrizzleDB, 'select' | 'insert' | 'update' | 'delete'>;

/** Drizzle adapter of `LoadsStore`. `db` is the pool for reads or a transaction handle (`DrizzleLoadsTransactions`). */
@Injectable()
export class DrizzleLoadsStore implements LoadsStore {
  constructor(@Inject(DRIZZLE) private readonly db: LoadsDb) {}

  async findMemberships(
    cycleId: number,
    resultCodes: readonly number[],
  ): Promise<CycleMembershipRow[]> {
    const codes = [...new Set(resultCodes)];
    const found: Array<
      Pick<
        CycleMembershipRow,
        'id' | 'resultCode' | 'resultId' | 'status' | 'timelineId' | 'endedAt'
      >
    > = [];
    for (let at = 0; at < codes.length; at += RESULT_CODE_CHUNK) {
      found.push(
        ...(await this.db
          .select({
            id: timelineResults.id,
            resultCode: timelineResults.resultCode,
            resultId: timelineResults.resultId,
            status: timelineResults.status,
            timelineId: timelineResults.timelineId,
            endedAt: timelineResults.endedAt,
          })
          .from(timelineResults)
          .where(
            and(
              eq(timelineResults.cycleId, cycleId),
              inArray(
                timelineResults.resultCode,
                codes.slice(at, at + RESULT_CODE_CHUNK),
              ),
            ),
          )),
      );
    }
    if (found.length === 0) return [];

    // The last step of a timeline is the one with the highest position; the
    // rows come ordered, so the last one seen per timeline wins (DD-5).
    const steps = await this.db
      .select({
        timelineId: timelineSteps.timelineId,
        timelineName: timelines.name,
        closesAt: timelineSteps.closesAt,
      })
      .from(timelineSteps)
      .innerJoin(timelines, eq(timelines.id, timelineSteps.timelineId))
      .where(
        inArray(timelineSteps.timelineId, [
          ...new Set(found.map((row) => row.timelineId)),
        ]),
      )
      .orderBy(asc(timelineSteps.timelineId), asc(timelineSteps.position));
    const last = new Map<number, (typeof steps)[number]>();
    for (const step of steps) last.set(step.timelineId, step);

    return found
      .sort((a, b) => a.id - b.id)
      .map((row) => {
        const step = last.get(row.timelineId);
        // Every timeline has a step 1 (FR-9 of *timelines*): a membership whose
        // timeline has none is corrupt data, never a result that may be loaded.
        if (!step) {
          throw new TimelineHasNoStepsError(row.timelineId);
        }
        return {
          ...row,
          timelineName: step.timelineName,
          lastStepClosesAt: step.closesAt,
        };
      });
  }

  async listByTimeline(timelineId: number): Promise<LoadRow[]> {
    const rows = await this.db
      .select({ load: timelineLoads, nickname: users.nickname })
      .from(timelineLoads)
      .innerJoin(users, eq(users.id, timelineLoads.startedBy))
      .where(eq(timelineLoads.timelineId, timelineId))
      .orderBy(desc(timelineLoads.id));
    return rows.map(({ load, nickname }) => ({
      load,
      startedBy: { id: load.startedBy, nickname },
    }));
  }

  async findLoad(
    timelineId: number,
    loadId: number,
  ): Promise<LoadRow | undefined> {
    const [row] = await this.db
      .select({ load: timelineLoads, nickname: users.nickname })
      .from(timelineLoads)
      .innerJoin(users, eq(users.id, timelineLoads.startedBy))
      .where(
        and(
          eq(timelineLoads.id, loadId),
          eq(timelineLoads.timelineId, timelineId),
        ),
      )
      .limit(1);
    return (
      row && {
        load: row.load,
        startedBy: { id: row.load.startedBy, nickname: row.nickname },
      }
    );
  }

  async lockCycleShared(cycleId: number): Promise<LockedCycle | undefined> {
    const [row] = await this.db
      .select({ status: cycles.status, year: cycles.year })
      .from(cycles)
      .where(eq(cycles.id, cycleId))
      .limit(1)
      .for('share');
    return row;
  }

  async findTimelineForUpdate(
    timelineId: number,
  ): Promise<Timeline | undefined> {
    const [row] = await this.db
      .select()
      .from(timelines)
      .where(eq(timelines.id, timelineId))
      .limit(1)
      .for('update');
    return row;
  }

  async findStepOne(timelineId: number): Promise<StepOne | undefined> {
    const [row] = await this.db
      .select({ id: timelineSteps.id, closesAt: timelineSteps.closesAt })
      .from(timelineSteps)
      .where(
        and(
          eq(timelineSteps.timelineId, timelineId),
          eq(timelineSteps.position, 1),
        ),
      )
      .limit(1);
    return row;
  }

  async findScope(
    timelineId: number,
  ): Promise<{ programIds: number[]; resultTypeKeys: string[] }> {
    const programs = await this.db
      .select({ programId: timelinePrograms.programId })
      .from(timelinePrograms)
      .where(eq(timelinePrograms.timelineId, timelineId))
      .orderBy(asc(timelinePrograms.programId));
    const resultTypes = await this.db
      .select({ resultTypeKey: timelineResultTypes.resultTypeKey })
      .from(timelineResultTypes)
      .where(eq(timelineResultTypes.timelineId, timelineId))
      .orderBy(asc(timelineResultTypes.resultTypeKey));
    return {
      programIds: programs.map((row) => row.programId),
      resultTypeKeys: resultTypes.map((row) => row.resultTypeKey),
    };
  }

  async lockRunningLoad(cycleId: number): Promise<TimelineLoad | undefined> {
    // Through the unique index on `running_key`: at most one row, and under
    // READ COMMITTED a miss locks nothing, so the insert's unique key decides.
    const [row] = await this.db
      .select()
      .from(timelineLoads)
      .where(eq(timelineLoads.runningKey, cycleId))
      .limit(1)
      .for('update');
    return row;
  }

  async lockLoad(loadId: number): Promise<TimelineLoad | undefined> {
    const [row] = await this.db
      .select()
      .from(timelineLoads)
      .where(eq(timelineLoads.id, loadId))
      .limit(1)
      .for('update');
    return row;
  }

  async findLoadById(loadId: number): Promise<TimelineLoad | undefined> {
    const [row] = await this.db
      .select()
      .from(timelineLoads)
      .where(eq(timelineLoads.id, loadId))
      .limit(1);
    return row;
  }

  async findRunningLoad(cycleId: number): Promise<TimelineLoad | undefined> {
    const [row] = await this.db
      .select()
      .from(timelineLoads)
      .where(eq(timelineLoads.runningKey, cycleId))
      .limit(1);
    return row;
  }

  async lockTimelineShared(timelineId: number): Promise<void> {
    await this.db
      .select({ id: timelines.id })
      .from(timelines)
      .where(eq(timelines.id, timelineId))
      .limit(1)
      .for('share');
  }

  async insertLoad(values: NewLoadValues): Promise<LoadInsertOutcome> {
    try {
      // `running_key` is generated and never written; `total`, `failure_reason`
      // and `finished_at` start NULL.
      const [header] = await this.db.insert(timelineLoads).values({
        cycleId: values.cycleId,
        timelineId: values.timelineId,
        timelineStepId: values.timelineStepId,
        phaseYear: values.phaseYear,
        scope: values.scope,
        status: 'running',
        processed: 0,
        summary: summaryJson(values.summary),
        startedBy: values.startedBy,
        startedAt: values.startedAt,
        heartbeatAt: values.startedAt,
        requestId: values.requestId,
      });
      return { kind: 'created', loadId: header.insertId };
    } catch (error) {
      if (duplicateKeyText(error)?.includes(LOADS_RUNNING_KEY)) {
        return { kind: 'already_running' };
      }
      throw error;
    }
  }

  async endLoad(loadId: number, values: LoadEndValues): Promise<boolean> {
    // The status is in the WHERE: the database decides, so a load that ended
    // meanwhile matches nothing and is never ended twice.
    const [header] = await this.db
      .update(timelineLoads)
      .set({
        status: values.status,
        failureReason: values.failureReason,
        finishedAt: values.finishedAt,
      })
      .where(
        and(eq(timelineLoads.id, loadId), eq(timelineLoads.status, 'running')),
      );
    return header.affectedRows > 0;
  }

  async bumpTimelineVersion(timelineId: number): Promise<void> {
    await this.db
      .update(timelines)
      .set({ version: sql`${timelines.version} + 1` })
      .where(eq(timelines.id, timelineId));
  }

  async insertAuditEvent(values: NewTimelineAuditEvent): Promise<void> {
    await this.db.insert(timelineAuditEvents).values(values);
  }

  async insertMembership(
    values: NewMembershipValues,
  ): Promise<MembershipInsertOutcome> {
    try {
      // `active_key` is generated and never written.
      await this.db.insert(timelineResults).values(values);
      return { kind: 'created' };
    } catch (error) {
      const text = duplicateKeyText(error);
      if (text?.includes(RESULTS_ACTIVE_KEY)) {
        return { kind: 'duplicate', key: 'active_key' };
      }
      if (text?.includes(RESULTS_TIMELINE_CODE_KEY)) {
        return { kind: 'duplicate', key: 'timeline_code' };
      }
      throw error;
    }
  }

  async recordProgress(
    loadId: number,
    values: LoadProgressValues,
  ): Promise<void> {
    await this.db
      .update(timelineLoads)
      .set({
        processed: values.processed,
        summary: summaryJson(values.summary),
        heartbeatAt: values.heartbeatAt,
      })
      .where(eq(timelineLoads.id, loadId));
  }

  async setTotal(loadId: number, total: number): Promise<boolean> {
    const [header] = await this.db
      .update(timelineLoads)
      .set({ total })
      .where(
        and(eq(timelineLoads.id, loadId), eq(timelineLoads.status, 'running')),
      );
    return header.affectedRows > 0;
  }

  async renewHeartbeat(loadId: number, at: Date): Promise<boolean> {
    const [header] = await this.db
      .update(timelineLoads)
      .set({ heartbeatAt: at })
      .where(
        and(eq(timelineLoads.id, loadId), eq(timelineLoads.status, 'running')),
      );
    return header.affectedRows > 0;
  }

  async endMemberships(
    ids: readonly number[],
    endedAt: Date,
    reason: TimelineResultEndReason,
  ): Promise<number> {
    let ended = 0;
    for (let at = 0; at < ids.length; at += RESULT_CODE_CHUNK) {
      const [header] = await this.db
        .update(timelineResults)
        .set({ endedAt, endReason: reason })
        .where(
          and(
            inArray(timelineResults.id, ids.slice(at, at + RESULT_CODE_CHUNK)),
            isNull(timelineResults.endedAt),
          ),
        );
      ended += header.affectedRows;
    }
    return ended;
  }
}
