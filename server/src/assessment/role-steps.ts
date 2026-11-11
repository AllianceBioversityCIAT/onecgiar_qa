// @akili-spec assessment/step-1-assessment
import type { StepAudience } from '../admin-config/timelines/default-steps.js';
import {
  viewTimeline,
  type TimelineStepState,
  type TimelineViewStep,
} from '../admin-config/timelines/timeline-view.js';
import type { RomeMinute } from '../admin-config/rome-date.js';
import { Permission, RoleCode } from '../users/permissions.js';

// The role-step table (design 7.1, FR-1, FR-2, DD-2): which role works in which
// step of a timeline, on memberships of which round. Configured as data, so a
// later story enables a row and writes no new code path. No I/O and no clock:
// callers pass the Rome minute.

export interface RoleStepRow {
  readonly role: RoleCode;
  readonly permission: Permission;
  /** The step this role writes in, found by audience (unique per timeline, P-12). `null` for ADMIN. */
  readonly audience: StepAudience | null;
  /** Round of the memberships the role works on; `null` = any. */
  readonly round: number | null;
  /** A declared row of a later story is `false` and grants no worklist. */
  readonly enabled: boolean;
  /** ADMIN reads everything and writes nothing through this row (DD-2). */
  readonly access: 'write' | 'read';
}

export const ROLE_STEPS: readonly RoleStepRow[] = [
  {
    role: RoleCode.ASSESSOR,
    permission: Permission.ASSESSOR_ACCESS,
    audience: 'assessors',
    round: 1,
    enabled: true,
    access: 'write',
  },
  {
    role: RoleCode.LEAD_ASSESSOR,
    permission: Permission.LEAD_ACCESS,
    audience: 'lead_assessors',
    round: 2,
    enabled: false,
    access: 'write',
  },
  {
    role: RoleCode.TPB,
    permission: Permission.TPB_ACCESS,
    audience: 'tpb',
    round: 2,
    enabled: false,
    access: 'write',
  },
  {
    role: RoleCode.PPU,
    permission: Permission.PPU_ACCESS,
    audience: 'ppu',
    round: 2,
    enabled: false,
    access: 'write',
  },
  {
    role: RoleCode.ADMIN,
    permission: Permission.ADMIN_ACCESS,
    audience: null,
    round: null,
    enabled: true,
    access: 'read',
  },
];

/** The row of a role, enabled or not; `undefined` for a role with no row (GUEST, PROGRAM). */
export function findRoleStep(role: string): RoleStepRow | undefined {
  return ROLE_STEPS.find((row) => row.role === role);
}

/** The rows that give a worklist with write rights today: ASSESSOR in this spec. */
export function enabledReviewerRows(): readonly RoleStepRow[] {
  return ROLE_STEPS.filter((row) => row.enabled && row.access === 'write');
}

/** What the clock rule reads about a timeline: its steps, the Rome minute, whether it has a load. */
export interface StepTiming {
  steps: readonly TimelineViewStep[];
  /** The Rome minute to judge by; never read from a clock here (NFR-4). */
  now: RomeMinute;
  hasLoad: boolean;
}

/** The step of a timeline a role writes in, or `undefined` (never writable then, design 7.1). */
export function stepOfRole(
  row: RoleStepRow,
  steps: readonly TimelineViewStep[],
): TimelineViewStep | undefined {
  if (row.audience === null) return undefined;
  return steps.find((step) => step.audience === row.audience);
}

/**
 * The state of the role's step at `now`, by the step-state rule of
 * `admin-config` (`viewTimeline`, P-8): open from :00 of the opening minute to
 * :59 of the closing minute, and a timeline on hold has every step `upcoming`.
 * `null` when the role has no step in this timeline.
 */
export function roleStepState(
  row: RoleStepRow,
  timing: StepTiming,
): { position: number; state: TimelineStepState } | null {
  const step = stepOfRole(row, timing.steps);
  if (step === undefined) return null;
  const view = viewTimeline({
    steps: timing.steps,
    assignedRoles: [],
    now: timing.now,
    hasLoad: timing.hasLoad,
  });
  return { position: step.position, state: view.stepStates[step.position] };
}

/** FR-2: may this role write now? Only while its step is `in_progress`. */
export function isRoleStepOpen(row: RoleStepRow, timing: StepTiming): boolean {
  return roleStepState(row, timing)?.state === 'in_progress';
}

/**
 * The state of the first step of an audience, for predicates that look at a
 * step other than the role's own (FR-19 looks at the `programs` step).
 */
export function audienceStepState(
  audience: StepAudience,
  timing: StepTiming,
): TimelineStepState | null {
  const step = timing.steps.find(
    (candidate) => candidate.audience === audience,
  );
  if (step === undefined) return null;
  return viewTimeline({
    steps: timing.steps,
    assignedRoles: [],
    now: timing.now,
    hasLoad: timing.hasLoad,
  }).stepStates[step.position];
}

/**
 * OQ-8 (FR-13): the window in which an author may withdraw their own comment,
 * step 1 (`assessors`) or step 2 (`programs`) in progress. It is not the role's
 * write window: an ended assessment does not close it, and an assessor may
 * withdraw while the programs step is the open one.
 */
export function isWithdrawWindowOpen(timing: StepTiming): boolean {
  return (
    audienceStepState('assessors', timing) === 'in_progress' ||
    audienceStepState('programs', timing) === 'in_progress'
  );
}
