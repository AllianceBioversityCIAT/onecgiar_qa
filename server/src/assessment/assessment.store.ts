// @akili-spec assessment/step-1-assessment
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import { DRIZZLE } from '../database/drizzle/drizzle.constants.js';
import type { DrizzleDB } from '../database/drizzle/drizzle.module.js';
import {
  assessmentComments,
  type CommentState,
  type CommentValueCopy,
} from '../database/drizzle/schema/assessment-comments.js';
import { commentEvents } from '../database/drizzle/schema/comment-events.js';
import { assessmentFieldValidations } from '../database/drizzle/schema/assessment-field-validations.js';
import { cycles } from '../database/drizzle/schema/cycles.js';
import { fieldConfigVersions } from '../database/drizzle/schema/field-config-versions.js';
import {
  resultAssessments,
  type ResultAssessmentStatus,
} from '../database/drizzle/schema/result-assessments.js';
import {
  timelineResults,
  type TimelineResultEndReason,
  type TimelineResultStatus,
} from '../database/drizzle/schema/timeline-results.js';
import { users } from '../database/drizzle/schema/users.js';
import {
  assessmentAuditEvents,
  type AssessmentAuditAction,
} from '../database/drizzle/schema/assessment-audit-events.js';
import { timelineSteps } from '../database/drizzle/schema/timeline-steps.js';
import { timelines } from '../database/drizzle/schema/timelines.js';
import type { WorklistAccess } from './scope.js';
import { scopeCondition, type WorklistStep } from './worklist.store.js';

// Port of the assessment reads (design 5, 6, 7.4; DD-3: a read never writes):
// three methods, one statement each. The write side below (T-10) is a second
// port that only the unit of work builds, on its transaction.

export const ASSESSMENT_STORE = Symbol('ASSESSMENT_STORE');

export interface MembershipCriteria {
  timelineId: number;
  resultCode: number;
  /** The same access the worklist is scoped by (FR-1): a membership outside it is not found. */
  access: WorklistAccess;
  /** ADMIN only: the round asked for; `null` = the reviewer's own round, or the latest for an ADMIN. */
  round: number | null;
  /** The step whose assessment is read; `null` when the timeline has none. */
  assessmentStepPosition: number | null;
}

/** A membership in scope, with the assessment of the role's step when one exists. */
export interface MembershipRecord {
  membershipId: number;
  resultCode: number;
  /** The title copied at load time; null until the backfill reaches the row. */
  title: string | null;
  programId: number;
  resultTypeKey: string;
  round: number;
  status: TimelineResultStatus;
  ended: boolean;
  endReason: TimelineResultEndReason | null;
  /** `timeline_results.snapshot_sk`, with the `SNAP#` prefix as the load runner wrote it (P-7). */
  snapshotSk: string;
  /** The year of the membership's cycle: the catalog year (P-14). */
  cycleYear: number;
  assessment: {
    id: number;
    status: ResultAssessmentStatus;
    /** The version NUMBER the assessment pinned (DD-3). */
    fieldConfigVersion: number;
    /** The id of that version's row, joined by (cycle, number); null when no such row exists (a defect). */
    fieldConfigVersionId: number | null;
    finishedAt: Date | null;
    finishedById: number | null;
    finishedByNickname: string | null;
  } | null;
}

export interface ValidationRecord {
  fieldKey: string;
  validated: boolean;
}

export interface CommentRecord {
  id: number;
  fieldKey: string;
  authorId: number;
  authorNickname: string | null;
  body: string;
  state: CommentState;
  stepPosition: number;
  round: number;
  valueCopy: CommentValueCopy;
  valueTruncated: boolean;
  createdAt: Date;
  withdrawnAt: Date | null;
}

/** A comment with where it lives: its assessment and membership (withdraw, and the replay reader). */
export interface CommentContext extends CommentRecord {
  assessmentId: number;
  timelineResultId: number;
  timelineId: number;
  resultCode: number;
}

export interface AssessmentStore {
  /**
   * One statement: the membership of (timeline, result code) inside the
   * caller's scope, its cycle year, the assessment of the role's step and the
   * id of the field-configuration version that assessment pinned.
   * `null` when none is in scope, which is the same as none existing.
   */
  findMembership(
    criteria: MembershipCriteria,
  ): Promise<MembershipRecord | null>;
  /** One statement: the field validations of an assessment. */
  findValidations(assessmentId: number): Promise<ValidationRecord[]>;
  /** One statement: the comments of an assessment, oldest first, with the author's nickname. */
  findComments(assessmentId: number): Promise<CommentRecord[]>;
  /**
   * One statement: a comment by id with its author's nickname, its assessment
   * and its membership. `null` when there is none. Nothing here checks the
   * caller's scope: the service does, and answers the same 404.
   */
  findCommentContext(commentId: number): Promise<CommentContext | null>;
}

// ---- Write port (T-10) -----------------------------------------------------

/** The assessment row to create on the first write (DD-3): it pins the field-configuration version. */
export interface NewAssessmentRow {
  timelineResultId: number;
  stepPosition: number;
  roleCode: string;
  /** The version NUMBER `effectiveFor` resolved at the first write. */
  fieldConfigVersion: number;
  createdBy: number;
  at: Date;
}

/** The assessment row as read under `FOR UPDATE`. */
export interface LockedAssessment {
  id: number;
  status: ResultAssessmentStatus;
  fieldConfigVersion: number;
}

export interface ValidationWrite {
  fieldKey: string;
  validated: boolean;
}

/** One append-only audit row (FR-21): ids and keys only, never a body or a value. */
export interface AuditEventWrite {
  assessmentId: number;
  actorId: number;
  action: AssessmentAuditAction;
  fieldKeys: readonly string[] | null;
  commentId: number | null;
  requestId: string | null;
  at: Date;
}

/** The comment to insert (FR-11): always `open`, never visible to the program yet. */
export interface NewCommentRow {
  assessmentId: number;
  fieldKey: string;
  authorId: number;
  stepPosition: number;
  round: number;
  body: string;
  valueCopy: CommentValueCopy;
  valueTruncated: boolean;
  at: Date;
}

/** One append-only `comment_events` row (ADR-006): ids and states, never a body. */
export interface CommentEventWrite {
  commentId: number;
  actorId: number;
  actorRole: string;
  fromState: CommentState | null;
  toState: CommentState;
  at: Date;
}

/**
 * The statements of one assessment write, bound to ONE transaction by the unit
 * of work (design 5, 7.5). Their order is the lock order: the timeline
 * `FOR SHARE`, then the assessment row `FOR UPDATE`, then the rows under it.
 */
export interface AssessmentWriteStore {
  /**
   * Two statements: the timeline row `FOR SHARE`, then its steps (stable under
   * that lock, because a timeline edit takes the row `FOR UPDATE` first).
   * `null` when the timeline is gone.
   */
  lockTimelineShared(timelineId: number): Promise<WorklistStep[] | null>;
  /**
   * One statement: `INSERT … ON DUPLICATE KEY UPDATE id = id`. A duplicate
   * changes nothing (the pinned version and the creator stay), but it is not a
   * free no-op: the duplicate-key path takes an EXCLUSIVE lock on the existing
   * row, so a second first writer waits here for the first one's commit.
   */
  ensureAssessment(row: NewAssessmentRow): Promise<void>;
  /** One statement: the row of (membership, step) `FOR UPDATE`. */
  lockAssessment(
    timelineResultId: number,
    stepPosition: number,
  ): Promise<LockedAssessment | undefined>;
  /** One statement: the validations of the assessment, read under its lock. */
  findValidations(assessmentId: number): Promise<ValidationRecord[]>;
  /** One statement for any number of rows; none for an empty list. */
  upsertValidations(
    assessmentId: number,
    rows: readonly ValidationWrite[],
    actorId: number,
    at: Date,
  ): Promise<void>;
  /** One statement. */
  insertAudit(event: AuditEventWrite): Promise<void>;
  /** One statement: the comment, `open`. Returns its id. */
  insertComment(row: NewCommentRow): Promise<number>;
  /**
   * One conditional statement: `open` to `withdrawn` where the comment is
   * still `open`. `false` when it matched nothing (another request got there,
   * or the program answered): the database decides the race, not a prior read.
   */
  withdrawComment(commentId: number, at: Date): Promise<boolean>;
  /** One statement. */
  insertCommentEvent(event: CommentEventWrite): Promise<void>;
}

// ---- Drizzle adapter -------------------------------------------------------

type AssessmentDb = Pick<DrizzleDB, 'select'>;

const t = timelineResults;
const a = resultAssessments;

/** Drizzle adapter of `AssessmentStore`: read-only. */
@Injectable()
export class DrizzleAssessmentStore implements AssessmentStore {
  constructor(@Inject(DRIZZLE) private readonly db: AssessmentDb) {}

  /** The membership statement; public so a spec can read its SQL. */
  buildMembershipQuery(criteria: MembershipCriteria) {
    const round: SQL | undefined =
      criteria.access.admin && criteria.round !== null
        ? eq(t.entryRound, criteria.round)
        : undefined;
    return (
      this.db
        .select({
          membershipId: t.id,
          resultCode: t.resultCode,
          title: t.title,
          programId: t.programClarisaId,
          resultTypeKey: t.resultTypeKey,
          round: t.entryRound,
          status: t.status,
          endedAt: t.endedAt,
          endReason: t.endReason,
          snapshotSk: t.snapshotSk,
          cycleYear: cycles.year,
          assessmentId: a.id,
          assessmentStatus: a.status,
          fieldConfigVersion: a.fieldConfigVersion,
          fieldConfigVersionId: fieldConfigVersions.id,
          finishedAt: a.finishedAt,
          finishedById: users.id,
          finishedByNickname: users.nickname,
        })
        .from(t)
        .innerJoin(cycles, eq(cycles.id, t.cycleId))
        .leftJoin(
          a,
          and(
            eq(a.timelineResultId, t.id),
            // Position 0 never exists (positions are 1 to 5): no step, no assessment.
            eq(a.stepPosition, criteria.assessmentStepPosition ?? 0),
          ),
        )
        .leftJoin(users, eq(users.id, a.finishedBy))
        // The pinned NUMBER is the version of the membership's cycle: its row id, with no extra statement.
        .leftJoin(
          fieldConfigVersions,
          and(
            eq(fieldConfigVersions.cycleId, t.cycleId),
            eq(fieldConfigVersions.number, a.fieldConfigVersion),
          ),
        )
        .where(
          and(
            eq(t.timelineId, criteria.timelineId),
            eq(t.resultCode, criteria.resultCode),
            // The worklist's own scope condition: one definition of "in scope".
            scopeCondition(criteria.access),
            round,
          ),
        )
        // Two rounds of one result: the reviewer's scope holds one; an ADMIN reads the latest.
        .orderBy(desc(t.entryRound))
        .limit(1)
    );
  }

  async findMembership(
    criteria: MembershipCriteria,
  ): Promise<MembershipRecord | null> {
    const [row] = await this.buildMembershipQuery(criteria);
    if (row === undefined) return null;
    return {
      membershipId: row.membershipId,
      resultCode: row.resultCode,
      title: row.title,
      programId: row.programId,
      resultTypeKey: row.resultTypeKey,
      round: row.round,
      status: row.status,
      ended: row.endedAt !== null,
      endReason: row.endReason,
      snapshotSk: row.snapshotSk,
      cycleYear: row.cycleYear,
      assessment:
        row.assessmentId === null ||
        row.assessmentStatus === null ||
        row.fieldConfigVersion === null
          ? null
          : {
              id: row.assessmentId,
              status: row.assessmentStatus,
              fieldConfigVersion: row.fieldConfigVersion,
              fieldConfigVersionId: row.fieldConfigVersionId,
              finishedAt: row.finishedAt,
              finishedById: row.finishedById,
              finishedByNickname: row.finishedByNickname,
            },
    };
  }

  /** The validations statement; public so a spec can read its SQL. */
  buildValidationsQuery(assessmentId: number) {
    return this.db
      .select({
        fieldKey: assessmentFieldValidations.fieldKey,
        validated: assessmentFieldValidations.validated,
      })
      .from(assessmentFieldValidations)
      .where(eq(assessmentFieldValidations.assessmentId, assessmentId));
  }

  async findValidations(assessmentId: number): Promise<ValidationRecord[]> {
    const rows = await this.buildValidationsQuery(assessmentId);
    return rows.map((row) => ({
      fieldKey: row.fieldKey,
      validated: row.validated,
    }));
  }

  /** The comments statement; public so a spec can read its SQL. */
  buildCommentsQuery(assessmentId: number) {
    return this.db
      .select({
        id: assessmentComments.id,
        fieldKey: assessmentComments.fieldKey,
        authorId: assessmentComments.authorId,
        authorNickname: users.nickname,
        body: assessmentComments.body,
        state: assessmentComments.state,
        stepPosition: assessmentComments.stepPosition,
        round: assessmentComments.round,
        valueCopy: assessmentComments.valueCopy,
        valueTruncated: assessmentComments.valueTruncated,
        createdAt: assessmentComments.createdAt,
        withdrawnAt: assessmentComments.withdrawnAt,
      })
      .from(assessmentComments)
      .innerJoin(users, eq(users.id, assessmentComments.authorId))
      .where(eq(assessmentComments.assessmentId, assessmentId))
      .orderBy(asc(assessmentComments.createdAt), asc(assessmentComments.id));
  }

  async findComments(assessmentId: number): Promise<CommentRecord[]> {
    return await this.buildCommentsQuery(assessmentId);
  }

  /** The comment-context statement; public so a spec can read its SQL. */
  buildCommentContextQuery(commentId: number) {
    return this.db
      .select({
        id: assessmentComments.id,
        fieldKey: assessmentComments.fieldKey,
        authorId: assessmentComments.authorId,
        authorNickname: users.nickname,
        body: assessmentComments.body,
        state: assessmentComments.state,
        stepPosition: assessmentComments.stepPosition,
        round: assessmentComments.round,
        valueCopy: assessmentComments.valueCopy,
        valueTruncated: assessmentComments.valueTruncated,
        createdAt: assessmentComments.createdAt,
        withdrawnAt: assessmentComments.withdrawnAt,
        assessmentId: a.id,
        timelineResultId: t.id,
        timelineId: t.timelineId,
        resultCode: t.resultCode,
      })
      .from(assessmentComments)
      .innerJoin(users, eq(users.id, assessmentComments.authorId))
      .innerJoin(a, eq(a.id, assessmentComments.assessmentId))
      .innerJoin(t, eq(t.id, a.timelineResultId))
      .where(eq(assessmentComments.id, commentId))
      .limit(1);
  }

  async findCommentContext(commentId: number): Promise<CommentContext | null> {
    const [row] = await this.buildCommentContextQuery(commentId);
    return row ?? null;
  }
}

// ---- Drizzle write adapter (T-10) -------------------------------------------

type AssessmentWriteDb = Pick<DrizzleDB, 'select' | 'insert' | 'update'>;

/**
 * Drizzle adapter of `AssessmentWriteStore`. It is built ON a transaction by
 * `DrizzleAssessmentUnitOfWork`, never on the pool, so the locks it takes live
 * as long as that transaction. The `build*` methods are public so a spec can
 * read each statement's SQL.
 */
export class DrizzleAssessmentWriteStore implements AssessmentWriteStore {
  private readonly reads: DrizzleAssessmentStore;

  constructor(private readonly db: AssessmentWriteDb) {
    this.reads = new DrizzleAssessmentStore(db);
  }

  buildTimelineLock(timelineId: number) {
    return this.db
      .select({ id: timelines.id })
      .from(timelines)
      .where(eq(timelines.id, timelineId))
      .limit(1)
      .for('share');
  }

  buildTimelineSteps(timelineId: number) {
    return this.db
      .select({
        position: timelineSteps.position,
        name: timelineSteps.name,
        audience: timelineSteps.audience,
        opensAt: timelineSteps.opensAt,
        closesAt: timelineSteps.closesAt,
      })
      .from(timelineSteps)
      .where(eq(timelineSteps.timelineId, timelineId))
      .orderBy(asc(timelineSteps.position));
  }

  async lockTimelineShared(timelineId: number): Promise<WorklistStep[] | null> {
    const [row] = await this.buildTimelineLock(timelineId);
    if (row === undefined) return null;
    return await this.buildTimelineSteps(timelineId);
  }

  buildEnsureAssessment(row: NewAssessmentRow) {
    return this.db
      .insert(a)
      .values({
        timelineResultId: row.timelineResultId,
        stepPosition: row.stepPosition,
        roleCode: row.roleCode,
        fieldConfigVersion: row.fieldConfigVersion,
        createdAt: row.at,
        createdBy: row.createdBy,
      })
      // The key onto itself: on a duplicate nothing changes (the pinned version stays).
      .onDuplicateKeyUpdate({ set: { id: sql`${sql.identifier('id')}` } });
  }

  async ensureAssessment(row: NewAssessmentRow): Promise<void> {
    await this.buildEnsureAssessment(row);
  }

  buildAssessmentLock(timelineResultId: number, stepPosition: number) {
    return this.db
      .select({
        id: a.id,
        status: a.status,
        fieldConfigVersion: a.fieldConfigVersion,
      })
      .from(a)
      .where(
        and(
          eq(a.timelineResultId, timelineResultId),
          eq(a.stepPosition, stepPosition),
        ),
      )
      .limit(1)
      .for('update');
  }

  async lockAssessment(
    timelineResultId: number,
    stepPosition: number,
  ): Promise<LockedAssessment | undefined> {
    const [row] = await this.buildAssessmentLock(
      timelineResultId,
      stepPosition,
    );
    return row;
  }

  findValidations(assessmentId: number): Promise<ValidationRecord[]> {
    return this.reads.findValidations(assessmentId);
  }

  buildUpsertValidations(
    assessmentId: number,
    rows: readonly ValidationWrite[],
    actorId: number,
    at: Date,
  ) {
    // `VALUES()` is deprecated since MySQL 8.0.20 but supported on 8.x; the
    // row-alias form has no drizzle builder (the same call as the field
    // configuration's draft items).
    const column = (name: string) => sql`values(${sql.identifier(name)})`;
    return this.db
      .insert(assessmentFieldValidations)
      .values(
        rows.map((row) => ({
          assessmentId,
          fieldKey: row.fieldKey,
          validated: row.validated,
          updatedAt: at,
          updatedBy: actorId,
        })),
      )
      .onDuplicateKeyUpdate({
        set: {
          validated: column('validated'),
          updatedAt: column('updated_at'),
          updatedBy: column('updated_by'),
        },
      });
  }

  async upsertValidations(
    assessmentId: number,
    rows: readonly ValidationWrite[],
    actorId: number,
    at: Date,
  ): Promise<void> {
    if (rows.length === 0) return;
    await this.buildUpsertValidations(assessmentId, rows, actorId, at);
  }

  buildInsertAudit(event: AuditEventWrite) {
    return this.db.insert(assessmentAuditEvents).values({
      assessmentId: event.assessmentId,
      actorId: event.actorId,
      action: event.action,
      fieldKeys: event.fieldKeys === null ? null : [...event.fieldKeys],
      commentId: event.commentId,
      requestId: event.requestId,
      createdAt: event.at,
    });
  }

  async insertAudit(event: AuditEventWrite): Promise<void> {
    await this.buildInsertAudit(event);
  }

  buildInsertComment(row: NewCommentRow) {
    // `state` takes its default (`open`); the program visibility and the
    // withdraw time are never set at creation.
    return this.db.insert(assessmentComments).values({
      assessmentId: row.assessmentId,
      fieldKey: row.fieldKey,
      authorId: row.authorId,
      stepPosition: row.stepPosition,
      round: row.round,
      body: row.body,
      valueCopy: row.valueCopy,
      valueTruncated: row.valueTruncated,
      createdAt: row.at,
    });
  }

  async insertComment(row: NewCommentRow): Promise<number> {
    const [header] = await this.buildInsertComment(row);
    return header.insertId;
  }

  buildWithdrawComment(commentId: number, at: Date) {
    return this.db
      .update(assessmentComments)
      .set({ state: 'withdrawn', withdrawnAt: at })
      .where(
        and(
          eq(assessmentComments.id, commentId),
          // The guard: only an open comment is withdrawn, so a second request
          // or a program answer in between matches nothing.
          eq(assessmentComments.state, 'open'),
        ),
      );
  }

  async withdrawComment(commentId: number, at: Date): Promise<boolean> {
    const [header] = await this.buildWithdrawComment(commentId, at);
    return header.affectedRows > 0;
  }

  buildInsertCommentEvent(event: CommentEventWrite) {
    return this.db.insert(commentEvents).values({
      commentId: event.commentId,
      actorId: event.actorId,
      actorRole: event.actorRole,
      fromState: event.fromState,
      toState: event.toState,
      createdAt: event.at,
    });
  }

  async insertCommentEvent(event: CommentEventWrite): Promise<void> {
    await this.buildInsertCommentEvent(event);
  }
}
