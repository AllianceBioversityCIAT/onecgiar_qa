// @akili-spec assessment/step-1-assessment
import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  desc,
  eq,
  exists,
  inArray,
  isNull,
  like,
  ne,
  notInArray,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from 'drizzle-orm';
import type { TimelineViewStep } from '../admin-config/timelines/timeline-view.js';
import { DRIZZLE } from '../database/drizzle/drizzle.constants.js';
import type { DrizzleDB } from '../database/drizzle/drizzle.module.js';
import { assessmentComments } from '../database/drizzle/schema/assessment-comments.js';
import { cycles } from '../database/drizzle/schema/cycles.js';
import { resultAssessments } from '../database/drizzle/schema/result-assessments.js';
import { roles } from '../database/drizzle/schema/roles.js';
import { timelineSteps } from '../database/drizzle/schema/timeline-steps.js';
import { timelineUsers } from '../database/drizzle/schema/timeline-users.js';
import {
  timelineResults,
  type TimelineResultEndReason,
  type TimelineResultStatus,
} from '../database/drizzle/schema/timeline-results.js';
import {
  timelines,
  type TimelineKind,
} from '../database/drizzle/schema/timelines.js';
import { users } from '../database/drizzle/schema/users.js';
import { statusSqlCase, type QaStatus } from './qa-status.js';
import { RoleCode } from '../users/permissions.js';
import type { CurrentStepPositions } from './role-steps.js';
import type { ReviewerRow, WorklistAccess } from './scope.js';

// Port of the worklist reads (design 7.3, FR-1, FR-3..FR-7, FR-19, NFR-1). Three
// methods, one statement each, whatever the page or the size.

export const WORKLIST_STORE = Symbol('WORKLIST_STORE');

export const WORKLIST_SORT_KEYS = [
  'code',
  'title',
  'program',
  'resultType',
  'comments',
  'answered',
  'assessedBy',
  'status',
] as const;
export type WorklistSortKey = (typeof WORKLIST_SORT_KEYS)[number];
export type SortDirection = 'asc' | 'desc';

/** Sorts whose value is a number (a count, a code or a rank in the catalog's label order). */
export const NUMERIC_SORT_KEYS: readonly WorklistSortKey[] = [
  'code',
  'program',
  'resultType',
  'comments',
  'answered',
];

export interface WorklistStep extends TimelineViewStep {
  name: string;
}

/** A timeline of the active cycle with the caller's own active role rows on it. */
export interface WorklistTimeline {
  id: number;
  cycleId: number;
  name: string;
  kind: TimelineKind;
  /** Steps ordered by position. */
  steps: WorklistStep[];
  /** Role codes of the caller's ACTIVE `timeline_users` rows of this timeline. */
  roleCodes: string[];
}

/** What every worklist statement is scoped by (FR-1, FR-4, FR-19). */
export interface WorklistScope {
  timelineId: number;
  userId: number;
  access: WorklistAccess;
  /** Position of the `assessors` step: the assessment that feeds the status of a round-1 membership; `null` when the timeline has none. */
  assessmentStepPosition: number | null;
  /** Positions of the round-2 steps in order: a round-2 membership reads the latest assessment among them, else the first (DD-3). */
  roundTwoStepPositions: readonly number[];
  /** FR-19: step 2 is open, so a clarification the user wrote keeps an ended membership listed. */
  clarificationWindowOpen: boolean;
  /** FR-4 (amended by F-010): true when a status filter is set and does not name Auto-validated; the counters always pass false. */
  hideAutoValidated: boolean;
  /** P2-3917 (DD-P5): the timeline's `ppu` step is closed (Unresolved); judged in TS once per request. Absent = false. */
  ppuStepClosed?: boolean;
}

export interface WorklistFilters {
  statuses: readonly QaStatus[];
  programIds: readonly number[];
  resultTypeKeys: readonly string[];
  /** Trimmed, never empty: result code prefix or title substring. */
  q: string | null;
}

export interface WorklistPageCriteria extends WorklistScope {
  filters: WorklistFilters;
  sort: {
    key: WorklistSortKey;
    dir: SortDirection;
    /** Program ids in name order: the rank behind `ORDER BY FIELD(...)` (an id outside it ranks 0). */
    programOrder: readonly number[];
    /** Result type keys in label order. */
    resultTypeOrder: readonly string[];
  };
  /**
   * Keyset: strictly after this (sort value, result code, membership id) in the
   * page order. The id breaks the tie of one result code held in two rounds.
   */
  after: {
    value: string | number;
    resultCode: number;
    membershipId: number;
  } | null;
  take: number;
}

/** One membership as the list shows it. `updated` is a boolean on purpose: the changed keys never leave the store (DD-11). */
export interface WorklistRecord {
  membershipId: number;
  resultCode: number;
  title: string | null;
  updated: boolean;
  programId: number;
  resultTypeKey: string;
  round: number;
  membershipStatus: TimelineResultStatus;
  ended: boolean;
  endReason: TimelineResultEndReason | null;
  /** P2-3916 (DD-T2): the Lead's step-3 assessment ended `escalated` (a TPB row covers the membership). */
  leadEscalated: boolean;
  /** P2-3917 (DD-P4): the TPB's step-4 assessment ended `escalated` (a PPU row covers the membership). */
  tpbEscalated: boolean;
  /** Non-withdrawn comments of the assessment. */
  comments: number;
  /** P2-3911: non-withdrawn comments in `accepted`, `accepted_with_comment` or `disagreed`. */
  answeredBySp: number;
  assessedById: number | null;
  assessedByNickname: string | null;
  /** admin/acts-as-reviewer R4: a QA Admin acting as the role ended it. */
  assessedByAdmin: boolean;
  status: QaStatus | null;
  /** The value the sort ordered by; the cursor carries the last one. */
  sortValue: string | number;
}

export interface WorklistStatusCount {
  status: QaStatus | null;
  count: number;
}

export interface WorklistStore {
  /**
   * One statement: the active cycle's timelines with their steps and the
   * caller's active role codes on each (`timelineId` narrows it to one).
   */
  findTimelines(
    userId: number,
    timelineId?: number,
  ): Promise<WorklistTimeline[]>;
  /** One statement: the page (`take` rows) with filters, order and keyset applied. */
  findPage(criteria: WorklistPageCriteria): Promise<WorklistRecord[]>;
  /** One statement: memberships of the scope grouped by QA status, filters ignored. */
  countByStatus(scope: WorklistScope): Promise<WorklistStatusCount[]>;
}

// ---- Drizzle adapter -------------------------------------------------------

type WorklistDb = Pick<DrizzleDB, 'select'>;

const t = timelineResults;
const a = resultAssessments;

/** `%`, `_` and `\` are LIKE metacharacters (MySQL's default escape is `\`). */
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, '\\$&');
}

function valueList(values: readonly (string | number)[]): SQL {
  return sql.join(
    values.map((value) => sql`${value}`),
    sql.raw(', '),
  );
}

/** `FIELD(column, ids in label order)`: the rank behind a sort by a catalog label (design 7.3); 0 for a value the catalog lacks. */
function fieldRank(column: SQL, order: readonly (string | number)[]): SQL {
  return order.length === 0
    ? sql`0`
    : sql`FIELD(${column}, ${valueList(order)})`;
}

const FALSE_SQL = sql.raw('1 = 0');

/**
 * DD-3 as SQL, the twin of `currentStepPosition` (`role-steps.ts`): the step
 * whose assessment a membership reads. Round 1 reads the `assessors` step;
 * round 2 reads the highest of its round-2 steps that holds a row, else the
 * first of them. Position 0 never exists (positions are 1 to 5): no step, no
 * assessment. Shared by the worklist join and the membership read.
 */
export function currentStepSql(steps: CurrentStepPositions): SQL {
  const first = steps.roundTwoStepPositions[0] ?? 0;
  const held =
    steps.roundTwoStepPositions.length === 0
      ? sql`NULL`
      : sql`(SELECT MAX(${sql.identifier('cur')}.${sql.identifier('step_position')}) FROM ${sql.identifier('result_assessments')} ${sql.identifier('cur')} WHERE ${sql.identifier('cur')}.${sql.identifier('timeline_result_id')} = ${t.id} AND ${sql.identifier('cur')}.${sql.identifier('step_position')} IN (${valueList(steps.roundTwoStepPositions)}))`;
  return sql`CASE WHEN ${t.entryRound} <= 1 THEN ${steps.assessmentStepPosition ?? 0} ELSE COALESCE(${held}, ${first}) END`;
}

const id = (name: string) => sql.identifier(name);

/**
 * P2-3916 (DD-T2), the SQL twin of `MembershipFacts.leadEscalated`: the
 * membership holds a `result_assessments` row at its timeline's
 * `lead_assessors` step, ended `escalated`. Literals only: nothing is bound.
 */
export function leadEscalatedSql(): SQL {
  return stepEscalatedSql('lead_assessors', 'lead_esc');
}

/**
 * P2-3917 (DD-P4), the SQL twin of `MembershipFacts.tpbEscalated`: the
 * membership's step-4 (TPB) row ended `escalated`.
 */
export function tpbEscalatedSql(): SQL {
  return stepEscalatedSql('tpb', 'tpb_esc');
}

/** The membership holds a row at its timeline's `audience` step, ended `escalated`. Literals only: nothing is bound. */
function stepEscalatedSql(
  audience: 'lead_assessors' | 'tpb',
  alias: string,
): SQL {
  const la = id(alias);
  const ls = id(`${alias}_step`);
  return sql`EXISTS (SELECT 1 FROM ${id('result_assessments')} ${la} INNER JOIN ${id('timeline_steps')} ${ls} ON ${ls}.${id('timeline_id')} = ${t.timelineId} AND ${ls}.${id('position')} = ${la}.${id('step_position')} WHERE ${la}.${id('timeline_result_id')} = ${t.id} AND ${ls}.${id('audience')} = ${sql.raw(`'${audience}'`)} AND ${la}.${id('status')} = ${sql.raw("'escalated'")})`;
}

/** P2-3916: the position of the membership's timeline `lead_assessors` step (unique per timeline), NULL when it has none. */
export function leadStepSql(): SQL {
  const ls = id('lead_step');
  return sql`(SELECT ${ls}.${id('position')} FROM ${id('timeline_steps')} ${ls} WHERE ${ls}.${id('timeline_id')} = ${t.timelineId} AND ${ls}.${id('audience')} = ${sql.raw("'lead_assessors'")})`;
}

/** P2-3917: the position of the membership's timeline `tpb` step (unique per timeline), NULL when it has none. */
export function tpbStepSql(): SQL {
  const ls = id('tpb_step');
  return sql`(SELECT ${ls}.${id('position')} FROM ${id('timeline_steps')} ${ls} WHERE ${ls}.${id('timeline_id')} = ${t.timelineId} AND ${ls}.${id('audience')} = ${sql.raw("'tpb'")})`;
}

/**
 * P2-3916 (DD-T3): the audience of the step the joined assessment row belongs
 * to, NULL when there is no row: the fifth input of `statusSqlCase`.
 */
export function currentStepAudienceSql(stepPosition: SQLWrapper): SQL {
  const cs = id('cur_step');
  return sql`(SELECT ${cs}.${id('audience')} FROM ${id('timeline_steps')} ${cs} WHERE ${cs}.${id('timeline_id')} = ${t.timelineId} AND ${cs}.${id('position')} = ${stepPosition})`;
}

/** One reviewer row as SQL, the same test as `rowCovers` plus the reviewed statuses (`scope.ts`). */
function reviewerRowCondition(row: ReviewerRow): SQL | undefined {
  const types =
    row.resultTypes === 'all'
      ? undefined
      : row.resultTypes.length === 0
        ? FALSE_SQL
        : inArray(t.resultTypeKey, [...row.resultTypes]);
  const programs =
    row.programs.mode === 'all'
      ? row.programs.excluded.length === 0
        ? undefined
        : notInArray(t.programClarisaId, [...row.programs.excluded])
      : row.programs.ids.length === 0
        ? FALSE_SQL
        : inArray(t.programClarisaId, [...row.programs.ids]);
  return and(
    eq(t.entryRound, row.round),
    inArray(t.status, ['pending', 'auto_validated']),
    types,
    programs,
    row.role === RoleCode.TPB ? leadEscalatedSql() : undefined,
    row.role === RoleCode.PPU ? tpbEscalatedSql() : undefined,
  );
}

/** `inScope`: ADMIN reads every membership but `not_in_qa`; a reviewer needs a covering row. */
export function scopeCondition(access: WorklistAccess): SQL {
  if (access.admin) return ne(t.status, 'not_in_qa');
  const rows = access.reviewerRows
    .map(reviewerRowCondition)
    .filter((condition): condition is SQL => condition !== undefined);
  return rows.length === 0 ? FALSE_SQL : (or(...rows) ?? FALSE_SQL);
}

/** Drizzle adapter of `WorklistStore`: read-only, three statements (design 7.3). */
@Injectable()
export class DrizzleWorklistStore implements WorklistStore {
  constructor(@Inject(DRIZZLE) private readonly db: WorklistDb) {}

  /** The timelines statement; public so a spec can read its SQL. */
  buildTimelinesQuery(userId: number, timelineId?: number) {
    // One join: the active cycle's timelines, their steps and the caller's active role rows.
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
        roleCode: roles.code,
      })
      .from(timelines)
      .innerJoin(
        cycles,
        and(eq(cycles.id, timelines.cycleId), eq(cycles.status, 'active')),
      )
      .innerJoin(timelineSteps, eq(timelineSteps.timelineId, timelines.id))
      .leftJoin(
        timelineUsers,
        and(
          eq(timelineUsers.timelineId, timelines.id),
          eq(timelineUsers.userId, userId),
          isNull(timelineUsers.removedAt),
        ),
      )
      .leftJoin(roles, eq(roles.id, timelineUsers.roleId))
      .where(
        timelineId === undefined ? undefined : eq(timelines.id, timelineId),
      )
      .orderBy(asc(timelines.id), asc(timelineSteps.position));
  }

  async findTimelines(
    userId: number,
    timelineId?: number,
  ): Promise<WorklistTimeline[]> {
    const rows = await this.buildTimelinesQuery(userId, timelineId);
    const byId = new Map<number, WorklistTimeline>();
    for (const row of rows) {
      let timeline = byId.get(row.id);
      if (timeline === undefined) {
        timeline = {
          id: row.id,
          cycleId: row.cycleId,
          name: row.name,
          kind: row.kind,
          steps: [],
          roleCodes: [],
        };
        byId.set(row.id, timeline);
      }
      if (!timeline.steps.some((step) => step.position === row.position)) {
        timeline.steps.push({
          position: row.position,
          name: row.stepName,
          audience: row.audience,
          opensAt: row.opensAt,
          closesAt: row.closesAt,
        });
      }
      if (row.roleCode !== null && !timeline.roleCodes.includes(row.roleCode)) {
        timeline.roleCodes.push(row.roleCode);
      }
    }
    return [...byId.values()];
  }

  /** The QA status of the joined row: the one `CASE` of DD-4. */
  private statusCase(scope: Pick<WorklistScope, 'ppuStepClosed'>): SQL {
    return statusSqlCase({
      membershipStatus: t.status,
      endReason: t.endReason,
      assessmentStatus: a.status,
      currentStep: currentStepAudienceSql(a.stepPosition),
      ppuStepClosed: sql.raw(scope.ppuStepClosed === true ? '1' : '0'),
      hasClarificationThread: exists(
        this.db
          .select({ one: sql`1` })
          .from(assessmentComments)
          .where(
            and(
              eq(assessmentComments.assessmentId, a.id),
              eq(assessmentComments.state, 'clarification_requested'),
            ),
          ),
      ),
    });
  }

  /** The membership is listed (design 7.2): in scope, and not ended unless released or returned; FR-19 lifts that for the author of a clarification. */
  private listedCondition(scope: WorklistScope): SQL | undefined {
    const ended = or(
      isNull(t.endedAt),
      inArray(t.endReason, ['released_qaed', 'returned']),
    );
    const covering = scope.access.reviewerRows
      .map(reviewerRowCondition)
      .filter((condition): condition is SQL => condition !== undefined);
    const lift =
      scope.clarificationWindowOpen && covering.length > 0
        ? and(
            or(...covering),
            exists(
              this.db
                .select({ one: sql`1` })
                .from(assessmentComments)
                .innerJoin(
                  resultAssessments,
                  eq(resultAssessments.id, assessmentComments.assessmentId),
                )
                .where(
                  and(
                    eq(resultAssessments.timelineResultId, t.id),
                    eq(assessmentComments.authorId, scope.userId),
                    eq(assessmentComments.state, 'clarification_requested'),
                  ),
                ),
            ),
          )
        : undefined;
    return and(scopeCondition(scope.access), or(ended, lift));
  }

  private scopeWhere(scope: WorklistScope): SQL | undefined {
    return and(
      eq(t.timelineId, scope.timelineId),
      this.listedCondition(scope),
      scope.hideAutoValidated
        ? sql`COALESCE(${this.statusCase(scope)}, '') <> 'auto_validated'`
        : undefined,
    );
  }

  private commentCount(): SQL<number> {
    return sql<number>`(${this.db
      .select({ n: sql`COUNT(*)` })
      .from(assessmentComments)
      .where(
        and(
          eq(assessmentComments.assessmentId, a.id),
          ne(assessmentComments.state, 'withdrawn'),
          isNull(assessmentComments.deletedAt),
        ),
      )})`;
  }

  /** P2-3911: the comments the program answered (accepted, accepted with a comment, disagreed). */
  private answeredCount(): SQL<number> {
    return sql<number>`(${this.db
      .select({ n: sql`COUNT(*)` })
      .from(assessmentComments)
      .where(
        and(
          eq(assessmentComments.assessmentId, a.id),
          isNull(assessmentComments.deletedAt),
          inArray(assessmentComments.state, [
            'accepted',
            'accepted_with_comment',
            'disagreed',
          ]),
        ),
      )})`;
  }

  private sortExpression(
    sort: WorklistPageCriteria['sort'],
    scope: Pick<WorklistScope, 'ppuStepClosed'>,
  ): SQL {
    switch (sort.key) {
      case 'code':
        return sql`${t.resultCode}`;
      case 'title':
        return sql`COALESCE(${t.title}, '')`;
      case 'program':
        return fieldRank(sql`${t.programClarisaId}`, sort.programOrder);
      case 'resultType':
        return fieldRank(sql`${t.resultTypeKey}`, sort.resultTypeOrder);
      case 'comments':
        return this.commentCount();
      case 'answered':
        // Comments answered by the Science Program (P2-3911).
        return this.answeredCount();
      case 'assessedBy':
        return sql`COALESCE(${users.nickname}, '')`;
      case 'status':
        return sql`COALESCE(${this.statusCase(scope)}, '')`;
    }
  }

  private filterWhere(criteria: WorklistPageCriteria): Array<SQL | undefined> {
    const { filters } = criteria;
    const q = filters.q;
    return [
      filters.statuses.length > 0
        ? sql`${this.statusCase(criteria)} IN (${valueList(filters.statuses)})`
        : undefined,
      filters.programIds.length > 0
        ? inArray(t.programClarisaId, [...filters.programIds])
        : undefined,
      filters.resultTypeKeys.length > 0
        ? inArray(t.resultTypeKey, [...filters.resultTypeKeys])
        : undefined,
      q === null
        ? undefined
        : or(
            sql`CAST(${t.resultCode} AS CHAR) LIKE ${`${escapeLike(q)}%`}`,
            like(t.title, `%${escapeLike(q)}%`),
          ),
    ];
  }

  /** Strictly after (sort value, result code) in the page order: the value by direction, the code always ascending. */
  private keysetWhere(criteria: WorklistPageCriteria): SQL | undefined {
    const { after, sort } = criteria;
    if (after === null) return undefined;
    const expression = this.sortExpression(sort, criteria);
    const beyond =
      sort.dir === 'asc'
        ? sql`${expression} > ${after.value}`
        : sql`${expression} < ${after.value}`;
    const sameValue = sql`${expression} = ${after.value}`;
    return or(
      beyond,
      and(sameValue, sql`${t.resultCode} > ${after.resultCode}`),
      and(
        sameValue,
        sql`${t.resultCode} = ${after.resultCode}`,
        sql`${t.id} > ${after.membershipId}`,
      ),
    );
  }

  /** The page statement; public so a spec can read its SQL. */
  buildPageQuery(criteria: WorklistPageCriteria) {
    const expression = this.sortExpression(criteria.sort, criteria);
    const order =
      criteria.sort.dir === 'asc' ? asc(expression) : desc(expression);
    return this.db
      .select({
        membershipId: t.id,
        resultCode: t.resultCode,
        title: t.title,
        // DD-11: a boolean only; `changed_fields` itself is never selected.
        updated: sql<number>`COALESCE(${t.entryRound} = 2 AND JSON_LENGTH(${t.changedFields}) > 0, 0)`,
        programId: t.programClarisaId,
        resultTypeKey: t.resultTypeKey,
        round: t.entryRound,
        membershipStatus: t.status,
        endedAt: t.endedAt,
        endReason: t.endReason,
        leadEscalated: sql<number>`${leadEscalatedSql()}`,
        tpbEscalated: sql<number>`${tpbEscalatedSql()}`,
        comments: this.commentCount(),
        answeredBySp: this.answeredCount(),
        assessedById: users.id,
        assessedByNickname: users.nickname,
        assessedByAdmin: a.finishedAsAdmin,
        status: sql<QaStatus | null>`${this.statusCase(criteria)}`,
        sortValue: sql<string | number>`${expression}`,
      })
      .from(t)
      .leftJoin(
        a,
        and(
          eq(a.timelineResultId, t.id),
          eq(a.stepPosition, currentStepSql(criteria)),
        ),
      )
      .leftJoin(users, eq(users.id, a.finishedBy))
      .where(
        and(
          this.scopeWhere(criteria),
          ...this.filterWhere(criteria),
          this.keysetWhere(criteria),
        ),
      )
      .orderBy(order, asc(t.resultCode), asc(t.id))
      .limit(criteria.take);
  }

  /** The counters statement; public so a spec can read its SQL. */
  buildCountQuery(scope: WorklistScope) {
    return this.db
      .select({
        status: sql<QaStatus | null>`${this.statusCase(scope)}`.as('status_key'),
        count: sql<number>`COUNT(*)`,
      })
      .from(t)
      .leftJoin(
        a,
        and(
          eq(a.timelineResultId, t.id),
          eq(a.stepPosition, currentStepSql(scope)),
        ),
      )
      .where(this.scopeWhere(scope))
      .groupBy(sql`status_key`);
  }

  async findPage(criteria: WorklistPageCriteria): Promise<WorklistRecord[]> {
    const rows = await this.buildPageQuery(criteria);
    const numeric = NUMERIC_SORT_KEYS.includes(criteria.sort.key);
    return rows.map((row) => ({
      membershipId: row.membershipId,
      resultCode: row.resultCode,
      title: row.title,
      updated: Number(row.updated) === 1,
      programId: row.programId,
      resultTypeKey: row.resultTypeKey,
      round: row.round,
      membershipStatus: row.membershipStatus,
      ended: row.endedAt !== null,
      endReason: row.endReason,
      leadEscalated: Number(row.leadEscalated) === 1,
      tpbEscalated: Number(row.tpbEscalated) === 1,
      comments: Number(row.comments),
      answeredBySp: Number(row.answeredBySp),
      assessedById: row.assessedById,
      assessedByNickname: row.assessedByNickname,
      assessedByAdmin: row.assessedByAdmin ?? false,
      status: row.status,
      sortValue: numeric ? Number(row.sortValue) : String(row.sortValue ?? ''),
    }));
  }

  async countByStatus(scope: WorklistScope): Promise<WorklistStatusCount[]> {
    const rows = await this.buildCountQuery(scope);
    return rows.map((row) => ({
      status: row.status,
      count: Number(row.count),
    }));
  }
}
