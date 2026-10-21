import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { DRIZZLE } from '../../database/drizzle/drizzle.constants.js';
import type { DrizzleDB } from '../../database/drizzle/drizzle.module.js';
import { timelinePrograms } from '../../database/drizzle/schema/timeline-programs.js';
import { timelineResultTypes } from '../../database/drizzle/schema/timeline-result-types.js';
import {
  timelineSteps,
  type NewTimelineStep,
  type TimelineStep,
} from '../../database/drizzle/schema/timeline-steps.js';
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
  /** One timeline with its steps and scope, or `undefined`. */
  findBundle(id: number): Promise<TimelineBundle | undefined>;
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

  async findBundle(id: number): Promise<TimelineBundle | undefined> {
    const [timeline] = await this.db
      .select()
      .from(timelines)
      .where(eq(timelines.id, id))
      .limit(1);
    if (!timeline) return undefined;
    const steps = await this.db
      .select()
      .from(timelineSteps)
      .where(eq(timelineSteps.timelineId, id))
      .orderBy(asc(timelineSteps.position));
    const programs = await this.db
      .select({ programId: timelinePrograms.programId })
      .from(timelinePrograms)
      .where(eq(timelinePrograms.timelineId, id))
      .orderBy(asc(timelinePrograms.programId));
    const resultTypes = await this.db
      .select({ resultTypeKey: timelineResultTypes.resultTypeKey })
      .from(timelineResultTypes)
      .where(eq(timelineResultTypes.timelineId, id))
      .orderBy(asc(timelineResultTypes.resultTypeKey));
    return {
      timeline,
      steps,
      programIds: programs.map((row) => row.programId),
      resultTypeKeys: resultTypes.map((row) => row.resultTypeKey),
    };
  }
}
