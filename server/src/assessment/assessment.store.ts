// @akili-spec assessment/step-1-assessment
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/mysql-core';
import { DRIZZLE } from '../database/drizzle/drizzle.constants.js';
import type { DrizzleDB } from '../database/drizzle/drizzle.module.js';
import {
  assessmentComments,
  type CommentState,
  type CommentValueCopy,
} from '../database/drizzle/schema/assessment-comments.js';
import { commentEvents } from '../database/drizzle/schema/comment-events.js';
import { commentClarificationAnswers } from '../database/drizzle/schema/comment-clarification-answers.js';
import {
  commentDecisions,
  type CommentDecisionKind,
} from '../database/drizzle/schema/comment-decisions.js';
import {
  spCommentResponses,
  type SpResponseKind,
} from '../database/drizzle/schema/sp-comment-responses.js';
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
import { assessmentReleases } from '../database/drizzle/schema/assessment-releases.js';
import { quickComments } from '../database/drizzle/schema/quick-comments.js';
import { isDuplicateKeyError } from '../common/idempotency/idempotency.errors.js';
import { timelineSteps } from '../database/drizzle/schema/timeline-steps.js';
import { timelines } from '../database/drizzle/schema/timelines.js';
import type { WorklistAccess } from './scope.js';
import {
  currentStepSql,
  scopeCondition,
  type WorklistStep,
} from './worklist.store.js';

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
  /** The `assessors` step, where a round-1 membership's assessment lives; `null` when the timeline has none. */
  assessmentStepPosition: number | null;
  /** The round-2 steps in order: a round-2 membership reads the latest assessment among them, else the first (DD-3). */
  roundTwoStepPositions: readonly number[];
}

/** A membership in scope, with the assessment of the role's step when one exists. */
export interface MembershipRecord {
  membershipId: number;
  resultCode: number;
  /** The phase's own result id and year, carried onto the release row of an end (FR-18). */
  resultId: number;
  phaseYear: number;
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
  /** The returned round-1 membership a round-2 one follows; `null` for a new one (round-2 FR-4). */
  previousMembershipId: number | null;
  /** Keys whose value changed since the previous membership; `null` = none (round-2 FR-5). */
  changedFields: string[] | null;
  /** The previous membership's step-1 assessment, joined in the membership statement (round-2 DD-4); `null` when there is none. */
  previousAssessmentId: number | null;
  assessment: {
    id: number;
    status: ResultAssessmentStatus;
    /** The step the row belongs to: the membership's current step (DD-3). */
    stepPosition: number;
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

/**
 * One line of the round-1 thread read (round-2 FR-4, design 7 *Thread read*):
 * a comment joined to the program response it shows (the latest, and every
 * clarification request), that request's answer and the Lead's decision. A
 * comment with several lines to show repeats its own columns. No responder
 * email is selected: the QA view carries the name only.
 */
export interface RoundOneThreadRow {
  commentId: number;
  fieldKey: string;
  authorId: number;
  authorNickname: string | null;
  body: string;
  state: CommentState;
  valueCopy: CommentValueCopy;
  valueTruncated: boolean;
  createdAt: Date;
  responseId: number | null;
  responseKind: SpResponseKind | null;
  responseBody: string | null;
  responderName: string | null;
  respondedAt: Date | null;
  answerBody: string | null;
  answeredAt: Date | null;
  decision: CommentDecisionKind | null;
  decisionBody: string | null;
  decidedAt: Date | null;
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
  /** One statement: the quick comments of a role, newest first (FR-12). */
  listQuickComments(roleCode: string): Promise<QuickCommentRecord[]>;
  /**
   * ONE statement for the whole thread of a round-2 view, whatever the number
   * of comments (round-2 NFR-1): the comments of the previous membership's
   * step-1 assessment that are neither withdrawn nor deleted, with the latest
   * program response of each, every clarification request and its answer, and
   * the decision of `roleCode`. Ordered by field, comment, response.
   */
  findRoundOneThread(
    assessmentId: number,
    roleCode: string,
  ): Promise<RoundOneThreadRow[]>;
}

/** A reusable comment text of a role (FR-12). */
export interface QuickCommentRecord {
  id: number;
  body: string;
  createdAt: Date;
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
  /** The membership has ended, read in the same statement as the lock (design 5, 7.5). */
  membershipEnded: boolean;
}

/** The end of an assessment (FR-14, FR-15): the status to set and who ends it. */
export interface AssessmentEndWrite {
  assessmentId: number;
  status: Exclude<ResultAssessmentStatus, 'pending'>;
  actorId: number;
  at: Date;
}

/** The release row an end queues (FR-18, NFR-3): `pending`, one per assessment. */
export interface NewReleaseRow {
  assessmentId: number;
  timelineResultId: number;
  resultId: number;
  phaseYear: number;
  outcome: 'qaed' | 'not_qaed';
  at: Date;
}

/** A quick comment to save (FR-12): the body is already trimmed, the hash is its sha-256. */
export interface NewQuickCommentRow {
  roleCode: string;
  body: string;
  bodyHash: string;
  createdBy: number;
  at: Date;
}

/** What a quick-comment save found or made: `created` is false when the text was already saved. */
export interface SavedQuickComment extends QuickCommentRecord {
  created: boolean;
}

export interface ValidationWrite {
  fieldKey: string;
  validated: boolean;
}

/** One append-only audit row (FR-21): ids and keys only, never a body or a value. */
export interface AuditEventWrite {
  /** `null` for an event that belongs to no assessment (a quick-comment save). */
  assessmentId: number | null;
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
  /** The QA user; `null` for a Science Program response (P2-3911), which sets `spResponseId`. */
  actorId: number | null;
  actorRole: string;
  fromState: CommentState | null;
  toState: CommentState;
  /** P2-3911: the `sp_comment_responses` row that made this move. */
  spResponseId?: number | null;
  at: Date;
}

/**
 * The round-1 comment a decision targets, read `FOR UPDATE` after the round-2
 * assessment lock (round-2 design 7 *Write path*). The round-1 assessment row
 * is never locked: it is finished.
 */
export interface DecisionTarget {
  id: number;
  /** The assessment the comment belongs to: it must be the previous membership's step-1 one. */
  assessmentId: number;
  /** The comment's author: the Lead's OWN round-2 comment is decidable (FR-9). */
  authorId: number;
  fieldKey: string;
  state: CommentState;
  /** `deleted_at` is set (FR-10). */
  deleted: boolean;
}

/** One decision of an assessment, with the comment it is on (round-2 FR-8). */
export interface DecisionRecord {
  commentId: number;
  fieldKey: string;
  decision: CommentDecisionKind;
  body: string | null;
  decidedAt: Date;
  /** The comment's state now: the `from` of the move the end applies (DD-7). */
  commentState: CommentState;
  /** `deleted_at` is set (FR-10): the decision no longer counts. */
  commentDeleted: boolean;
}

/** A decision to store: one per (comment, role); a second write replaces the first (DD-2). */
export interface DecisionWrite {
  commentId: number;
  /** The deciding role's assessment. */
  assessmentId: number;
  roleCode: string;
  decision: CommentDecisionKind;
  body: string;
  actorId: number;
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
  /**
   * One conditional statement (round-2 FR-10): sets `deleted_at` and
   * `deleted_by` where the comment is not deleted yet and no program response
   * points at it. `false` when it matched nothing (another delete got there, or
   * the program answered): the database decides the race, not a prior read.
   */
  deleteComment(commentId: number, actorId: number, at: Date): Promise<boolean>;
  /** One statement. */
  insertCommentEvent(event: CommentEventWrite): Promise<void>;
  /**
   * One conditional statement: `UPDATE … SET status, finished_at, finished_by
   * WHERE id = ? AND status = 'pending'`. `false` when it matched nothing:
   * another end got there, and the database decides the race (FR-17).
   */
  endAssessment(end: AssessmentEndWrite): Promise<boolean>;
  /** One statement: the distinct field keys that carry a non-withdrawn comment. */
  findCommentedFieldKeys(assessmentId: number): Promise<string[]>;
  /**
   * One statement: the distinct field keys that carry a LIVE comment, neither
   * withdrawn nor deleted (round-2 FR-7: such a field is not a carried green).
   */
  findLiveCommentedFieldKeys(assessmentId: number): Promise<string[]>;
  /** One statement: every non-withdrawn, non-deleted comment not yet visible becomes visible to the program at `at`. */
  markCommentsVisible(assessmentId: number, at: Date): Promise<void>;
  /** One statement: the `pending` release of an end. Unique per assessment. */
  insertRelease(row: NewReleaseRow): Promise<void>;
  /**
   * One `INSERT`, plus one `SELECT` when the text was already saved (the 1062
   * of `uq_quick_comments_role_hash`): the existing row is returned with
   * `created: false`.
   */
  saveQuickComment(row: NewQuickCommentRow): Promise<SavedQuickComment>;
  /** One statement: the comment `FOR UPDATE`; `undefined` when there is none. Taken after the assessment lock. */
  lockDecisionTarget(commentId: number): Promise<DecisionTarget | undefined>;
  /** One statement: every decision whose `assessment_id` is this assessment, with its comment's field and state. */
  findDecisions(assessmentId: number): Promise<DecisionRecord[]>;
  /**
   * One statement: `INSERT … ON DUPLICATE KEY UPDATE` on (comment, role). A
   * second decision replaces the first, with its author and time; `updated_at`
   * is set explicitly because the column has no ON UPDATE (T-3).
   */
  upsertDecision(write: DecisionWrite): Promise<void>;
  /** One statement: removes the role's decision on the comment; `false` when there was none. */
  deleteDecision(commentId: number, roleCode: string): Promise<boolean>;
  /** One conditional statement: `from` to `to` where the comment is still in `from`; `false` when it matched nothing. */
  setCommentState(
    commentId: number,
    from: CommentState,
    to: CommentState,
  ): Promise<boolean>;
}

// ---- Drizzle adapter -------------------------------------------------------

type AssessmentDb = Pick<DrizzleDB, 'select'>;

const t = timelineResults;
const a = resultAssessments;
/** The previous membership's step-1 assessment (round-2 DD-4): its row id and its validations feed the round-2 view. */
const prevA = alias(resultAssessments, 'prev_assessment');
const MEMBERSHIP_TABLE = sql.identifier('timeline_results');
const ASSESSMENT_TABLE = sql.identifier('result_assessments');

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
          resultId: t.resultId,
          phaseYear: t.phaseYear,
          title: t.title,
          programId: t.programClarisaId,
          resultTypeKey: t.resultTypeKey,
          round: t.entryRound,
          status: t.status,
          endedAt: t.endedAt,
          endReason: t.endReason,
          snapshotSk: t.snapshotSk,
          cycleYear: cycles.year,
          previousMembershipId: t.previousMembershipId,
          changedFields: t.changedFields,
          previousAssessmentId: prevA.id,
          assessmentId: a.id,
          assessmentStatus: a.status,
          assessmentStepPosition: a.stepPosition,
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
            eq(a.stepPosition, currentStepSql(criteria)),
          ),
        )
        // Round 2 only: the returned round-1 membership's assessment, in this same
        // statement (DD-4). A round-1 membership holds the one assessment of the
        // assessors step (a role writes only in its own round's step), so no step
        // filter is needed and the statement binds nothing new.
        .leftJoin(prevA, eq(prevA.timelineResultId, t.previousMembershipId))
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
      resultId: row.resultId,
      phaseYear: row.phaseYear,
      title: row.title,
      programId: row.programId,
      resultTypeKey: row.resultTypeKey,
      round: row.round,
      status: row.status,
      ended: row.endedAt !== null,
      endReason: row.endReason,
      snapshotSk: row.snapshotSk,
      cycleYear: row.cycleYear,
      previousMembershipId: row.previousMembershipId,
      changedFields: row.changedFields,
      previousAssessmentId: row.previousAssessmentId,
      assessment:
        row.assessmentId === null ||
        row.assessmentStatus === null ||
        row.assessmentStepPosition === null ||
        row.fieldConfigVersion === null
          ? null
          : {
              id: row.assessmentId,
              status: row.assessmentStatus,
              stepPosition: row.assessmentStepPosition,
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
      .where(
        and(
          eq(assessmentComments.assessmentId, assessmentId),
          // FR-10: a deleted comment is in no list.
          isNull(assessmentComments.deletedAt),
        ),
      )
      .orderBy(asc(assessmentComments.createdAt), asc(assessmentComments.id));
  }

  async findComments(assessmentId: number): Promise<CommentRecord[]> {
    return await this.buildCommentsQuery(assessmentId);
  }

  /**
   * The thread statement of a round-2 view; public so a spec can read its SQL.
   * One SELECT: the program responses join as the latest per comment OR a
   * clarification request, so a comment never costs a statement of its own.
   * No `responder_email` column, no per-row subquery on the comment list.
   */
  buildRoundOneThreadQuery(assessmentId: number, roleCode: string) {
    // The latest response of the comment, as a scalar inside this same statement.
    // Written with qualified identifiers (as `currentStepSql` is) so the inner
    // `id` can never be read as the outer join's.
    const latest = sql.identifier('latest_response');
    const latestId = sql`(SELECT MAX(${latest}.${sql.identifier('id')}) FROM ${sql.identifier('sp_comment_responses')} ${latest} WHERE ${latest}.${sql.identifier('comment_id')} = ${assessmentComments.id})`;
    return this.db
      .select({
        commentId: assessmentComments.id,
        fieldKey: assessmentComments.fieldKey,
        authorId: assessmentComments.authorId,
        authorNickname: users.nickname,
        body: assessmentComments.body,
        state: assessmentComments.state,
        valueCopy: assessmentComments.valueCopy,
        valueTruncated: assessmentComments.valueTruncated,
        createdAt: assessmentComments.createdAt,
        responseId: spCommentResponses.id,
        responseKind: spCommentResponses.kind,
        responseBody: spCommentResponses.body,
        responderName: spCommentResponses.responderName,
        respondedAt: spCommentResponses.createdAt,
        answerBody: commentClarificationAnswers.body,
        answeredAt: commentClarificationAnswers.createdAt,
        decision: commentDecisions.decision,
        decisionBody: commentDecisions.body,
        decidedAt: commentDecisions.decidedAt,
      })
      .from(assessmentComments)
      .innerJoin(users, eq(users.id, assessmentComments.authorId))
      .leftJoin(
        spCommentResponses,
        and(
          eq(spCommentResponses.commentId, assessmentComments.id),
          or(
            eq(spCommentResponses.kind, 'request_clarification'),
            eq(spCommentResponses.id, latestId),
          ),
        ),
      )
      .leftJoin(
        commentClarificationAnswers,
        eq(commentClarificationAnswers.responseId, spCommentResponses.id),
      )
      .leftJoin(
        commentDecisions,
        and(
          eq(commentDecisions.commentId, assessmentComments.id),
          eq(commentDecisions.roleCode, roleCode),
        ),
      )
      .where(
        and(
          eq(assessmentComments.assessmentId, assessmentId),
          isNull(assessmentComments.withdrawnAt),
          isNull(assessmentComments.deletedAt),
        ),
      )
      .orderBy(
        asc(assessmentComments.fieldKey),
        asc(assessmentComments.createdAt),
        asc(assessmentComments.id),
        asc(spCommentResponses.id),
      );
  }

  async findRoundOneThread(
    assessmentId: number,
    roleCode: string,
  ): Promise<RoundOneThreadRow[]> {
    return await this.buildRoundOneThreadQuery(assessmentId, roleCode);
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

  /** The quick-comments statement; public so a spec can read its SQL. */
  buildQuickCommentsQuery(roleCode: string) {
    return this.db
      .select({
        id: quickComments.id,
        body: quickComments.body,
        createdAt: quickComments.createdAt,
      })
      .from(quickComments)
      .where(eq(quickComments.roleCode, roleCode))
      .orderBy(desc(quickComments.createdAt), desc(quickComments.id));
  }

  async listQuickComments(roleCode: string): Promise<QuickCommentRecord[]> {
    return await this.buildQuickCommentsQuery(roleCode);
  }
}

// ---- Drizzle write adapter (T-10) -------------------------------------------

type AssessmentWriteDb = Pick<
  DrizzleDB,
  'select' | 'selectDistinct' | 'insert' | 'update' | 'delete'
>;

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
    return (
      this.db
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
        .onDuplicateKeyUpdate({ set: { id: sql`${sql.identifier('id')}` } })
    );
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
        // A scalar subquery of the select list: it adds no statement and no lock (the `FOR UPDATE` covers the assessment row only).
        // Spelled with table-qualified identifiers: drizzle drops the qualifier of a column in a single-table select.
        membershipEnded: sql<number>`(select ${MEMBERSHIP_TABLE}.${sql.identifier('ended_at')} is not null from ${MEMBERSHIP_TABLE} where ${MEMBERSHIP_TABLE}.${sql.identifier('id')} = ${ASSESSMENT_TABLE}.${sql.identifier('timeline_result_id')})`,
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
    return row === undefined
      ? undefined
      : { ...row, membershipEnded: Number(row.membershipEnded) === 1 };
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
          // A delete wins over a withdraw: a deleted comment is out of every list.
          isNull(assessmentComments.deletedAt),
        ),
      );
  }

  async withdrawComment(commentId: number, at: Date): Promise<boolean> {
    const [header] = await this.buildWithdrawComment(commentId, at);
    return header.affectedRows > 0;
  }

  buildDeleteComment(commentId: number, actorId: number, at: Date) {
    const responses = sql.identifier('sp_comment_responses');
    return this.db
      .update(assessmentComments)
      .set({ deletedAt: at, deletedBy: actorId })
      .where(
        and(
          eq(assessmentComments.id, commentId),
          // The guards: a second delete matches nothing, and a comment the
          // program answered (any response row) is never deleted.
          isNull(assessmentComments.deletedAt),
          sql`NOT EXISTS (SELECT 1 FROM ${responses} WHERE ${responses}.${sql.identifier('comment_id')} = ${assessmentComments.id})`,
        ),
      );
  }

  async deleteComment(
    commentId: number,
    actorId: number,
    at: Date,
  ): Promise<boolean> {
    const [header] = await this.buildDeleteComment(commentId, actorId, at);
    return header.affectedRows > 0;
  }

  buildInsertCommentEvent(event: CommentEventWrite) {
    return this.db.insert(commentEvents).values({
      commentId: event.commentId,
      actorId: event.actorId,
      actorRole: event.actorRole,
      fromState: event.fromState,
      toState: event.toState,
      spResponseId: event.spResponseId ?? null,
      createdAt: event.at,
    });
  }

  async insertCommentEvent(event: CommentEventWrite): Promise<void> {
    await this.buildInsertCommentEvent(event);
  }
  buildEndAssessment(end: AssessmentEndWrite) {
    return this.db
      .update(a)
      .set({
        status: end.status,
        finishedAt: end.at,
        finishedBy: end.actorId,
      })
      .where(
        and(
          eq(a.id, end.assessmentId),
          // The guard: only a pending assessment ends, so the second of two
          // concurrent ends matches nothing (FR-17).
          eq(a.status, 'pending'),
        ),
      );
  }

  async endAssessment(end: AssessmentEndWrite): Promise<boolean> {
    const [header] = await this.buildEndAssessment(end);
    return header.affectedRows > 0;
  }

  buildCommentedFieldKeys(assessmentId: number) {
    return this.db
      .selectDistinct({ fieldKey: assessmentComments.fieldKey })
      .from(assessmentComments)
      .where(
        and(
          eq(assessmentComments.assessmentId, assessmentId),
          ne(assessmentComments.state, 'withdrawn'),
        ),
      );
  }

  async findCommentedFieldKeys(assessmentId: number): Promise<string[]> {
    const rows = await this.buildCommentedFieldKeys(assessmentId);
    return rows.map((row) => row.fieldKey);
  }

  buildLiveCommentedFieldKeys(assessmentId: number) {
    return this.db
      .selectDistinct({ fieldKey: assessmentComments.fieldKey })
      .from(assessmentComments)
      .where(
        and(
          eq(assessmentComments.assessmentId, assessmentId),
          ne(assessmentComments.state, 'withdrawn'),
          isNull(assessmentComments.deletedAt),
        ),
      );
  }

  async findLiveCommentedFieldKeys(assessmentId: number): Promise<string[]> {
    const rows = await this.buildLiveCommentedFieldKeys(assessmentId);
    return rows.map((row) => row.fieldKey);
  }

  buildMarkCommentsVisible(assessmentId: number, at: Date) {
    return this.db
      .update(assessmentComments)
      .set({ visibleToProgramAt: at })
      .where(
        and(
          eq(assessmentComments.assessmentId, assessmentId),
          ne(assessmentComments.state, 'withdrawn'),
          isNull(assessmentComments.deletedAt),
          isNull(assessmentComments.visibleToProgramAt),
        ),
      );
  }

  async markCommentsVisible(assessmentId: number, at: Date): Promise<void> {
    await this.buildMarkCommentsVisible(assessmentId, at);
  }

  buildInsertRelease(row: NewReleaseRow) {
    // `status` takes its default (`pending`), `attempts` 0, no lease.
    return this.db.insert(assessmentReleases).values({
      assessmentId: row.assessmentId,
      timelineResultId: row.timelineResultId,
      resultId: row.resultId,
      phaseYear: row.phaseYear,
      outcome: row.outcome,
      createdAt: row.at,
    });
  }

  async insertRelease(row: NewReleaseRow): Promise<void> {
    await this.buildInsertRelease(row);
  }

  buildInsertQuickComment(row: NewQuickCommentRow) {
    return this.db.insert(quickComments).values({
      roleCode: row.roleCode,
      body: row.body,
      bodyHash: row.bodyHash,
      createdBy: row.createdBy,
      createdAt: row.at,
    });
  }

  buildFindQuickComment(roleCode: string, bodyHash: string) {
    return this.db
      .select({
        id: quickComments.id,
        body: quickComments.body,
        createdAt: quickComments.createdAt,
      })
      .from(quickComments)
      .where(
        and(
          eq(quickComments.roleCode, roleCode),
          eq(quickComments.bodyHash, bodyHash),
        ),
      )
      .limit(1);
  }

  async saveQuickComment(row: NewQuickCommentRow): Promise<SavedQuickComment> {
    try {
      const [header] = await this.buildInsertQuickComment(row);
      return {
        id: header.insertId,
        body: row.body,
        createdAt: row.at,
        created: true,
      };
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      // The same text of the same role is already saved: answer that row.
      const [existing] = await this.buildFindQuickComment(
        row.roleCode,
        row.bodyHash,
      );
      if (existing === undefined) throw error;
      return { ...existing, created: false };
    }
  }

  buildDecisionTargetLock(commentId: number) {
    return this.db
      .select({
        id: assessmentComments.id,
        assessmentId: assessmentComments.assessmentId,
        authorId: assessmentComments.authorId,
        fieldKey: assessmentComments.fieldKey,
        state: assessmentComments.state,
        deletedAt: assessmentComments.deletedAt,
      })
      .from(assessmentComments)
      .where(eq(assessmentComments.id, commentId))
      .limit(1)
      .for('update');
  }

  async lockDecisionTarget(
    commentId: number,
  ): Promise<DecisionTarget | undefined> {
    const [row] = await this.buildDecisionTargetLock(commentId);
    if (row === undefined) return undefined;
    return {
      id: row.id,
      assessmentId: row.assessmentId,
      authorId: row.authorId,
      fieldKey: row.fieldKey,
      state: row.state,
      deleted: row.deletedAt !== null,
    };
  }

  buildDecisions(assessmentId: number) {
    return this.db
      .select({
        commentId: commentDecisions.commentId,
        fieldKey: assessmentComments.fieldKey,
        decision: commentDecisions.decision,
        body: commentDecisions.body,
        decidedAt: commentDecisions.decidedAt,
        commentState: assessmentComments.state,
        commentDeletedAt: assessmentComments.deletedAt,
      })
      .from(commentDecisions)
      .innerJoin(
        assessmentComments,
        eq(assessmentComments.id, commentDecisions.commentId),
      )
      .where(eq(commentDecisions.assessmentId, assessmentId))
      .orderBy(asc(commentDecisions.commentId));
  }

  async findDecisions(assessmentId: number): Promise<DecisionRecord[]> {
    const rows = await this.buildDecisions(assessmentId);
    return rows.map(({ commentDeletedAt, ...row }) => ({
      ...row,
      commentDeleted: commentDeletedAt !== null,
    }));
  }

  buildUpsertDecision(write: DecisionWrite) {
    const column = (name: string) => sql`values(${sql.identifier(name)})`;
    return (
      this.db
        .insert(commentDecisions)
        .values({
          commentId: write.commentId,
          assessmentId: write.assessmentId,
          roleCode: write.roleCode,
          decision: write.decision,
          body: write.body,
          decidedBy: write.actorId,
          decidedAt: write.at,
          updatedAt: write.at,
        })
        // The key is (comment, role): the second decision replaces the first.
        // `assessment_id` and `role_code` never move; `updated_at` has no ON UPDATE, so it is set here.
        .onDuplicateKeyUpdate({
          set: {
            decision: column('decision'),
            body: column('body'),
            decidedBy: column('decided_by'),
            decidedAt: column('decided_at'),
            updatedAt: column('updated_at'),
          },
        })
    );
  }

  async upsertDecision(write: DecisionWrite): Promise<void> {
    await this.buildUpsertDecision(write);
  }

  buildDeleteDecision(commentId: number, roleCode: string) {
    return this.db
      .delete(commentDecisions)
      .where(
        and(
          eq(commentDecisions.commentId, commentId),
          eq(commentDecisions.roleCode, roleCode),
        ),
      );
  }

  async deleteDecision(commentId: number, roleCode: string): Promise<boolean> {
    const [header] = await this.buildDeleteDecision(commentId, roleCode);
    return header.affectedRows > 0;
  }

  buildSetCommentState(
    commentId: number,
    from: CommentState,
    to: CommentState,
  ) {
    return this.db
      .update(assessmentComments)
      .set({ state: to })
      .where(
        and(
          eq(assessmentComments.id, commentId),
          // The guard: only a comment still in the state the end read moves.
          eq(assessmentComments.state, from),
        ),
      );
  }

  async setCommentState(
    commentId: number,
    from: CommentState,
    to: CommentState,
  ): Promise<boolean> {
    const [header] = await this.buildSetCommentState(commentId, from, to);
    return header.affectedRows > 0;
  }
}
