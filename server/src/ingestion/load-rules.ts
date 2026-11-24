// @akili-spec ingestion/step-1-loads
// @akili-spec ingestion/timeline-sync
import type { CycleStatus } from '../database/drizzle/schema/cycles.js';
import type { TimelineResultEndReason } from '../database/drizzle/schema/timeline-results.js';
import type {
  TimelineLoadFailureReason,
  TimelineLoadStatus,
} from '../database/drizzle/schema/timeline-loads.js';
import { compareMinutes, type RomeMinute } from '../admin-config/rome-date.js';
import { MAX_ROUND } from '../admin-config/timelines/timeline-rules.js';

// Pure rules of a sync (timeline-sync design 7.4, step-1 design 7.4). Time is
// always passed in; nothing here reads a clock.

/** Lease on `heartbeat_at` (DD-6, FR-9). */
export const LOAD_LEASE_MS = 5 * 60 * 1000;

export type SyncWindow = 'open' | 'CYCLES_CLOSED' | 'LOADS_WINDOW_CLOSED';

/**
 * FR-1: a closed cycle first, then the window, which ends with the closing
 * minute of the timeline's LAST step; that closing minute is still open (S-2).
 */
export function syncWindow(
  cycleStatus: CycleStatus,
  lastStepClosesAt: RomeMinute,
  now: RomeMinute,
): SyncWindow {
  if (cycleStatus === 'closed') return 'CYCLES_CLOSED';
  if (compareMinutes(now, lastStepClosesAt) > 0) return 'LOADS_WINDOW_CLOSED';
  return 'open';
}

/** What the round rules need of a timeline step (design 7.1 step 2). */
export interface RoundStep {
  position: number;
  opensAt: RomeMinute;
  /** The stored QA round of the step. */
  round: number;
}

/** FR-2: the last step whose opening minute has passed; step 1 before any opens. */
export function stepInForce<S extends RoundStep>(
  steps: readonly S[],
  now: RomeMinute,
): S {
  let first: S | undefined;
  let inForce: S | undefined;
  for (const step of steps) {
    if (first === undefined || step.position < first.position) first = step;
    if (
      compareMinutes(step.opensAt, now) <= 0 &&
      (inForce === undefined || step.position > inForce.position)
    ) {
      inForce = step;
    }
  }
  const found = inForce ?? first;
  // Every timeline has a step 1 (FR-9 of *timelines*): none is corrupt data.
  if (found === undefined) throw new Error('A timeline has no steps');
  return found;
}

/** FR-2, DD-1: the stored round of the step in force; a round outside 1..MAX_ROUND is a defect and throws. */
export function entryRound(
  steps: readonly RoundStep[],
  now: RomeMinute,
): 1 | 2 {
  const { round } = stepInForce(steps, now);
  if (!Number.isInteger(round) || round < 1 || round > MAX_ROUND) {
    throw new Error(`A stored step round outside 1-${MAX_ROUND}`);
  }
  return round as 1 | 2;
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
  | 'RETURNED_NOT_RESUBMITTED'
  | 'DUPLICATE_RESULT_CODE';

export interface CycleMembership {
  id: number;
  timelineId: number;
  /** The round the membership entered in (FR-2). */
  entryRound: number;
  /** Null while the membership is active. */
  endedAt: Date | null;
  endReason: TimelineResultEndReason | null;
  /** Closing minute of the membership timeline's last step. */
  lastStepClosesAt: RomeMinute;
}

export interface SkipContext<M extends CycleMembership = CycleMembership> {
  /** The sync's round (FR-2). */
  round: number;
  timelineId: number;
  now: RomeMinute;
  /** The feed's `submitted_at` of the result (ISO, UTC), null when Reporting has none. */
  submittedAt: string | null;
  /** Memberships of this `result_code` in the cycle, any timeline, ended or not. */
  memberships: readonly M[];
  /** True when the feed listing carried this code more than once (DD-11). */
  duplicated: boolean;
}

export interface SkipVerdict {
  reason: SkipReason;
  /** The blocking timeline, for the summary of other timelines. */
  timelineId?: number;
}

export interface TakeVerdict<M extends CycleMembership = CycleMembership> {
  kind: 'new' | 'resubmitted';
  /**
   * The membership whose snapshot the new one is compared with (DD-6): the
   * cycle's latest of the code, or for a re-submission the returned round-1 row.
   */
  previous: M | null;
}

/** FR-4 order: other timeline, this round here, returned and not resubmitted, other end here, duplicate; otherwise a take. */
export function skipVerdict<M extends CycleMembership>(
  context: SkipContext<M>,
): SkipVerdict | TakeVerdict<M> {
  const { round, timelineId, now, submittedAt, memberships } = context;

  // 1. Another timeline of the cycle, whose last step has not closed, holds the
  // result: an active membership, or one ended as `returned` (S-6, DD-3).
  const other = memberships.find(
    (m) =>
      m.timelineId !== timelineId &&
      (m.endedAt === null || m.endReason === 'returned') &&
      !membershipEnds(m.lastStepClosesAt, now),
  );
  if (other) {
    return { reason: 'ACTIVE_IN_OTHER_TIMELINE', timelineId: other.timelineId };
  }

  // 2. This timeline holds it now, or already took it in this round.
  const here = memberships.filter((m) => m.timelineId === timelineId);
  if (here.some((m) => m.endedAt === null || m.entryRound === round)) {
    return { reason: 'ALREADY_IN_THIS_TIMELINE' };
  }

  // 3 and 4. Round 2: the round-1 membership here ended before this sync.
  let returnedHere: M | undefined;
  if (round > 1) {
    const roundOne = here.find((m) => m.entryRound === 1);
    if (roundOne?.endReason === 'returned' && roundOne.endedAt !== null) {
      if (!isResubmitted(submittedAt, roundOne.endedAt)) {
        return { reason: 'RETURNED_NOT_RESUBMITTED' };
      }
      returnedHere = roundOne;
    } else if (roundOne) {
      return { reason: 'ALREADY_IN_THIS_TIMELINE' };
    }
  }

  // 5. The feed listed it twice.
  if (context.duplicated) return { reason: 'DUPLICATE_RESULT_CODE' };

  // 6. Taken. `previous` is the latest membership of the code in the cycle
  // (DD-6); for a re-submission, the returned round-1 row here.
  if (returnedHere) return { kind: 'resubmitted', previous: returnedHere };
  let latest: M | null = null;
  for (const m of memberships) {
    if (latest === null || m.id > latest.id) latest = m;
  }
  return { kind: 'new', previous: latest };
}

/** DD-8: the feed's `submitted_at` is later than the return, as UTC instants at whole seconds, strictly. */
export function isResubmitted(
  submittedAt: string | null,
  endedAt: Date,
): boolean {
  if (submittedAt === null) return false;
  const submitted = Date.parse(submittedAt);
  // A date Reporting cannot have sent is never a re-submission (fails closed).
  if (Number.isNaN(submitted)) return false;
  return Math.floor(submitted / 1000) > Math.floor(endedAt.getTime() / 1000);
}

/** JSON with every object's keys sorted, so equal values always hash alike (step-1 design 5.2). */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const members = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${members.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** FR-8: the sorted keys whose canonical JSON differs, over the union of both sides. */
export function changedFields(
  previous: Record<string, unknown>,
  current: Record<string, unknown>,
): string[] {
  const keys = new Set([...Object.keys(previous), ...Object.keys(current)]);
  return [...keys]
    .filter(
      (key) =>
        !(key in previous) ||
        !(key in current) ||
        canonicalJson(previous[key]) !== canonicalJson(current[key]),
    )
    .sort();
}

export interface ReturnedNotResubmitted {
  total: number;
  byProgram: Record<string, number>;
  byType: Record<string, number>;
}

export interface LoadSummary {
  loaded: number;
  /** `loaded = loadedNew + loadedResubmitted` (FR-9). */
  loadedNew: number;
  loadedResubmitted: number;
  /** The load's round: equal on every lot of one load. */
  round: 1 | 2;
  byProgram: Record<string, number>;
  byType: Record<string, number>;
  kpGroups: Record<string, number>;
  skipped: Record<string, number>;
  /** Keyed by timeline id. */
  otherTimelines: Record<string, { name: string; count: number }>;
  /** Written once at the end of the run, never summed per lot (design 5.3, DD-7). */
  returnedNotResubmitted: ReturnedNotResubmitted;
}

export const EMPTY_SUMMARY: LoadSummary = {
  loaded: 0,
  loadedNew: 0,
  loadedResubmitted: 0,
  round: 1,
  byProgram: {},
  byType: {},
  kpGroups: {},
  skipped: {},
  otherTimelines: {},
  returnedNotResubmitted: { total: 0, byProgram: {}, byType: {} },
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

/** Associative, key-wise sum of lot counts (design 5.3); a round mismatch throws. */
export function mergeSummary(a: LoadSummary, b: LoadSummary): LoadSummary {
  // One load is one round: a mismatch is a programming error, never data.
  if (a.round !== b.round) {
    throw new Error('Cannot merge the summaries of two different rounds');
  }
  const otherTimelines: LoadSummary['otherTimelines'] = {};
  for (const [id, entry] of Object.entries(a.otherTimelines)) {
    otherTimelines[id] = { ...entry };
  }
  for (const [id, entry] of Object.entries(b.otherTimelines)) {
    const known = otherTimelines[id];
    otherTimelines[id] = {
      name: known?.name ?? entry.name,
      count: (known?.count ?? 0) + entry.count,
    };
  }
  return {
    loaded: a.loaded + b.loaded,
    loadedNew: a.loadedNew + b.loadedNew,
    loadedResubmitted: a.loadedResubmitted + b.loadedResubmitted,
    round: a.round,
    byProgram: sumCounts(a.byProgram, b.byProgram),
    byType: sumCounts(a.byType, b.byType),
    kpGroups: sumCounts(a.kpGroups, b.kpGroups),
    skipped: sumCounts(a.skipped, b.skipped),
    otherTimelines,
    // Not summed (design 5.3, DD-7): written once at the end of the run.
    returnedNotResubmitted: {
      total: a.returnedNotResubmitted.total,
      byProgram: { ...a.returnedNotResubmitted.byProgram },
      byType: { ...a.returnedNotResubmitted.byType },
    },
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
