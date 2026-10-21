import type { RoleCode } from '../../users/permissions.js';
import { compareDates } from '../rome-date.js';
import type { StepAudience } from './default-steps.js';

export type TimelineStatus = 'scheduled' | 'live' | 'finished';

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
}

export interface TimelineView {
  status: TimelineStatus;
  currentStep: number | null;
  nextStep: number | null;
  readiness: string[];
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
 * Status, current step, next step and readiness from the steps, the roles with
 * an active assignment and today's Rome date (design 7.1, FR-12, FR-13). A step
 * is open from `opensOn` to `closesOn`, both days included (S-1). Computed on
 * read; nothing is stored (DD-2).
 */
export function viewTimeline(input: TimelineViewInput): TimelineView {
  const { steps, assignedRoles, today } = input;

  const current = steps.find(
    (step) =>
      compareDates(step.opensOn, today) <= 0 &&
      compareDates(today, step.closesOn) <= 0,
  );
  const next = steps
    .filter((step) => compareDates(step.opensOn, today) > 0)
    .sort((a, b) => compareDates(a.opensOn, b.opensOn))[0];

  const firstOpen = steps.map((s) => s.opensOn).sort(compareDates)[0];
  const lastClose = steps
    .map((s) => s.closesOn)
    .sort(compareDates)
    .at(-1);
  const status: TimelineStatus =
    firstOpen === undefined || compareDates(today, firstOpen) < 0
      ? 'scheduled'
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
  };
}
