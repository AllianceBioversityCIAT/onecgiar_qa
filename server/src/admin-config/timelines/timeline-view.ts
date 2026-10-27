import type { RoleCode } from '../../users/permissions.js';
import { compareDates } from '../rome-date.js';
import type { StepAudience } from './default-steps.js';

export type TimelineStatus =
  'scheduled' | 'waiting_for_load' | 'live' | 'finished';

/** A step's state on read (timeline-edit FR-2). */
export type TimelineStepState = 'closed' | 'in_progress' | 'upcoming';

export interface TimelineViewStep {
  position: number;
  audience: StepAudience;
  opensOn: string;
  closesOn: string;
}

export interface TimelineViewInput {
  steps: readonly TimelineViewStep[];
  /** Roles with at least one active assignment on the timeline. */
  assignedRoles: readonly RoleCode[];
  /** Today's date in Europe/Rome, `YYYY-MM-DD`; never read from a clock here. */
  today: string;
  /** Whether the timeline has a load (the `TIMELINE_LOADS` port, design 7.4). */
  hasLoad: boolean;
}

export interface TimelineView {
  status: TimelineStatus;
  currentStep: number | null;
  nextStep: number | null;
  readiness: string[];
  /** The state of each step, by position. */
  stepStates: Record<number, TimelineStepState>;
}

/** The role a step's audience is assigned as; Science Programs are never assigned here (D-3). */
const AUDIENCE_ROLE: Readonly<Record<StepAudience, RoleCode | null>> = {
  assessors: 'ASSESSOR',
  programs: null,
  lead_assessors: 'LEAD_ASSESSOR',
  tpb: 'TPB',
  ppu: 'PPU',
};

const MISSING_ROLE_ITEM: Readonly<Partial<Record<RoleCode, string>>> = {
  ASSESSOR: 'NO_ASSESSOR_ASSIGNED',
  LEAD_ASSESSOR: 'NO_LEAD_ASSESSOR_ASSIGNED',
  TPB: 'NO_TPB_ASSIGNED',
  PPU: 'NO_PPU_ASSIGNED',
};

/**
 * Status, step states, current step, next step and readiness from the steps,
 * the roles with an active assignment, whether the timeline has a load and
 * today's Rome date (timeline-edit design 7.1; *timelines* FR-12, FR-13). A step
 * is open from `opensOn` to `closesOn`, both days included (S-1). Computed on
 * read; nothing is stored (DD-2).
 *
 * **Hold** (timeline-edit FR-6, DD-2): step 1 exists, its opening day has
 * arrived and there is no load. The hold wins over the dates: status is
 * `waiting_for_load` even after every step's closing day, every step is
 * `upcoming`, there is no current step and the next one is step 1 (S-2).
 */
export function viewTimeline(input: TimelineViewInput): TimelineView {
  const { steps, assignedRoles, today, hasLoad } = input;

  const first = steps.reduce<TimelineViewStep | undefined>(
    (lowest, step) =>
      lowest === undefined || step.position < lowest.position ? step : lowest,
    undefined,
  );
  const onHold =
    first !== undefined && compareDates(first.opensOn, today) <= 0 && !hasLoad;

  const stepStates: Record<number, TimelineStepState> = {};
  for (const step of steps) {
    stepStates[step.position] = onHold
      ? 'upcoming'
      : compareDates(step.closesOn, today) < 0
        ? 'closed'
        : compareDates(step.opensOn, today) <= 0
          ? 'in_progress'
          : 'upcoming';
  }

  const current = onHold
    ? undefined
    : steps.find((step) => stepStates[step.position] === 'in_progress');
  const next = onHold
    ? first
    : steps
        .filter((step) => compareDates(step.opensOn, today) > 0)
        .sort((a, b) => compareDates(a.opensOn, b.opensOn))[0];

  const lastClose = steps
    .map((s) => s.closesOn)
    .sort(compareDates)
    .at(-1);
  const status: TimelineStatus =
    first === undefined || compareDates(today, first.opensOn) < 0
      ? 'scheduled'
      : onHold
        ? 'waiting_for_load'
        : lastClose !== undefined && compareDates(today, lastClose) > 0
          ? 'finished'
          : 'live';

  const readiness = ['NO_RESULTS_LOADED'];
  for (const step of steps) {
    const role = AUDIENCE_ROLE[step.audience];
    if (role === null || assignedRoles.includes(role)) continue;
    const item = MISSING_ROLE_ITEM[role];
    if (item !== undefined && !readiness.includes(item)) readiness.push(item);
  }

  return {
    status,
    currentStep: current?.position ?? null,
    nextStep: next?.position ?? null,
    readiness,
    stepStates,
  };
}
