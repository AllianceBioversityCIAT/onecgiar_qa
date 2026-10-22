/**
 * Cycles and QA timelines of the admin config API (`/api/v1/cycles`, `/timelines`, ADMIN only).
 * Copied by hand from the server contracts (`docs/specs/archive/2026-10-21-admin-config--cycle-timelines/front-contract.md`
 * and `docs/specs/admin-config/timeline-edit/front-contract.md`, Juanda 21-oct-2026): keep in sync.
 *
 * Step dates (`opensOn`, `closesOn`, `startsOn`, `endsOn`) are `YYYY-MM-DD` Rome calendar days:
 * keep them as strings and format them with `core/domain/rome-date` (never `new Date('YYYY-MM-DD')`).
 * Instants (`createdAt`, `assignedAt`) are ISO 8601 UTC.
 */

export type CycleStatus = 'draft' | 'active' | 'closed';

export interface Cycle {
  readonly id: number;
  readonly year: number;
  /** e.g. "2027 cycle". */
  readonly name: string;
  readonly status: CycleStatus;
  readonly timelineCount: number;
  /** Earliest opening over its timelines' steps; null without timelines. */
  readonly startsOn: string | null;
  readonly endsOn: string | null;
  readonly createdAt: string;
}

/** Workflow order; each audience at most once per timeline, in this order. */
export const STEP_AUDIENCES = ['assessors', 'programs', 'lead_assessors', 'tpb', 'ppu'] as const;
export type StepAudience = (typeof STEP_AUDIENCES)[number];

export const ASSIGNABLE_ROLES = ['ASSESSOR', 'LEAD_ASSESSOR', 'TPB', 'PPU'] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export interface DefaultStep {
  readonly position: number;
  readonly name: string;
  readonly audience: StepAudience;
  readonly round: number;
  readonly requiresLoad: boolean;
}

export interface TimelineStepInput {
  readonly name: string;
  readonly audience: StepAudience;
  readonly opensOn: string;
  readonly closesOn: string;
  readonly round: number;
  readonly requiresLoad: boolean;
}

/** From the step's dates and today in Rome, on every read. All `upcoming` while the timeline waits for its load. */
export type StepState = 'closed' | 'in_progress' | 'upcoming';

export interface TimelineStep extends TimelineStepInput {
  readonly position: number;
  readonly state: StepState;
}

/**
 * Scope is explicit: `allPrograms: true` = every program, now and future (list empty or left
 * out); `false` needs at least one id. Same for result types. `kind` is never sent.
 */
export interface TimelineCreate {
  readonly name: string;
  readonly allPrograms: boolean;
  readonly programIds?: readonly number[];
  readonly allResultTypes: boolean;
  readonly resultTypeKeys?: readonly string[];
  /** 1 to 5, never reordered. */
  readonly steps: readonly TimelineStepInput[];
}

export type TimelineKind = 'official' | 'additional';
/**
 * `waiting_for_load`: step 1 has opened and nothing is loaded yet. It wins over the dates (even after
 * the last closing day), no step is in progress and `currentStep` is null. Show it as "waiting for
 * results to be loaded", never as live or finished. Every TEST timeline reads it once step 1 opens.
 */
export type TimelineStatus = 'scheduled' | 'waiting_for_load' | 'live' | 'finished';

/** Informational "still missing" items: show them as to-dos, never as errors. New codes may appear. */
export const READINESS = {
  NO_RESULTS_LOADED: 'NO_RESULTS_LOADED',
  NO_ASSESSOR_ASSIGNED: 'NO_ASSESSOR_ASSIGNED',
  NO_LEAD_ASSESSOR_ASSIGNED: 'NO_LEAD_ASSESSOR_ASSIGNED',
  NO_TPB_ASSIGNED: 'NO_TPB_ASSIGNED',
  NO_PPU_ASSIGNED: 'NO_PPU_ASSIGNED',
} as const;

export interface Timeline {
  readonly id: number;
  readonly cycleId: number;
  readonly name: string;
  readonly kind: TimelineKind;
  readonly allPrograms: boolean;
  /** CLARISA ids, empty when all: resolve names with the science-programs catalog. */
  readonly programIds: readonly number[];
  readonly allResultTypes: boolean;
  readonly resultTypeKeys: readonly string[];
  readonly steps: readonly TimelineStep[];
  /** Computed on every read from today in Rome: refetch to refresh. */
  readonly status: TimelineStatus;
  readonly currentStep: number | null;
  readonly nextStep: number | null;
  readonly readiness: readonly string[];
  readonly assignedCount: Readonly<Record<AssignableRole, number>>;
  /** Starts at 1, +1 per applied edit: send it back in the next `TimelineUpdate`. */
  readonly version: number;
  readonly createdAt: string;
}

/** Only `name`, `opensOn` and `closesOn` of a step can change; it is picked by `position` (1 to 5). */
export interface TimelineStepUpdate {
  readonly position: number;
  readonly name?: string;
  readonly opensOn?: string;
  readonly closesOn?: string;
}

/**
 * `PATCH /timelines/:id`: `version` plus only what changed (a key left out keeps its value; `null`
 * never clears). A scope change sends its flag and its list together. Steps cannot be added, dropped
 * or reordered; `kind`, `audience`, `round`, `requiresLoad` and `state` are refused.
 */
export interface TimelineUpdate {
  readonly version: number;
  readonly name?: string;
  readonly allPrograms?: boolean;
  readonly programIds?: readonly number[];
  readonly allResultTypes?: boolean;
  readonly resultTypeKeys?: readonly string[];
  readonly steps?: readonly TimelineStepUpdate[];
  /** Asked by the screen first, or resent after `TIMELINES_IN_PROGRESS_UNCONFIRMED`. */
  readonly confirmInProgress?: boolean;
}

export interface TimelineUser {
  readonly assignmentId: number;
  readonly userId: number;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly email: string;
  readonly role: AssignableRole;
  readonly assignedAt: string;
}

export interface TimelineDetail extends Timeline {
  readonly users: readonly TimelineUser[];
}

/** `error.code` values of these routes (besides the shared ones). */
export const CYCLE_ERROR = {
  CYCLES_NOT_FOUND: 'CYCLES_NOT_FOUND',
  CYCLES_YEAR_TAKEN: 'CYCLES_YEAR_TAKEN',
  CYCLES_NOT_DRAFT: 'CYCLES_NOT_DRAFT',
  CYCLES_CLOSED: 'CYCLES_CLOSED',
  TIMELINES_NOT_FOUND: 'TIMELINES_NOT_FOUND',
  TIMELINES_NAME_TAKEN: 'TIMELINES_NAME_TAKEN',
  TIMELINES_USER_NOT_ELIGIBLE: 'TIMELINES_USER_NOT_ELIGIBLE',
  TIMELINES_ASSIGNMENT_NOT_FOUND: 'TIMELINES_ASSIGNMENT_NOT_FOUND',
  /** Someone edited since it was read: reload, tell the admin and let them redo it (never auto-resend). */
  TIMELINES_VERSION_STALE: 'TIMELINES_VERSION_STALE',
  /** A question, not an error: confirm, then resend the same body with `confirmInProgress: true`. */
  TIMELINES_IN_PROGRESS_UNCONFIRMED: 'TIMELINES_IN_PROGRESS_UNCONFIRMED',
} as const;
