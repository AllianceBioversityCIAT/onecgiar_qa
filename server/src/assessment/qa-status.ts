// @akili-spec assessment/step-1-assessment
import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import type { ResultAssessmentStatus } from '../database/drizzle/schema/result-assessments.js';
import type {
  TimelineResultEndReason,
  TimelineResultStatus,
} from '../database/drizzle/schema/timeline-results.js';

// The QA status vocabulary and its mapping (FR-5, design 7.2, DD-4). The status
// is computed on read and never stored: the table below is the one source, and
// `statusOf` (TS) and `statusSqlCase` (SQL) both read it, so they cannot drift.

/** Every status the API may name, filters included (FR-5). */
export const QA_STATUSES = [
  'pending',
  'returned_to_program',
  'clarification_requested',
  'pending_tpb_review',
  'pending_ppu',
  'unresolved',
  'quality_assessed',
  'auto_validated',
] as const;
export type QaStatus = (typeof QA_STATUSES)[number];

export const QA_STATUS_LABELS: Readonly<Record<QaStatus, string>> = {
  pending: 'Pending',
  returned_to_program: 'Returned to program',
  clarification_requested: 'Clarification requested',
  pending_tpb_review: 'Pending for TPB review',
  pending_ppu: 'Pending PPU',
  unresolved: 'Unresolved',
  quality_assessed: 'Quality Assessed',
  auto_validated: 'Auto-validated',
};

/**
 * One row of the FR-5 table. A key left out means "any". `null` inside a list
 * is "no assessment" or "not ended". Rows are read top to bottom, first match
 * wins.
 */
export interface StatusRule {
  readonly status: QaStatus;
  /** `timeline_results.status`. */
  readonly membershipStatus?: readonly TimelineResultStatus[];
  /** `timeline_results.end_reason`; `null` = the membership has not ended. */
  readonly endReason?: readonly (TimelineResultEndReason | null)[];
  /** `result_assessments.status` of the role's step; `null` = no row. */
  readonly assessmentStatus?: readonly (ResultAssessmentStatus | null)[];
  /** Whether any comment thread of the assessment is `clarification_requested`. */
  readonly clarificationThread?: boolean;
}

/** FR-5, row by row, in the order of the requirement's table. */
export const STATUS_RULES: readonly StatusRule[] = [
  { status: 'auto_validated', membershipStatus: ['auto_validated'] },
  {
    status: 'pending',
    membershipStatus: ['pending'],
    assessmentStatus: [null, 'pending'],
  },
  {
    status: 'clarification_requested',
    membershipStatus: ['pending'],
    endReason: [null, 'returned'],
    assessmentStatus: ['returned'],
    clarificationThread: true,
  },
  {
    status: 'returned_to_program',
    membershipStatus: ['pending'],
    endReason: [null, 'returned'],
    assessmentStatus: ['returned'],
    clarificationThread: false,
  },
  { status: 'quality_assessed', assessmentStatus: ['quality_assessed'] },
];

/** What the status reads: the same four inputs in TS and in SQL (design 7.2). */
export interface StatusInputs {
  membershipStatus: TimelineResultStatus;
  endReason: TimelineResultEndReason | null;
  assessmentStatus: ResultAssessmentStatus | null;
  hasClarificationThread: boolean;
}

function holds<T>(allowed: readonly T[] | undefined, value: T): boolean {
  return allowed === undefined || allowed.includes(value);
}

/**
 * The QA status of a membership, or `null` when no row of the table matches
 * (a membership that is not in QA has no status; the worklist never lists it).
 */
export function statusOf(inputs: StatusInputs): QaStatus | null {
  const rule = STATUS_RULES.find(
    (row) =>
      holds(row.membershipStatus, inputs.membershipStatus) &&
      holds(row.endReason, inputs.endReason) &&
      holds(row.assessmentStatus, inputs.assessmentStatus) &&
      (row.clarificationThread === undefined ||
        row.clarificationThread === inputs.hasClarificationThread),
  );
  return rule?.status ?? null;
}

/**
 * The column expressions `statusSqlCase` reads, bound by the worklist query
 * (T-7). `hasClarificationThread` is any expression that is 1 or 0 (an
 * `EXISTS (...)`), the others are nullable columns of the joined row.
 */
export interface StatusSqlColumns {
  membershipStatus: SQLWrapper;
  endReason: SQLWrapper;
  assessmentStatus: SQLWrapper;
  hasClarificationThread: SQLWrapper;
}

// The literals come from the closed constants above, never from a request, so
// they are written into the text instead of bound; this guard keeps it so.
function literal(value: string): SQL {
  if (!/^[a-z_]+$/.test(value)) {
    throw new Error(`status literal out of alphabet: ${value}`);
  }
  return sql.raw(`'${value}'`);
}

function listCondition(
  column: SQLWrapper,
  allowed: readonly (string | null)[],
): SQL {
  const values = allowed.filter((value): value is string => value !== null);
  const parts: SQL[] = [];
  if (allowed.includes(null)) parts.push(sql`${column} IS NULL`);
  if (values.length === 1) {
    parts.push(sql`${column} = ${literal(values[0])}`);
  } else if (values.length > 1) {
    parts.push(
      sql`${column} IN (${sql.join(values.map(literal), sql.raw(', '))})`,
    );
  }
  return parts.length === 1
    ? parts[0]
    : sql`(${sql.join(parts, sql.raw(' OR '))})`;
}

function ruleCondition(rule: StatusRule, columns: StatusSqlColumns): SQL {
  const conditions: SQL[] = [];
  if (rule.membershipStatus) {
    conditions.push(
      listCondition(columns.membershipStatus, rule.membershipStatus),
    );
  }
  if (rule.endReason) {
    conditions.push(listCondition(columns.endReason, rule.endReason));
  }
  if (rule.assessmentStatus) {
    conditions.push(
      listCondition(columns.assessmentStatus, rule.assessmentStatus),
    );
  }
  if (rule.clarificationThread !== undefined) {
    conditions.push(
      sql`${columns.hasClarificationThread} = ${sql.raw(rule.clarificationThread ? '1' : '0')}`,
    );
  }
  return conditions.length === 0
    ? sql.raw('TRUE')
    : sql.join(conditions, sql.raw(' AND '));
}

/**
 * The SQL `CASE` of the same table `statusOf` reads (DD-4): filter, count and
 * sort in the database with the status the view shows. No row matching gives
 * NULL, like `statusOf`.
 */
export function statusSqlCase(columns: StatusSqlColumns): SQL {
  const branches = STATUS_RULES.map(
    (rule) =>
      sql`WHEN ${ruleCondition(rule, columns)} THEN ${literal(rule.status)}`,
  );
  return sql`CASE ${sql.join(branches, sql.raw(' '))} ELSE NULL END`;
}
