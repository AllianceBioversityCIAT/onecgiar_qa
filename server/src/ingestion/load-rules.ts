// @akili-spec ingestion/step-1-loads
import type { CycleStatus } from '../database/drizzle/schema/cycles.js';
import type {
  TimelineLoadFailureReason,
  TimelineLoadStatus,
} from '../database/drizzle/schema/timeline-loads.js';
import { compareMinutes, type RomeMinute } from '../admin-config/rome-date.js';

// Pure rules of a step-1 load (design 7.4). Time is always passed in; nothing
// here reads a clock.

/** Lease on `heartbeat_at` (DD-6, FR-9). */
export const LOAD_LEASE_MS = 5 * 60 * 1000;

export type LoadWindow = 'open' | 'CYCLES_CLOSED' | 'LOADS_WINDOW_CLOSED';

/** FR-2: a closed cycle first, then the window; the closing minute is open (S-2). */
export function loadWindow(
  cycleStatus: CycleStatus,
  step1ClosesAt: RomeMinute,
  now: RomeMinute,
): LoadWindow {
  if (cycleStatus === 'closed') return 'CYCLES_CLOSED';
  if (compareMinutes(now, step1ClosesAt) > 0) return 'LOADS_WINDOW_CLOSED';
  return 'open';
}

export interface EffectiveLoadStatus {
  status: TimelineLoadStatus;
  failureReason: TimelineLoadFailureReason | null;
}

/** FR-9: a `running` load whose heartbeat is older than the lease reads `failed`/`ABANDONED`. */
export function effectiveLoadStatus(
  status: TimelineLoadStatus,
  heartbeatAt: Date,
  now: Date,
): EffectiveLoadStatus {
  if (
    status === 'running' &&
    now.getTime() - heartbeatAt.getTime() > LOAD_LEASE_MS
  ) {
    return { status: 'failed', failureReason: 'ABANDONED' };
  }
  return { status, failureReason: null };
}

/** DD-5: an active membership ends once its timeline's last step closed (the closing minute is still open). */
export function membershipEnds(
  lastStepClosesAt: RomeMinute,
  now: RomeMinute,
): boolean {
  return compareMinutes(lastStepClosesAt, now) < 0;
}

export type SkipReason =
  | 'ACTIVE_IN_OTHER_TIMELINE'
  | 'ALREADY_IN_THIS_TIMELINE'
  | 'DUPLICATE_RESULT_CODE';

export interface CycleMembership {
  timelineId: number;
  /** Null while the membership is active. */
  endedAt: Date | null;
  /** Closing minute of the membership timeline's last step. */
  lastStepClosesAt: RomeMinute;
}

export interface SkipContext {
  timelineId: number;
  now: RomeMinute;
  /** Memberships of this `result_code` in the cycle, any timeline, ended or not. */
  memberships: readonly CycleMembership[];
  /** True when the feed listing carried this code more than once (DD-11). */
  duplicated: boolean;
}

export interface SkipVerdict {
  reason: SkipReason;
  /** The blocking timeline, for the summary of other timelines. */
  timelineId?: number;
}

/** Design 7.1 step 3 order: other timeline, this timeline, duplicate; null means load. */
export function skipVerdict(context: SkipContext): SkipVerdict | null {
  const other = context.memberships.find(
    (m) =>
      m.timelineId !== context.timelineId &&
      m.endedAt === null &&
      !membershipEnds(m.lastStepClosesAt, context.now),
  );
  if (other) {
    return { reason: 'ACTIVE_IN_OTHER_TIMELINE', timelineId: other.timelineId };
  }
  if (context.memberships.some((m) => m.timelineId === context.timelineId)) {
    return { reason: 'ALREADY_IN_THIS_TIMELINE' };
  }
  if (context.duplicated) return { reason: 'DUPLICATE_RESULT_CODE' };
  return null;
}

export interface LoadSummary {
  loaded: number;
  byProgram: Record<string, number>;
  byType: Record<string, number>;
  kpGroups: Record<string, number>;
  skipped: Record<string, number>;
  /** Keyed by timeline id. */
  otherTimelines: Record<string, { name: string; count: number }>;
}

export const EMPTY_SUMMARY: LoadSummary = {
  loaded: 0,
  byProgram: {},
  byType: {},
  kpGroups: {},
  skipped: {},
  otherTimelines: {},
};

function sumCounts(
  a: Record<string, number>,
  b: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = { ...a };
  for (const [key, count] of Object.entries(b))
    out[key] = (out[key] ?? 0) + count;
  return out;
}

/** Associative, key-wise sum of lot counts (design 7.4). */
export function mergeSummary(a: LoadSummary, b: LoadSummary): LoadSummary {
  const otherTimelines: LoadSummary['otherTimelines'] = { ...a.otherTimelines };
  for (const [id, entry] of Object.entries(b.otherTimelines)) {
    const known = otherTimelines[id];
    otherTimelines[id] = {
      name: known?.name ?? entry.name,
      count: (known?.count ?? 0) + entry.count,
    };
  }
  return {
    loaded: a.loaded + b.loaded,
    byProgram: sumCounts(a.byProgram, b.byProgram),
    byType: sumCounts(a.byType, b.byType),
    kpGroups: sumCounts(a.kpGroups, b.kpGroups),
    skipped: sumCounts(a.skipped, b.skipped),
    otherTimelines,
  };
}

export interface HasLoadFacts {
  memberships: number;
  completedLoads: number;
  runningLoadAlive: boolean;
}

/** Design 7.6 / S-6: a completed load counts even with zero members. */
export function timelineHasLoad(facts: HasLoadFacts): boolean {
  return (
    facts.memberships > 0 || facts.completedLoads > 0 || facts.runningLoadAlive
  );
}
