import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../database/drizzle/drizzle.constants.js';
import type { DrizzleDB } from '../../database/drizzle/drizzle.module.js';
import {
  cycles,
  type CycleStatus,
} from '../../database/drizzle/schema/cycles.js';
import { roles } from '../../database/drizzle/schema/roles.js';
import {
  timelineAuditEvents,
  type TimelineAuditAction,
  type TimelineAuditChanges,
} from '../../database/drizzle/schema/timeline-audit-events.js';
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
import {
  timelineUsers,
  type TimelineUser,
} from '../../database/drizzle/schema/timeline-users.js';
import {
  timelines,
  type NewTimeline,
  type Timeline,
} from '../../database/drizzle/schema/timelines.js';
import { users } from '../../database/drizzle/schema/users.js';

export const TIMELINES_STORE = Symbol('TIMELINES_STORE');

/** The unique keys of `timelines` an insert can hit (design 5). */
export const TIMELINE_NAME_KEY = 'uq_timelines_cycle_name';
export const TIMELINE_OFFICIAL_KEY = 'uq_timelines_official_key';
/** The unique key of `timeline_users`: never a second active row for one user and role (FR-14). */
export const TIMELINE_USER_ACTIVE_KEY = 'uq_timeline_users_active_key';

/** How an insert of an assignment ended: written, or refused by `uq_timeline_users_active_key`. */
export type AssignmentInsertOutcome =
  { kind: 'created'; assignmentId: number } | { kind: 'duplicate' };

/** The values of a new assignment (`assigned_by` is the acting ADMIN). */
export interface NewAssignmentValues {
  timelineId: number;
  userId: number;
  roleId: number;
  assignedAt: Date;
  assignedBy: number;
}

/** One active assignment with the user it names and the role code, for the detail (design 7.4). */
export interface ActiveAssignmentRow {
  assignmentId: number;
  userId: number;
  firstName: string | null;
  lastName: string | null;
  email: string;
  roleCode: string;
  assignedAt: Date;
}

/** How an insert of a timeline ended: written, or refused by one of the two unique keys. */
export type TimelineInsertOutcome =
  | { kind: 'created'; timelineId: number }
  | { kind: 'name_taken' }
  | { kind: 'official_taken' };

/** A step as the service hands it over; the timeline id is the one just inserted. */
export type NewStepValues = Omit<NewTimelineStep, 'id' | 'timelineId'>;

/**
 * How the conditional UPDATE of a timeline ended (timeline-edit design 7.3,
 * DD-6): applied, refused because the version moved (or the row is gone), or
 * refused by `uq_timelines_cycle_name`.
 */
export type TimelineUpdateOutcome =
  { kind: 'updated' } | { kind: 'stale' } | { kind: 'name_taken' };

/**
 * What an applied edit writes on the `timelines` row besides `version =
 * version + 1` (FR-9, FR-10). A field left out is not written. Never `kind`,
 * `cycle_id` or `created_*`: an edit cannot change them (S-4).
 */
export interface TimelineUpdateValues {
  name?: string;
  allPrograms?: boolean;
  allResultTypes?: boolean;
  updatedAt: Date;
  updatedBy: number;
}

/** The step fields an edit can change (FR-1, S-4): never audience, round or `requires_load`. A field left out is not written. */
export type StepUpdateValues = Partial<
  Pick<NewTimelineStep, 'name' | 'opensOn' | 'closesOn'>
>;

/** One audit row of an applied edit (FR-10, DD-10): `createdAt` is the edit's instant, the same as `updated_at`. */
export interface NewAuditEventValues {
  timelineId: number;
  actorId: number;
  action: TimelineAuditAction;
  changes: TimelineAuditChanges;
  requestId: string | null;
  createdAt: Date;
}

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
  /** The active assignments of one timeline joined with `users` and `roles`, oldest first, in ONE statement. */
  listActiveAssignments(timelineId: number): Promise<ActiveAssignmentRow[]>;
  /**
   * `SELECT status FROM cycles WHERE id = ? FOR SHARE` (design 7.3): an assign or
   * a remove holds the cycle row shared, so an activation that closes it (it takes
   * `FOR UPDATE`) waits for the write or is seen by it. `undefined` = no such cycle.
   */
  lockCycleShared(cycleId: number): Promise<CycleStatus | undefined>;
  /** `roles.id` of a role code. */
  findRoleId(roleCode: string): Promise<number | undefined>;
  /**
   * `INSERT`; a second active row for the same timeline, user and role
   * (`uq_timeline_users_active_key`, MySQL 1062) is `duplicate`. Any other
   * failure is thrown.
   */
  insertAssignment(
    values: NewAssignmentValues,
  ): Promise<AssignmentInsertOutcome>;
  /** The active row of this user and role in the timeline, if any (the answer to a repeat assign). */
  findActiveAssignment(
    timelineId: number,
    userId: number,
    roleId: number,
  ): Promise<TimelineUser | undefined>;
  /**
   * `UPDATE ... SET removed_at, removed_by WHERE id AND timeline_id AND removed_at
   * IS NULL`: the row is kept (FR-15). `false` = no active row matched.
   */
  removeAssignment(change: {
    timelineId: number;
    assignmentId: number;
    removedAt: Date;
    removedBy: number;
  }): Promise<boolean>;
  /**
   * The row plus steps, programs and result types in a fixed four statements
   * (timeline-edit design 7.3): the unlocked reads of the edit's step 2. The row
   * is read FIRST, so an edit that commits between the statements has already
   * moved the version the caller saw, and the locked re-check refuses it (DD-6).
   * `undefined` = no such timeline.
   */
  findBundle(id: number): Promise<TimelineBundle | undefined>;
  /**
   * `SELECT ... FOR UPDATE` of the timeline row (DD-9: the cycle row first, then
   * this one). The caller compares the version it returns with the one the
   * request named. `undefined` = no such timeline.
   */
  findForUpdate(id: number): Promise<Timeline | undefined>;
  /**
   * `UPDATE timelines SET version = version + 1, updated_at, updated_by [, name,
   * all_programs, all_result_types] WHERE id = ? AND version = ?` (DD-6). The
   * affected-row count decides, never a read before it: 0 rows is `stale`, a
   * 1062 on `uq_timelines_cycle_name` is `name_taken`, any other failure is
   * thrown.
   */
  updateTimeline(
    id: number,
    expectedVersion: number,
    values: TimelineUpdateValues,
  ): Promise<TimelineUpdateOutcome>;
  /**
   * `UPDATE timeline_steps SET ... WHERE timeline_id = ? AND position = ?`: one
   * statement per changed step. `false` = no step at that position.
   */
  updateStep(
    timelineId: number,
    position: number,
    values: StepUpdateValues,
  ): Promise<boolean>;
  /** DELETE the timeline's program rows, then INSERT the new list (none while `all_programs` is true; DD-6 of *timelines*). */
  replacePrograms(
    timelineId: number,
    programIds: readonly number[],
  ): Promise<void>;
  /** As `replacePrograms`, for the result-type rows. */
  replaceResultTypes(
    timelineId: number,
    resultTypeKeys: readonly string[],
  ): Promise<void>;
  /** `INSERT` one audit row; append-only, written on the edit's transaction (FR-10, DD-10). */
  insertAuditEvent(values: NewAuditEventValues): Promise<void>;
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

type TimelinesDb = Pick<DrizzleDB, 'select' | 'insert' | 'update' | 'delete'>;

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

  listActiveAssignments(timelineId: number): Promise<ActiveAssignmentRow[]> {
    return this.db
      .select({
        assignmentId: timelineUsers.id,
        userId: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        roleCode: roles.code,
        assignedAt: timelineUsers.assignedAt,
      })
      .from(timelineUsers)
      .innerJoin(users, eq(users.id, timelineUsers.userId))
      .innerJoin(roles, eq(roles.id, timelineUsers.roleId))
      .where(
        and(
          eq(timelineUsers.timelineId, timelineId),
          isNull(timelineUsers.removedAt),
        ),
      )
      .orderBy(asc(timelineUsers.assignedAt), asc(timelineUsers.id));
  }

  async lockCycleShared(cycleId: number): Promise<CycleStatus | undefined> {
    const [row] = await this.db
      .select({ status: cycles.status })
      .from(cycles)
      .where(eq(cycles.id, cycleId))
      .limit(1)
      .for('share');
    return row?.status;
  }

  async findRoleId(roleCode: string): Promise<number | undefined> {
    const [row] = await this.db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.code, roleCode))
      .limit(1);
    return row?.id;
  }

  async insertAssignment(
    values: NewAssignmentValues,
  ): Promise<AssignmentInsertOutcome> {
    try {
      const [header] = await this.db.insert(timelineUsers).values(values);
      return { kind: 'created', assignmentId: header.insertId };
    } catch (error) {
      if (duplicateKeyText(error)?.includes(TIMELINE_USER_ACTIVE_KEY)) {
        return { kind: 'duplicate' };
      }
      throw error;
    }
  }

  async findActiveAssignment(
    timelineId: number,
    userId: number,
    roleId: number,
  ): Promise<TimelineUser | undefined> {
    const [row] = await this.db
      .select()
      .from(timelineUsers)
      .where(
        and(
          eq(timelineUsers.timelineId, timelineId),
          eq(timelineUsers.userId, userId),
          eq(timelineUsers.roleId, roleId),
          isNull(timelineUsers.removedAt),
        ),
      )
      .limit(1);
    return row;
  }

  async removeAssignment(change: {
    timelineId: number;
    assignmentId: number;
    removedAt: Date;
    removedBy: number;
  }): Promise<boolean> {
    const [header] = await this.db
      .update(timelineUsers)
      .set({ removedAt: change.removedAt, removedBy: change.removedBy })
      .where(
        and(
          eq(timelineUsers.id, change.assignmentId),
          eq(timelineUsers.timelineId, change.timelineId),
          isNull(timelineUsers.removedAt),
        ),
      );
    return header.affectedRows > 0;
  }

  async findBundle(id: number): Promise<TimelineBundle | undefined> {
    // The row first, then the rest: see the port (a version that moved in
    // between is refused by the locked re-check). Four statements, whatever the
    // number of steps.
    const timeline = await this.findById(id);
    if (!timeline) return undefined;
    const steps = await this.listSteps([id]);
    const programs = await this.listPrograms([id]);
    const resultTypes = await this.listResultTypes([id]);
    return {
      timeline,
      steps,
      programIds: programs.map((row) => row.programId),
      resultTypeKeys: resultTypes.map((row) => row.resultTypeKey),
    };
  }

  async findForUpdate(id: number): Promise<Timeline | undefined> {
    const [row] = await this.db
      .select()
      .from(timelines)
      .where(eq(timelines.id, id))
      .limit(1)
      .for('update');
    return row;
  }

  async updateTimeline(
    id: number,
    expectedVersion: number,
    values: TimelineUpdateValues,
  ): Promise<TimelineUpdateOutcome> {
    try {
      // The version is in the WHERE, so the database decides (DD-6, KZ
      // cycle-timelines-1): a row whose version moved matches nothing. A field
      // left `undefined` is not written (drizzle drops it from the SET).
      const [header] = await this.db
        .update(timelines)
        .set({
          name: values.name,
          allPrograms: values.allPrograms,
          allResultTypes: values.allResultTypes,
          version: sql`${timelines.version} + 1`,
          updatedAt: values.updatedAt,
          updatedBy: values.updatedBy,
        })
        .where(
          and(eq(timelines.id, id), eq(timelines.version, expectedVersion)),
        );
      return header.affectedRows > 0 ? { kind: 'updated' } : { kind: 'stale' };
    } catch (error) {
      if (duplicateKeyText(error)?.includes(TIMELINE_NAME_KEY)) {
        return { kind: 'name_taken' };
      }
      throw error;
    }
  }

  async updateStep(
    timelineId: number,
    position: number,
    values: StepUpdateValues,
  ): Promise<boolean> {
    const [header] = await this.db
      .update(timelineSteps)
      .set({
        name: values.name,
        opensOn: values.opensOn,
        closesOn: values.closesOn,
      })
      .where(
        and(
          eq(timelineSteps.timelineId, timelineId),
          eq(timelineSteps.position, position),
        ),
      );
    return header.affectedRows > 0;
  }

  async replacePrograms(
    timelineId: number,
    programIds: readonly number[],
  ): Promise<void> {
    await this.db
      .delete(timelinePrograms)
      .where(eq(timelinePrograms.timelineId, timelineId));
    await this.insertPrograms(timelineId, programIds);
  }

  async replaceResultTypes(
    timelineId: number,
    resultTypeKeys: readonly string[],
  ): Promise<void> {
    await this.db
      .delete(timelineResultTypes)
      .where(eq(timelineResultTypes.timelineId, timelineId));
    await this.insertResultTypes(timelineId, resultTypeKeys);
  }

  async insertAuditEvent(values: NewAuditEventValues): Promise<void> {
    await this.db.insert(timelineAuditEvents).values(values);
  }
}
