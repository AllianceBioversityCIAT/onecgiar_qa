import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, inArray, isNull } from 'drizzle-orm';
import { DRIZZLE } from '../../database/drizzle/drizzle.constants.js';
import type { DrizzleDB } from '../../database/drizzle/drizzle.module.js';
import { cycles } from '../../database/drizzle/schema/cycles.js';
import { roles } from '../../database/drizzle/schema/roles.js';
import {
  timelinePrograms,
  type TimelineProgram,
} from '../../database/drizzle/schema/timeline-programs.js';
import {
  timelineResultTypes,
  type TimelineResultType,
} from '../../database/drizzle/schema/timeline-result-types.js';
import {
  timelineSteps,
  type NewTimelineStep,
  type TimelineStep,
} from '../../database/drizzle/schema/timeline-steps.js';
import { timelineUsers } from '../../database/drizzle/schema/timeline-users.js';
import {
  timelines,
  type NewTimeline,
  type Timeline,
} from '../../database/drizzle/schema/timelines.js';

export const TIMELINES_STORE = Symbol('TIMELINES_STORE');

/** The unique keys of `timelines` an insert can hit (design 5). */
export const TIMELINE_NAME_KEY = 'uq_timelines_cycle_name';
export const TIMELINE_OFFICIAL_KEY = 'uq_timelines_official_key';

/** How an insert of a timeline ended: written, or refused by one of the two unique keys. */
export type TimelineInsertOutcome =
  | { kind: 'created'; timelineId: number }
  | { kind: 'name_taken' }
  | { kind: 'official_taken' };

/** A step as the service hands it over; the timeline id is the one just inserted. */
export type NewStepValues = Omit<NewTimelineStep, 'id' | 'timelineId'>;

/** The rows of one timeline, as read (design 6, 7.4). Ordering is the mapper's job. */
export interface TimelineBundle {
  timeline: Timeline;
  steps: TimelineStep[];
  programIds: number[];
  resultTypeKeys: string[];
}

/** Active assignments of one role in one timeline: the rows `removed_at IS NULL`, counted (FR-13). */
export interface AssignedCountRow {
  timelineId: number;
  roleCode: string;
  count: number;
}

/** The persistence port of timelines, steps and scope (design 3, 5, 7.3). Rules live in `TimelinesService`. */
export interface TimelinesStore {
  /**
   * `INSERT`; a taken name in the cycle (`uq_timelines_cycle_name`) is
   * `name_taken`, a second official (`uq_timelines_official_key`) is
   * `official_taken`. Any other failure is thrown.
   */
  insert(values: NewTimeline): Promise<TimelineInsertOutcome>;
  /** Whether the cycle has its official timeline, through `uq_timelines_official_key`. A plain read. */
  hasOfficial(cycleId: number): Promise<boolean>;
  /** Rows only while `all_programs` is false (DD-6). */
  insertPrograms(
    timelineId: number,
    programIds: readonly number[],
  ): Promise<void>;
  /** Rows only while `all_result_types` is false (DD-6). */
  insertResultTypes(
    timelineId: number,
    resultTypeKeys: readonly string[],
  ): Promise<void>;
  insertSteps(
    timelineId: number,
    steps: readonly NewStepValues[],
  ): Promise<void>;
  /**
   * The read model is assembled from these, one statement each, so the number
   * of statements does not depend on the number of timelines (NFR-5, design
   * 7.4). Reads never lock and never write (DD-2).
   */
  findById(id: number): Promise<Timeline | undefined>;
  /** Whether the cycle exists: the list of an unknown cycle is a 404, not an empty list (FR-12). */
  cycleExists(cycleId: number): Promise<boolean>;
  /** Every timeline of a cycle, in no particular order. */
  listByCycle(cycleId: number): Promise<Timeline[]>;
  /** The steps of all the given timelines, in ONE statement. `timelineIds` is never empty. */
  listSteps(timelineIds: readonly number[]): Promise<TimelineStep[]>;
  listPrograms(timelineIds: readonly number[]): Promise<TimelineProgram[]>;
  listResultTypes(
    timelineIds: readonly number[],
  ): Promise<TimelineResultType[]>;
  /** Active assignments per timeline and role code (`removed_at IS NULL`), in ONE statement. */
  countAssigned(timelineIds: readonly number[]): Promise<AssignedCountRow[]>;
}

/**
 * The text of the MySQL duplicate-key error (1062) in an error chain: the
 * driver error, or the `cause` a wrapper carries. It names the unique key that
 * refused the row, which is how the two keys of `timelines` are told apart.
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

type TimelinesDb = Pick<DrizzleDB, 'select' | 'insert'>;

/** Drizzle adapter of `TimelinesStore`. `db` is the pool for reads or a transaction handle (`DrizzleTimelinesUnitOfWork`). */
@Injectable()
export class DrizzleTimelinesStore implements TimelinesStore {
  constructor(@Inject(DRIZZLE) private readonly db: TimelinesDb) {}

  async insert(values: NewTimeline): Promise<TimelineInsertOutcome> {
    try {
      const [header] = await this.db.insert(timelines).values(values);
      return { kind: 'created', timelineId: header.insertId };
    } catch (error) {
      const text = duplicateKeyText(error);
      if (text?.includes(TIMELINE_NAME_KEY)) return { kind: 'name_taken' };
      if (text?.includes(TIMELINE_OFFICIAL_KEY)) {
        return { kind: 'official_taken' };
      }
      throw error;
    }
  }

  async hasOfficial(cycleId: number): Promise<boolean> {
    // Through the unique index on `official_key` (it holds the cycle id while
    // the timeline is official), so the read is one index probe.
    const rows = await this.db
      .select({ id: timelines.id })
      .from(timelines)
      .where(eq(timelines.officialKey, cycleId))
      .limit(1);
    return rows.length > 0;
  }

  async insertPrograms(timelineId: number, programIds: readonly number[]) {
    if (programIds.length === 0) return;
    await this.db
      .insert(timelinePrograms)
      .values(programIds.map((programId) => ({ timelineId, programId })));
  }

  async insertResultTypes(
    timelineId: number,
    resultTypeKeys: readonly string[],
  ) {
    if (resultTypeKeys.length === 0) return;
    await this.db
      .insert(timelineResultTypes)
      .values(
        resultTypeKeys.map((resultTypeKey) => ({ timelineId, resultTypeKey })),
      );
  }

  async insertSteps(timelineId: number, steps: readonly NewStepValues[]) {
    if (steps.length === 0) return;
    await this.db
      .insert(timelineSteps)
      .values(steps.map((step) => ({ ...step, timelineId })));
  }

  async findById(id: number): Promise<Timeline | undefined> {
    const [row] = await this.db
      .select()
      .from(timelines)
      .where(eq(timelines.id, id))
      .limit(1);
    return row;
  }

  async cycleExists(cycleId: number): Promise<boolean> {
    const rows = await this.db
      .select({ id: cycles.id })
      .from(cycles)
      .where(eq(cycles.id, cycleId))
      .limit(1);
    return rows.length > 0;
  }

  listByCycle(cycleId: number): Promise<Timeline[]> {
    return this.db
      .select()
      .from(timelines)
      .where(eq(timelines.cycleId, cycleId));
  }

  listSteps(timelineIds: readonly number[]): Promise<TimelineStep[]> {
    return this.db
      .select()
      .from(timelineSteps)
      .where(inArray(timelineSteps.timelineId, [...timelineIds]))
      .orderBy(asc(timelineSteps.position));
  }

  listPrograms(timelineIds: readonly number[]): Promise<TimelineProgram[]> {
    return this.db
      .select()
      .from(timelinePrograms)
      .where(inArray(timelinePrograms.timelineId, [...timelineIds]))
      .orderBy(asc(timelinePrograms.programId));
  }

  listResultTypes(
    timelineIds: readonly number[],
  ): Promise<TimelineResultType[]> {
    return this.db
      .select()
      .from(timelineResultTypes)
      .where(inArray(timelineResultTypes.timelineId, [...timelineIds]))
      .orderBy(asc(timelineResultTypes.resultTypeKey));
  }

  countAssigned(timelineIds: readonly number[]): Promise<AssignedCountRow[]> {
    return this.db
      .select({
        timelineId: timelineUsers.timelineId,
        roleCode: roles.code,
        count: count(),
      })
      .from(timelineUsers)
      .innerJoin(roles, eq(roles.id, timelineUsers.roleId))
      .where(
        and(
          inArray(timelineUsers.timelineId, [...timelineIds]),
          isNull(timelineUsers.removedAt),
        ),
      )
      .groupBy(timelineUsers.timelineId, roles.code);
  }
}
