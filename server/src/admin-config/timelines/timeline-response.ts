import { RoleCode } from '../../users/permissions.js';
import type { TimelineKind } from '../../database/drizzle/schema/timelines.js';
import type { StepAudience } from './default-steps.js';
import {
  viewTimeline,
  type TimelineStatus,
  type TimelineStepState,
} from './timeline-view.js';
import type { ActiveAssignmentRow, TimelineBundle } from './timelines.store.js';

/** The roles a step can need: Science Programs are never assigned here (D-3). */
export const ASSIGNABLE_ROLES = [
  RoleCode.ASSESSOR,
  RoleCode.LEAD_ASSESSOR,
  RoleCode.TPB,
  RoleCode.PPU,
] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

/** A step as the API shows it (design 6): as created, plus its position. Dates are Rome calendar days. */
export interface TimelineStepResponse {
  position: number;
  name: string;
  audience: StepAudience;
  opensOn: string;
  closesOn: string;
  round: number;
  requiresLoad: boolean;
  /** From its dates, today and the hold; every step is `upcoming` during a hold (timeline-edit FR-2). */
  state: TimelineStepState;
}

/** A timeline as the API shows it (design 6, `Timeline`; FR-12). Instants leave as ISO UTC. */
export interface TimelineResponse {
  id: number;
  cycleId: number;
  name: string;
  kind: TimelineKind;
  allPrograms: boolean;
  /** CLARISA ids; empty when `allPrograms` (DD-6). */
  programIds: number[];
  allResultTypes: boolean;
  /** Catalog keys; empty when `allResultTypes` (DD-6). */
  resultTypeKeys: string[];
  steps: TimelineStepResponse[];
  status: TimelineStatus;
  currentStep: number | null;
  nextStep: number | null;
  readiness: string[];
  /** Active assignments per assignable role. */
  assignedCount: Record<AssignableRole, number>;
  createdAt: Date;
  /** Optimistic version, raised by one on each applied edit (timeline-edit FR-9, FR-14). */
  version: number;
}

/** A user assigned to a timeline in a role (design 6, `TimelineUser`). */
export interface TimelineUserResponse {
  assignmentId: number;
  userId: number;
  firstName: string | null;
  lastName: string | null;
  email: string;
  role: AssignableRole;
  assignedAt: Date;
}

/** `Timeline` plus its active assignments (design 6, `TimelineDetail`). */
export interface TimelineDetailResponse extends TimelineResponse {
  users: TimelineUserResponse[];
}

/**
 * The read model of one timeline from its rows and the Rome day in `now` (FR-12).
 * `assigned` is the count of active assignments per role; a role missing from
 * it has none. `hasLoad` comes from the loads port (timeline-edit FR-6, FR-14).
 */
export function toTimelineResponse(
  bundle: TimelineBundle,
  now: string,
  assigned: Partial<Record<AssignableRole, number>>,
  hasLoad: boolean,
): TimelineResponse {
  const { timeline } = bundle;
  const ordered = [...bundle.steps].sort((a, b) => a.position - b.position);
  const assignedCount = Object.fromEntries(
    ASSIGNABLE_ROLES.map((role) => [role, assigned[role] ?? 0]),
  ) as Record<AssignableRole, number>;
  const view = viewTimeline({
    steps: ordered,
    assignedRoles: ASSIGNABLE_ROLES.filter((role) => assignedCount[role] > 0),
    now,
    hasLoad,
  });
  const steps = ordered.map((step): TimelineStepResponse => ({
    position: step.position,
    name: step.name,
    audience: step.audience,
    opensOn: step.opensAt,
    closesOn: step.closesAt,
    round: step.round,
    requiresLoad: step.requiresLoad,
    state: view.stepStates[step.position],
  }));
  return {
    id: timeline.id,
    cycleId: timeline.cycleId,
    name: timeline.name,
    kind: timeline.kind,
    allPrograms: timeline.allPrograms,
    programIds: [...bundle.programIds].sort((a, b) => a - b),
    allResultTypes: timeline.allResultTypes,
    resultTypeKeys: [...bundle.resultTypeKeys].sort(),
    steps,
    status: view.status,
    currentStep: view.currentStep,
    nextStep: view.nextStep,
    readiness: view.readiness,
    assignedCount,
    createdAt: timeline.createdAt,
    version: timeline.version,
  };
}

/** One active assignment row as the API shows it (design 6, `TimelineUser`). */
export function toTimelineUserResponse(
  row: ActiveAssignmentRow,
): TimelineUserResponse {
  return {
    assignmentId: row.assignmentId,
    userId: row.userId,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    // The join is over `roles`; the store only holds the four assignable roles.
    role: row.roleCode as AssignableRole,
    assignedAt: row.assignedAt,
  };
}
