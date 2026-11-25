// P2-3911: the reads of the Science Program view (port + Drizzle adapter). A
// fixed number of statements per route, none per row. No statement selects an
// assessor's id, nickname, name or email: the SP view never carries one.
import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { DRIZZLE } from '../../database/drizzle/drizzle.constants.js';
import type { DrizzleDB } from '../../database/drizzle/drizzle.module.js';
import {
  assessmentComments,
  type CommentState,
  type CommentValueCopy,
} from '../../database/drizzle/schema/assessment-comments.js';
import { commentClarificationAnswers } from '../../database/drizzle/schema/comment-clarification-answers.js';
import { cycles } from '../../database/drizzle/schema/cycles.js';
import {
  resultAssessments,
  type ResultAssessmentStatus,
} from '../../database/drizzle/schema/result-assessments.js';
import {
  spCommentResponses,
  type SpResponseKind,
} from '../../database/drizzle/schema/sp-comment-responses.js';
import {
  timelineResults,
  type TimelineResultEndReason,
  type TimelineResultStatus,
} from '../../database/drizzle/schema/timeline-results.js';
import { timelinePrograms } from '../../database/drizzle/schema/timeline-programs.js';
import { timelineSteps } from '../../database/drizzle/schema/timeline-steps.js';
import {
  timelines,
  type TimelineKind,
} from '../../database/drizzle/schema/timelines.js';
import type { WorklistStep } from '../worklist.store.js';
import { REVIEW_STATES, STATE_OF_KIND } from './sp-state.js';

export const SP_VIEW_STORE = Symbol('SP_VIEW_STORE');

/** The comment states that count as answered by the program. */
export const ANSWERED_STATES: readonly CommentState[] = [
  'accepted',
  'accepted_with_comment',
  'disagreed',
];

/** A timeline of the active cycle that covers a program. */
export interface SpTimelineRecord {
  id: number;
  cycleId: number;
  name: string;
  kind: TimelineKind;
  /** Ordered by position. */
  steps: WorklistStep[];
}

export interface SpResultsCriteria {
  timelineId: number;
  programId: number;
  /** The step whose assessment feeds the status and the comments (the assessors' step); null = none. */
  assessmentStepPosition: number | null;
  /** The programs step has started: only then a comment counts as visible. */
  commentsVisible: boolean;
}

/** One round-1 membership of the program, as the SP list shows it. */
export interface SpResultRecord {
  membershipId: number;
  resultCode: number;
  title: string | null;
  resultTypeKey: string;
  membershipStatus: TimelineResultStatus;
  endReason: TimelineResultEndReason | null;
  assessmentStatus: ResultAssessmentStatus | null;
  hasClarificationThread: boolean;
  /** The result has a round-2 membership in this timeline with changed fields. */
  updated: boolean;
  /** SP-visible comments (0 while they are not visible). */
  comments: number;
  /** SP-visible comments the program accepted, accepted with a comment or disagreed with. */
  answered: number;
}

/** A comment as the SP view may read it: no author column at all. */
export interface SpCommentRecord {
  id: number;
  fieldKey: string;
  body: string;
  state: CommentState;
  valueCopy: CommentValueCopy;
  valueTruncated: boolean;
  createdAt: Date;
}

export interface SpResponseRecord {
  id: number;
  commentId: number;
  kind: SpResponseKind;
  body: string | null;
  responderName: string;
  responderEmail: string;
  programId: number;
  createdAt: Date;
}

export interface ClarificationAnswerRecord {
  id: number;
  commentId: number;
  responseId: number;
  body: string;
  createdAt: Date;
}

/** Where a comment lives, for the SP write and the assessor's clarification answer. */
export interface SpCommentScope {
  commentId: number;
  state: CommentState;
  authorId: number;
  fieldKey: string;
  visible: boolean;
  /** `deleted_at` is set (round-2 FR-10): the program cannot see or answer it. */
  deleted: boolean;
  assessmentId: number;
  stepPosition: number;
  membershipId: number;
  timelineId: number;
  resultCode: number;
  programId: number;
  round: number;
}

export interface SpViewStore {
  /** One statement: the active cycle's timelines covering the program (the official one always), with their steps. */
  findTimelines(
    programId: number,
    timelineId?: number,
  ): Promise<SpTimelineRecord[]>;
  /** One statement: the program's round-1 memberships of the timeline that the worklist would list. */
  listResults(criteria: SpResultsCriteria): Promise<SpResultRecord[]>;
  /** One statement: the comments of an assessment the program may see (visible, not withdrawn), oldest first. */
  findVisibleComments(assessmentId: number): Promise<SpCommentRecord[]>;
  /** One statement (none for no id): who wrote each comment. Assessor side only; never read for the program. */
  findCommentAuthors(
    commentIds: readonly number[],
  ): Promise<Array<{ id: number; authorId: number }>>;
  /** One statement (none for no id): every response to these comments, oldest first. */
  findResponses(commentIds: readonly number[]): Promise<SpResponseRecord[]>;
  /** One statement (none for no id): every clarification answer to these comments. */
  findClarificationAnswers(
    commentIds: readonly number[],
  ): Promise<ClarificationAnswerRecord[]>;
  /** One statement: a comment with its assessment and membership; null when there is none. */
  findCommentScope(commentId: number): Promise<SpCommentScope | null>;
}

// ---- Drizzle adapter -------------------------------------------------------

type SpViewDb = Pick<DrizzleDB, 'select'>;

const t = timelineResults;
const a = resultAssessments;
const c = assessmentComments;
const id = (name: string) => sql.identifier(name);

/** Drizzle adapter of `SpViewStore`: read-only. */
@Injectable()
export class DrizzleSpViewStore implements SpViewStore {
  constructor(@Inject(DRIZZLE) private readonly db: SpViewDb) {}

  buildTimelinesQuery(programId: number, timelineId?: number) {
    return this.db
      .select({
        id: timelines.id,
        cycleId: timelines.cycleId,
        name: timelines.name,
        kind: timelines.kind,
        position: timelineSteps.position,
        stepName: timelineSteps.name,
        audience: timelineSteps.audience,
        opensAt: timelineSteps.opensAt,
        closesAt: timelineSteps.closesAt,
      })
      .from(timelines)
      .innerJoin(
        cycles,
        and(eq(cycles.id, timelines.cycleId), eq(cycles.status, 'active')),
      )
      .innerJoin(timelineSteps, eq(timelineSteps.timelineId, timelines.id))
      .where(
        and(
          timelineId === undefined ? undefined : eq(timelines.id, timelineId),
          or(
            eq(timelines.kind, 'official'),
            eq(timelines.allPrograms, true),
            exists(
              this.db
                .select({ one: sql`1` })
                .from(timelinePrograms)
                .where(
                  and(
                    eq(timelinePrograms.timelineId, timelines.id),
                    eq(timelinePrograms.programId, programId),
                  ),
                ),
            ),
          ),
        ),
      )
      .orderBy(asc(timelines.id), asc(timelineSteps.position));
  }

  async findTimelines(
    programId: number,
    timelineId?: number,
  ): Promise<SpTimelineRecord[]> {
    const rows = await this.buildTimelinesQuery(programId, timelineId);
    const byId = new Map<number, SpTimelineRecord>();
    for (const row of rows) {
      let timeline = byId.get(row.id);
      if (timeline === undefined) {
        timeline = {
          id: row.id,
          cycleId: row.cycleId,
          name: row.name,
          kind: row.kind,
          steps: [],
        };
        byId.set(row.id, timeline);
      }
      timeline.steps.push({
        position: row.position,
        name: row.stepName,
        audience: row.audience,
        opensAt: row.opensAt,
        closesAt: row.closesAt,
      });
    }
    return [...byId.values()];
  }

  /** DD-11 in SQL: the state the program reads for the comment row (same table as `programSideState`). */
  private programState(): SQL<string> {
    const latestOf = (column: string) =>
      sql`(SELECT ${id('sp_comment_responses')}.${id(column)} FROM ${id('sp_comment_responses')} WHERE ${id('sp_comment_responses')}.${id('comment_id')} = ${id('assessment_comments')}.${id('id')} ORDER BY ${id('sp_comment_responses')}.${id('id')} DESC LIMIT 1)`;
    // A clarification request the assessor already answered reads `open`.
    const answered = sql`EXISTS (SELECT 1 FROM ${id('comment_clarification_answers')} WHERE ${id('comment_clarification_answers')}.${id('response_id')} = ${latestOf('id')})`;
    const kinds = sql.join(
      Object.entries(STATE_OF_KIND).map(([kind, state]) =>
        kind === 'request_clarification'
          ? sql`WHEN ${kind} THEN CASE WHEN ${answered} THEN 'open' ELSE ${state} END`
          : sql`WHEN ${kind} THEN ${state}`,
      ),
      sql.raw(' '),
    );
    const reviewStates = sql.join(
      REVIEW_STATES.map((s) => sql`${s}`),
      sql.raw(', '),
    );
    return sql<string>`(CASE WHEN ${id('assessment_comments')}.${id('state')} IN (${reviewStates}) THEN COALESCE(CASE ${latestOf('kind')} ${kinds} END, 'open') ELSE ${id('assessment_comments')}.${id('state')} END)`;
  }

  /**
   * The correlated counts are spelled with table-qualified identifiers, so the
   * outer `result_assessments` row is never confused with an inner table.
   */
  private visibleCount(states: readonly CommentState[] | null): SQL<number> {
    const stateFilter =
      states === null
        ? sql``
        : sql` AND ${this.programState()} IN (${sql.join(
            states.map((s) => sql`${s}`),
            sql.raw(', '),
          )})`;
    return sql<number>`(SELECT COUNT(*) FROM ${id('assessment_comments')} WHERE ${id('assessment_comments')}.${id('assessment_id')} = ${id('result_assessments')}.${id('id')} AND ${id('assessment_comments')}.${id('visible_to_program_at')} IS NOT NULL AND ${id('assessment_comments')}.${id('deleted_at')} IS NULL AND ${id('assessment_comments')}.${id('state')} <> 'withdrawn'${stateFilter})`;
  }

  buildResultsQuery(criteria: SpResultsCriteria) {
    const zero = sql<number>`0`;
    return this.db
      .select({
        membershipId: t.id,
        resultCode: t.resultCode,
        title: t.title,
        resultTypeKey: t.resultTypeKey,
        membershipStatus: t.status,
        endReason: t.endReason,
        assessmentStatus: a.status,
        hasClarificationThread: sql<number>`EXISTS (SELECT 1 FROM ${id('assessment_comments')} WHERE ${id('assessment_comments')}.${id('assessment_id')} = ${id('result_assessments')}.${id('id')} AND ${this.programState()} = 'clarification_requested')`,
        // DD-11: a boolean only; `changed_fields` itself is never selected.
        updated: sql<number>`EXISTS (SELECT 1 FROM ${id('timeline_results')} AS ${id('round_two')} WHERE ${id('round_two')}.${id('timeline_id')} = ${id('timeline_results')}.${id('timeline_id')} AND ${id('round_two')}.${id('result_code')} = ${id('timeline_results')}.${id('result_code')} AND ${id('round_two')}.${id('entry_round')} = 2 AND COALESCE(JSON_LENGTH(${id('round_two')}.${id('changed_fields')}), 0) > 0)`,
        comments: criteria.commentsVisible ? this.visibleCount(null) : zero,
        answered: criteria.commentsVisible
          ? this.visibleCount(ANSWERED_STATES)
          : zero,
      })
      .from(t)
      .leftJoin(
        a,
        and(
          eq(a.timelineResultId, t.id),
          // Position 0 never exists (positions are 1 to 5): no step, no assessment.
          eq(a.stepPosition, criteria.assessmentStepPosition ?? 0),
        ),
      )
      .where(
        and(
          eq(t.timelineId, criteria.timelineId),
          eq(t.programClarisaId, criteria.programId),
          eq(t.entryRound, 1),
          ne(t.status, 'not_in_qa'),
          // The worklist's listed predicate (design 7.2).
          or(
            sql`${t.endedAt} IS NULL`,
            inArray(t.endReason, ['released_qaed', 'returned']),
          ),
        ),
      )
      .orderBy(asc(t.resultCode), asc(t.id));
  }

  async listResults(criteria: SpResultsCriteria): Promise<SpResultRecord[]> {
    const rows = await this.buildResultsQuery(criteria);
    return rows.map((row) => ({
      membershipId: row.membershipId,
      resultCode: row.resultCode,
      title: row.title,
      resultTypeKey: row.resultTypeKey,
      membershipStatus: row.membershipStatus,
      endReason: row.endReason,
      assessmentStatus: row.assessmentStatus,
      hasClarificationThread: Number(row.hasClarificationThread) === 1,
      updated: Number(row.updated) === 1,
      comments: Number(row.comments),
      answered: Number(row.answered),
    }));
  }

  buildVisibleCommentsQuery(assessmentId: number) {
    return this.db
      .select({
        id: c.id,
        fieldKey: c.fieldKey,
        body: c.body,
        state: c.state,
        valueCopy: c.valueCopy,
        valueTruncated: c.valueTruncated,
        createdAt: c.createdAt,
      })
      .from(c)
      .where(
        and(
          eq(c.assessmentId, assessmentId),
          isNotNull(c.visibleToProgramAt),
          ne(c.state, 'withdrawn'),
          // Round-2 FR-10: a comment the Lead deleted is not shown to the program.
          isNull(c.deletedAt),
        ),
      )
      .orderBy(asc(c.createdAt), asc(c.id));
  }

  async findVisibleComments(assessmentId: number): Promise<SpCommentRecord[]> {
    return await this.buildVisibleCommentsQuery(assessmentId);
  }

  buildCommentAuthorsQuery(commentIds: readonly number[]) {
    return this.db
      .select({ id: c.id, authorId: c.authorId })
      .from(c)
      .where(inArray(c.id, [...commentIds]));
  }

  async findCommentAuthors(
    commentIds: readonly number[],
  ): Promise<Array<{ id: number; authorId: number }>> {
    if (commentIds.length === 0) return [];
    return await this.buildCommentAuthorsQuery(commentIds);
  }

  buildResponsesQuery(commentIds: readonly number[]) {
    const r = spCommentResponses;
    return this.db
      .select({
        id: r.id,
        commentId: r.commentId,
        kind: r.kind,
        body: r.body,
        responderName: r.responderName,
        responderEmail: r.responderEmail,
        programId: r.programId,
        createdAt: r.createdAt,
      })
      .from(r)
      .where(inArray(r.commentId, [...commentIds]))
      .orderBy(asc(r.commentId), asc(r.id));
  }

  async findResponses(
    commentIds: readonly number[],
  ): Promise<SpResponseRecord[]> {
    if (commentIds.length === 0) return [];
    return await this.buildResponsesQuery(commentIds);
  }

  buildClarificationAnswersQuery(commentIds: readonly number[]) {
    const x = commentClarificationAnswers;
    return this.db
      .select({
        id: x.id,
        commentId: x.commentId,
        responseId: x.responseId,
        body: x.body,
        createdAt: x.createdAt,
      })
      .from(x)
      .where(inArray(x.commentId, [...commentIds]))
      .orderBy(asc(x.id));
  }

  async findClarificationAnswers(
    commentIds: readonly number[],
  ): Promise<ClarificationAnswerRecord[]> {
    if (commentIds.length === 0) return [];
    return await this.buildClarificationAnswersQuery(commentIds);
  }

  buildCommentScopeQuery(commentId: number) {
    return this.db
      .select({
        commentId: c.id,
        state: c.state,
        authorId: c.authorId,
        fieldKey: c.fieldKey,
        visibleAt: c.visibleToProgramAt,
        deletedAt: c.deletedAt,
        assessmentId: a.id,
        stepPosition: a.stepPosition,
        membershipId: t.id,
        timelineId: t.timelineId,
        resultCode: t.resultCode,
        programId: t.programClarisaId,
        round: t.entryRound,
      })
      .from(c)
      .innerJoin(a, eq(a.id, c.assessmentId))
      .innerJoin(t, eq(t.id, a.timelineResultId))
      .where(eq(c.id, commentId))
      .limit(1);
  }

  async findCommentScope(commentId: number): Promise<SpCommentScope | null> {
    const [row] = await this.buildCommentScopeQuery(commentId);
    if (row === undefined) return null;
    const { visibleAt, deletedAt, ...rest } = row;
    return {
      ...rest,
      visible: visibleAt !== null,
      deleted: deletedAt !== null,
    };
  }
}
