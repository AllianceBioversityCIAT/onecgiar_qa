import { RoleCode } from '../../users/permissions.js';
import type { TimelineKind } from '../../database/drizzle/schema/timelines.js';
import type { StepAudience } from './default-steps.js';
import { viewTimeline, type TimelineStatus } from './timeline-view.js';
import type { TimelineBundle } from './timelines.store.js';

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
}

/**
 * The read model of one timeline from its rows and today's Rome date (FR-12).
 * `assigned` is the count of active assignments per role; none can exist
 * before the assignment routes do, so it defaults to zero everywhere.
 */
export function toTimelineResponse(
  bundle: TimelineBundle,
  today: string,
  assigned: Partial<Record<AssignableRole, number>> = {},
): TimelineResponse {
  const { timeline } = bundle;
  const steps = [...bundle.steps]
    .sort((a, b) => a.position - b.position)
    .map((step): TimelineStepResponse => ({
      position: step.position,
      name: step.name,
      audience: step.audience,
      opensOn: step.opensOn,
      closesOn: step.closesOn,
      round: step.round,
      requiresLoad: step.requiresLoad,
    }));
  const assignedCount = Object.fromEntries(
    ASSIGNABLE_ROLES.map((role) => [role, assigned[role] ?? 0]),
  ) as Record<AssignableRole, number>;
  const view = viewTimeline({
    steps,
    assignedRoles: ASSIGNABLE_ROLES.filter((role) => assignedCount[role] > 0),
    today,
  });
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
  };
}
