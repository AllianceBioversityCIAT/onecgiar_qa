// @akili-spec assessment/step-1-assessment
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, type SQL } from 'drizzle-orm';
import { DRIZZLE } from '../database/drizzle/drizzle.constants.js';
import type { DrizzleDB } from '../database/drizzle/drizzle.module.js';
import {
  assessmentComments,
  type CommentState,
  type CommentValueCopy,
} from '../database/drizzle/schema/assessment-comments.js';
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
import type { WorklistAccess } from './scope.js';
import { scopeCondition } from './worklist.store.js';

// Port of the assessment reads (design 5, 6, 7.4; DD-3: a read never writes).
// The read side only: three methods, one statement each. The write side
// (T-10 and later) adds its own unit of work and does not change these.

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
}
