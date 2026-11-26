// @akili-spec assessment/step-1-assessment
// @akili-spec admin/acts-as-reviewer
import type { StepAudience } from '../admin-config/timelines/default-steps.js';
import type { TimelineStepState } from '../admin-config/timelines/timeline-view.js';
import type {
  TimelineResultEndReason,
  TimelineResultStatus,
} from '../database/drizzle/schema/timeline-results.js';
import { isLiveAssignment } from '../users/current-user.cache.js';
import type { AuthorizationSubject } from '../users/authorization.service.js';
import { ALL_RESULT_TYPES } from '../users/effective-scope.js';
import { findRoleDefinition, RoleCode } from '../users/permissions.js';
import {
  audienceStepState,
  enabledReviewerRows,
  findRoleStep,
  ROLE_STEPS,
  roleStepState,
  type StepTiming,
} from './role-steps.js';

// Worklist scope by role and step (design 7.1, FR-1, FR-2, FR-19, DD-2). Pure:
// the rows are built from what `CurrentUserCache` loaded (the live grants, the
// program scope, the active exclusions) and from the user's fresh
// `timeline_users` rows; the worklist query (T-7) binds the same sets to SQL,
// and the in-memory predicates below judge a single membership with them, so
// the SQL and the checks of a write read one definition. It holds no permission
// check: the caller answers `ADMIN_ACCESS` with its injected
// `AuthorizationService` and passes the result in.

/** Result types a reviewer row covers: every one (`'*'`, DD-1) or these keys. */
export type ResultTypeSet = 'all' | readonly string[];

/**
 * Programs a reviewer row covers, exclusions applied (P-9, P-10): no program
 * scope rows = all programs but the excluded ones; otherwise the scoped
 * programs minus the excluded ones (possibly none).
 */
export type ProgramSet =
  | { mode: 'all'; excluded: readonly number[] }
  | { mode: 'in'; ids: readonly number[] };

/** One reviewer row of a user for one timeline (FR-1). */
export interface ReviewerRow {
  role: RoleCode;
  /** Round of the memberships the row works on (ASSESSOR: 1). */
  round: number;
  audience: StepAudience;
  resultTypes: ResultTypeSet;
  programs: ProgramSet;
  /**
   * admin/acts-as-reviewer: the row of a QA Admin acting as this role. It
   * covers every result type and program, and its step dates do not bind it
   * (R2); the round and the result's state still do (R6).
   */
  byAdmin?: boolean;
}

export interface WorklistAccess {
  /** Enabled reviewer rows: assignment on the timeline AND a live grant of the role. */
  reviewerRows: readonly ReviewerRow[];
  /** The caller's `ADMIN_ACCESS` answer: reads every membership of the timeline, writes nothing through this. */
  admin: boolean;
  /** Roles the user is assigned and granted for whose row is declared and disabled (FR-1 *A role with no active row*). */
  disabledRoles: readonly RoleCode[];
}

/**
 * The user's rows for a timeline (FR-1). `timelineRoles` are the role codes of
 * the user's ACTIVE `timeline_users` rows of this timeline, read fresh (a
 * removed assignment shows on the next request, P-34). A role with an
 * assignment and no live grant gives no row (*Revoked grant*): the assignment
 * alone grants nothing. `isAdmin` is the caller's answer to
 * `AuthorizationService.can(user, Permission.ADMIN_ACCESS)`, so the admin
 * decision follows the provider the app injects (DD-2).
 *
 * admin/acts-as-reviewer (R1, R5): an Admin that names an `actingRole` gets
 * ONE row, that role's, flagged `byAdmin`, in place of any row of its own
 * grants: no assignment, grant or conflict rule is needed. A non-admin's
 * `actingRole` is ignored.
 */
export function resolveAccess(
  user: AuthorizationSubject,
  timelineRoles: readonly string[],
  isAdmin: boolean,
  actingRole?: RoleCode,
): WorklistAccess {
  if (isAdmin && actingRole !== undefined) {
    const acting = enabledReviewerRows().find((row) => row.role === actingRole);
    if (
      acting !== undefined &&
      acting.audience !== null &&
      acting.round !== null
    ) {
      return {
        reviewerRows: [
          {
            role: acting.role,
            round: acting.round,
            audience: acting.audience,
            resultTypes: 'all',
            programs: { mode: 'all', excluded: [] },
            byAdmin: true,
          },
        ],
        admin: true,
        disabledRoles: [],
      };
    }
  }
  const liveGrantsOf = (role: string) =>
    user.assignments.filter(
      (assignment) =>
        isLiveAssignment(assignment) && assignment.roleCode === role,
    );

  const reviewerRows: ReviewerRow[] = [];
  for (const row of enabledReviewerRows()) {
    if (!timelineRoles.includes(row.role) || row.audience === null) continue;
    const grants = liveGrantsOf(row.role);
    if (grants.length === 0 || row.round === null) continue;
    reviewerRows.push({
      role: row.role,
      round: row.round,
      audience: row.audience,
      // P2-3916 (DD-T9): a global role (TPB) is granted with no result type, so
      // it covers every type; its programs are still the user's program scope.
      resultTypes:
        findRoleDefinition(row.role)?.scopeType === 'global'
          ? 'all'
          : resultTypeSet(grants.map((grant) => grant.resultTypeKey)),
      programs: programSet(user),
    });
  }

  const disabledRoles = ROLE_STEPS.filter(
    (row) => !row.enabled && row.access === 'write',
  )
    .map((row) => row.role)
    .filter(
      (role) => timelineRoles.includes(role) && liveGrantsOf(role).length > 0,
    );

  return {
    reviewerRows,
    admin: isAdmin,
    disabledRoles,
  };
}

/** admin/acts-as-reviewer: the caller is a QA Admin acting as a reviewer role (its one row is `byAdmin`). */
export function actsAsAdmin(access: WorklistAccess): boolean {
  return access.reviewerRows.some((row) => row.byAdmin === true);
}

/** The role a QA Admin acts as on this request, for the decision log; `undefined` for anyone else. */
export function actingRoleOf(access: WorklistAccess): RoleCode | undefined {
  return access.reviewerRows.find((row) => row.byAdmin === true)?.role;
}

function resultTypeSet(keys: readonly (string | null)[]): ResultTypeSet {
  const present = keys.filter((key): key is string => key !== null);
  if (present.includes(ALL_RESULT_TYPES)) return 'all';
  return [...new Set(present)].sort();
}

function programSet(user: AuthorizationSubject): ProgramSet {
  const excluded = [
    ...new Set(
      user.exclusions
        .filter((exclusion) => exclusion.status === 'active')
        .map((exclusion) => exclusion.programId),
    ),
  ].sort((a, b) => a - b);
  if (user.programScope.length === 0) return { mode: 'all', excluded };
  const ids = [...new Set(user.programScope)]
    .filter((id) => !excluded.includes(id))
    .sort((a, b) => a - b);
  return { mode: 'in', ids };
}

/** Everything the scope rules read about one membership. */
export interface MembershipFacts {
  resultType: string;
  programId: number;
  /** `timeline_results.entry_round`. */
  round: number;
  status: TimelineResultStatus;
  ended: boolean;
  endReason: TimelineResultEndReason | null;
  /**
   * P2-3916 (DD-T2): the membership's Lead (step-3) assessment ended
   * `escalated`, so it reached step 4. Only the TPB row reads it; left out it
   * is `false`, so a TPB row covers nothing.
   */
  leadEscalated?: boolean;
  /**
   * P2-3917 (DD-P4): the membership's TPB (step-4) assessment ended
   * `escalated`, so it reached step 5. Only the PPU row reads it; left out it
   * is `false`, so a PPU row covers nothing.
   */
  tpbEscalated?: boolean;
}

/**
 * Does this reviewer row cover the membership's round, result type and program?
 * A TPB row also needs the membership to have reached step 4 (`leadEscalated`,
 * DD-T2); its SQL twin is the `EXISTS` of `reviewerRowCondition`.
 */
export function rowCovers(row: ReviewerRow, facts: MembershipFacts): boolean {
  if (row.round !== facts.round) return false;
  if (row.role === RoleCode.TPB && facts.leadEscalated !== true) return false;
  if (row.role === RoleCode.PPU && facts.tpbEscalated !== true) return false;
  const typeCovered =
    row.resultTypes === 'all' || row.resultTypes.includes(facts.resultType);
  if (!typeCovered) return false;
  return row.programs.mode === 'all'
    ? !row.programs.excluded.includes(facts.programId)
    : row.programs.ids.includes(facts.programId);
}

const REVIEWED_STATUSES: readonly TimelineResultStatus[] = [
  'pending',
  'auto_validated',
];
const LISTED_END_REASONS: readonly TimelineResultEndReason[] = [
  'released_qaed',
  'returned',
];

function coveringRows(
  access: WorklistAccess,
  facts: MembershipFacts,
): ReviewerRow[] {
  if (!REVIEWED_STATUSES.includes(facts.status)) return [];
  return access.reviewerRows.filter((row) => rowCovers(row, facts));
}

/** Step order of a reviewer role in the role-step table (ASSESSOR < LEAD_ASSESSOR < TPB < PPU). */
function stepOrder(role: RoleCode): number {
  return ROLE_STEPS.findIndex((row) => row.role === role);
}

/** The covering row of the furthest step: the step the membership reached, among the caller's roles. */
function furthestRow(rows: readonly ReviewerRow[]): ReviewerRow | undefined {
  return rows.reduce<ReviewerRow | undefined>(
    (best, row) =>
      best === undefined || stepOrder(row.role) > stepOrder(best.role)
        ? row
        : best,
    undefined,
  );
}

/**
 * DD-T11 (round-2 contract adjustments): the one reviewer row the caller works
 * with on this membership, whatever the order of its rows. The view
 * (`header.reviewerRole`), the assessment it reads, and every decision and
 * finish use this row.
 *
 * - A QA Admin acting as a role (`X-Acting-Role`): that row, when it fits the
 *   membership's round; else none (read-only).
 * - Anyone else: among the rows that cover the membership, the one of the
 *   furthest step. A TPB row covers only once the Lead escalated and a PPU row
 *   only once the TPB escalated, so this is the role whose step the result is
 *   at: Pending → Lead, Pending for TPB review → TPB, Pending PPU or Unresolved
 *   → PPU, among the roles the person holds.
 * - A QA Admin without `X-Acting-Role`, or a row that covers nothing: none.
 */
export function effectiveRow(
  access: WorklistAccess,
  facts: MembershipFacts,
): ReviewerRow | undefined {
  const acting = access.reviewerRows.find((row) => row.byAdmin === true);
  if (acting !== undefined) {
    return acting.round === facts.round ? acting : undefined;
  }
  return furthestRow(coveringRows(access, facts));
}

/**
 * Is the membership inside the caller's scope at all (FR-1)? A reviewer row
 * needs a covered round, type and program and a `pending` or `auto_validated`
 * membership; ADMIN sees every membership but `not_in_qa`. Outside it the
 * answer is the 404 of an unknown code (*Out-of-scope result by URL*): this is
 * only the predicate.
 */
export function inScope(
  access: WorklistAccess,
  facts: MembershipFacts,
): boolean {
  if (access.admin && facts.status !== 'not_in_qa') return true;
  return coveringRows(access, facts).length > 0;
}

/**
 * FR-19: during step 2 (the `programs` step) a membership where a comment
 * written by the user is `clarification_requested` stays listed. The query
 * only supplies `authoredClarification`.
 */
export function clarificationOpen(
  timing: StepTiming,
  authoredClarification: boolean,
): boolean {
  return (
    authoredClarification &&
    audienceStepState('programs', timing) === 'in_progress'
  );
}

/**
 * Is the membership a row of the worklist (design 7.2)? In scope, and not
 * ended except by release or return (`ended_at IS NULL OR end_reason IN
 * ('released_qaed', 'returned')`). The FR-19 predicate lifts the ended filter
 * for a reviewer row that covers the membership.
 */
export function listedFor(
  access: WorklistAccess,
  facts: MembershipFacts,
  clarification?: { timing: StepTiming; authoredClarification: boolean },
): boolean {
  if (!inScope(access, facts)) return false;
  const endedOk =
    !facts.ended ||
    (facts.endReason !== null && LISTED_END_REASONS.includes(facts.endReason));
  if (endedOk) return true;
  return (
    clarification !== undefined &&
    clarificationOpen(
      clarification.timing,
      clarification.authoredClarification,
    ) &&
    coveringRows(access, facts).length > 0
  );
}

export type ReadOnlyReason =
  | 'admin_read_only'
  | 'step_upcoming'
  | 'step_closed'
  | 'no_step'
  | 'auto_validated';

export type WriteDecision =
  | { writable: true; row: ReviewerRow; stepPosition: number }
  | { writable: false; reason: 'not_in_scope' | ReadOnlyReason };

/**
 * FR-2: may the caller write on this membership now? Needs a reviewer row that
 * covers it (ADMIN alone never writes, DD-2) and the row's step `in_progress`
 * at `timing.now`: the step-state rule of `admin-config`, called as is. The
 * order is the one of design 7.5: not found, admin read-only, step state.
 *
 * admin/acts-as-reviewer R2: a `byAdmin` row writes whatever the state of its
 * step (upcoming or closed), as long as the timeline has that step.
 */
export function writeDecision(
  access: WorklistAccess,
  facts: MembershipFacts,
  timing: StepTiming,
): WriteDecision {
  if (!inScope(access, facts)) {
    return { writable: false, reason: 'not_in_scope' };
  }
  const rows = coveringRows(access, facts);
  if (rows.length === 0) {
    return { writable: false, reason: 'admin_read_only' };
  }
  // An auto-validated result is not assessed (DD-P4): it is shown for context
  // only, so no reviewer writes on it, whatever the state of their step.
  if (facts.status === 'auto_validated') {
    return { writable: false, reason: 'auto_validated' };
  }
  // DD-T11: the effective row alone writes, whatever the order of the rows
  // (a Lead who is also TPB writes as the TPB once the result reached step 4).
  const row = furthestRow(rows)!;
  const roleStep = findRoleStep(row.role);
  const state = roleStep ? roleStepState(roleStep, timing) : null;
  if (state === null) return { writable: false, reason: 'no_step' };
  // DD-P1: a role with no date window (the PPU) writes whatever the state of its step.
  if (
    state.state === 'in_progress' ||
    row.byAdmin === true ||
    roleStep?.dateBound === false
  ) {
    return { writable: true, row, stepPosition: state.position };
  }
  return { writable: false, reason: stepRefusal(state.state) };
}

function stepRefusal(state: TimelineStepState): ReadOnlyReason {
  return state === 'closed' ? 'step_closed' : 'step_upcoming';
}
