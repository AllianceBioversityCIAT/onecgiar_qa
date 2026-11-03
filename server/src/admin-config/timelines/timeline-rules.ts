import type { FieldIssue } from '../../users/users.errors.js';
import {
  compareMinutes,
  dayEnd,
  dayStart,
  isDstHour,
  isRomeMinute,
  type RomeMinute,
} from '../rome-date.js';
import { DEFAULT_STEPS, type StepAudience } from './default-steps.js';
import type { TimelineSnapshot } from './timeline-diff.js';
import { viewTimeline } from './timeline-view.js';

// Pure rules of a timeline create request (design 7.1, FR-6 to FR-11). The
// request is already well-typed (the DTO pipe ran first); these are the rules
// the pipe cannot judge. Every broken rule is returned, never only the first
// (FR-11), in a fixed order: name, programs, result types, the step count, then
// each step in turn (name, audience, dates, load, round). Fields are named as
// the request names them (design 6).

const NAME_MAX = 120;
const STEPS_MIN = 1;
const STEPS_MAX = 5;

/** The FR-4 table is in workflow order, so its audiences are the workflow order. */
const AUDIENCE_RANK: ReadonlyMap<string, number> = new Map(
  DEFAULT_STEPS.map((step, index) => [step.audience, index]),
);

export interface TimelineStepInput {
  name: string;
  audience: string;
  /**
   * A boundary is written as a moment, `YYYY-MM-DDTHH:mm` (`opensAt` /
   * `closesAt`, FR-1), or in the day-only form, a `YYYY-MM-DD` day that means
   * 00:00 when it opens a step and 23:59 when it closes one (`opensOn` /
   * `closesOn`, FR-9, S-6): exactly one form per boundary. Absent, null or
   * empty counts as missing (FR-8).
   */
  opensAt?: string | null;
  closesAt?: string | null;
  opensOn?: string | null;
  closesOn?: string | null;
  round: number;
  requiresLoad: boolean;
}

export interface TimelineCreateInput {
  name: string;
  allPrograms: boolean;
  /** Absent or null counts as missing, like an empty list (FR-6, FR-11, design 7.2). */
  programIds?: readonly number[] | null;
  allResultTypes: boolean;
  resultTypeKeys?: readonly string[] | null;
  steps: readonly TimelineStepInput[];
}

export interface TimelineRulesContext {
  /** The Rome minute to judge by, `YYYY-MM-DDTHH:mm` (S-4); never read from a clock here. */
  now: RomeMinute;
  knownProgramIds: ReadonlySet<number>;
  knownResultTypeKeys: ReadonlySet<string>;
}

/** Every rule a create request breaks, as `{ field, code }`; empty when it is valid. */
export function validateTimelineCreate(
  request: TimelineCreateInput,
  context: TimelineRulesContext,
): FieldIssue[] {
  const issues: FieldIssue[] = [];

  checkText(request.name, 'name', issues);

  // The scope and date rules are the merged-state checks that an edit also
  // runs (timeline-edit DD-5); what only a create can break hangs on the hooks
  // so every issue keeps its place in the order below.
  const { steps } = request;
  const family = requestFamily(steps);
  let lastAudienceRank = -1;
  checkMergedState(
    {
      programs: {
        all: request.allPrograms,
        ids: request.programIds ?? [],
        known: context.knownProgramIds,
      },
      resultTypes: {
        all: request.allResultTypes,
        ids: request.resultTypeKeys ?? [],
        known: context.knownResultTypeKeys,
      },
      steps: steps.map((step, index) => ({
        path: `steps[${index}]`,
        opens: readBoundary('opens', step.opensAt, step.opensOn, family),
        closes: readBoundary('closes', step.closesAt, step.closesOn, family),
      })),
    },
    issues,
    {
      afterScope: () => {
        if (steps.length < STEPS_MIN || steps.length > STEPS_MAX) {
          issues.push({ field: 'steps', code: 'OUT_OF_RANGE' });
        }
      },
      beforeDates: (index) => {
        const step = steps[index]!;
        const path = `steps[${index}]`;
        checkText(step.name, `${path}.name`, issues);

        const rank = AUDIENCE_RANK.get(step.audience);
        if (rank === undefined) {
          issues.push({ field: `${path}.audience`, code: 'INVALID' });
        } else if (rank <= lastAudienceRank) {
          // Equal is a repeated audience, lower is out of workflow order.
          issues.push({ field: `${path}.audience`, code: 'AUDIENCE_ORDER' });
        } else {
          lastAudienceRank = rank;
        }
      },
      afterOpensAt: (index, opens) => {
        if (index === 0 && compareMinutes(opens.moment, context.now) < 0) {
          issues.push({ field: `steps[0].${opens.key}`, code: 'BEFORE_TODAY' });
        }
      },
      afterDates: (index) => {
        const step = steps[index]!;
        const path = `steps[${index}]`;
        const previous = index > 0 ? steps[index - 1] : undefined;

        if (index === 0 && !step.requiresLoad) {
          issues.push({
            field: `${path}.requiresLoad`,
            code: 'FIRST_STEP_LOAD',
          });
        }

        const roundOk = previous
          ? step.round === previous.round || step.round === previous.round + 1
          : step.round === 1;
        if (!roundOk) {
          issues.push({ field: `${path}.round`, code: 'ROUND_SEQUENCE' });
        }
      },
    },
  );

  return issues;
}

/** A scope as the merged-state rules judge it. `known` null skips the catalog check. */
interface MergedScope<T> {
  all: boolean;
  ids: readonly T[];
  known: ReadonlySet<T> | null;
}

interface MergedStateInput {
  programs: MergedScope<number>;
  resultTypes: MergedScope<string>;
  /** In position order; `path` is the field path of the step (`steps[i]`). */
  steps: readonly {
    path: string;
    opens: Boundary;
    closes: Boundary;
  }[];
}

/** What a caller adds between the shared checks, by step index (create only). */
interface MergedStateHooks {
  /** After both scopes, before the first step. */
  afterScope?: () => void;
  /** Before a step's date checks. */
  beforeDates?: (index: number) => void;
  /** After a step's opening moment was read as a real moment, before its overlap check. */
  afterOpensAt?: (index: number, opens: ReadBoundary) => void;
  /** After a step's date checks. */
  afterDates?: (index: number) => void;
}

/**
 * The rules of the state a request leaves behind, shared by create and update
 * (timeline-edit DD-5): the scope pairs and catalog membership, moments real
 * and not in a daylight-saving hour, no step closing at or before it opens
 * (FR-3), each step opening after the previous step's closing minute. Order:
 * programs, result types, then each step in turn (opening moment, overlap,
 * closing moment, closes-before-opens). A problem is reported on the key the
 * boundary was sent with (DD-5).
 */
function checkMergedState(
  state: MergedStateInput,
  issues: FieldIssue[],
  hooks: MergedStateHooks = {},
): void {
  checkScope(
    state.programs.all,
    state.programs.ids,
    'programIds',
    state.programs.known,
    issues,
  );
  checkScope(
    state.resultTypes.all,
    state.resultTypes.ids,
    'resultTypeKeys',
    state.resultTypes.known,
    issues,
  );
  hooks.afterScope?.();

  state.steps.forEach((step, index) => {
    const previous = index > 0 ? state.steps[index - 1] : undefined;
    hooks.beforeDates?.(index);

    const opens = reportProblem(step.opens, step.path, issues);
    if (opens !== undefined) {
      hooks.afterOpensAt?.(index, opens);
      const previousClose = previous?.closes.moment;
      if (previousClose && compareMinutes(opens.moment, previousClose) <= 0) {
        issues.push({
          field: `${step.path}.${step.opens.key}`,
          code: 'OVERLAPS_PREVIOUS_STEP',
        });
      }
    }

    const closes = reportProblem(step.closes, step.path, issues);
    if (
      opens !== undefined &&
      closes !== undefined &&
      compareMinutes(closes.moment, opens.moment) <= 0
    ) {
      issues.push({
        field: `${step.path}.${step.closes.key}`,
        code: 'CLOSES_BEFORE_OPENS',
      });
    }

    hooks.afterDates?.(index);
  });
}

/** A required text, at most 120 characters once trimmed (FR-6, FR-7). */
function checkText(value: string, field: string, issues: FieldIssue[]): void {
  const length = value.trim().length;
  if (length === 0) {
    issues.push({ field, code: 'REQUIRED' });
  } else if (length > NAME_MAX) {
    issues.push({ field, code: 'TOO_LONG', max: NAME_MAX });
  }
}

/**
 * "All" or an explicit list, never both and never neither (DD-6): an absent,
 * null or empty list is missing, not "all" (the pipe lets an absent list
 * through so that it is reported with the other problems, FR-11). Ids are
 * checked against the catalog only when the list is the scope (and, on an
 * edit, only when `known` is given: an unchanged list is not re-checked).
 */
function checkScope<T>(
  all: boolean,
  list: readonly T[] | null | undefined,
  field: string,
  known: ReadonlySet<T> | null,
  issues: FieldIssue[],
): void {
  const items = list ?? [];
  if (all) {
    if (items.length > 0) issues.push({ field, code: 'INVALID' });
  } else if (items.length === 0) {
    issues.push({ field, code: 'REQUIRED' });
  } else if (known !== null && !items.every((item) => known.has(item))) {
    issues.push({ field, code: 'INVALID' });
  }
}

type Edge = 'opens' | 'closes';

/** The two ways a request writes a boundary: `…At` (a moment) or `…On` (a day). */
type Family = 'At' | 'On';

/** The four keys a boundary can be sent under, and so the four an error can name (DD-5). */
export type BoundaryKey = 'opensAt' | 'opensOn' | 'closesAt' | 'closesOn';

/** What the reader decided for one boundary of one step (design 7.2). */
interface Boundary {
  /** The key every rule problem of this boundary is reported on (DD-5). */
  key: BoundaryKey;
  /** The real Rome minute; absent whenever `problem` is set. */
  moment?: RomeMinute;
  /** Why the boundary cannot be used, as the catalog code to report. */
  problem?: 'REQUIRED' | 'INVALID' | 'DST_HOUR';
  /**
   * The value the merged state carries, for the diff and the locks: the moment
   * the sent form means, or the raw sent value when it is not one. Undefined
   * when nothing usable was sent (both forms, or neither).
   */
  raw?: string | null;
}

/** A boundary the rules accepted. */
interface ReadBoundary extends Boundary {
  moment: RomeMinute;
}

/**
 * The key a boundary is reported on when the request sent neither form of it:
 * the day-only one when the request is written day-only (an old client keeps
 * the paths it maps), else the moment (DD-5, FR-9).
 */
function requestFamily(
  steps: readonly {
    opensAt?: string | null;
    closesAt?: string | null;
    opensOn?: string | null;
    closesOn?: string | null;
  }[],
): Family {
  const sentAt = steps.some(
    (s) => s.opensAt !== undefined || s.closesAt !== undefined,
  );
  const sentOn = steps.some(
    (s) => s.opensOn !== undefined || s.closesOn !== undefined,
  );
  return sentOn && !sentAt ? 'On' : 'At';
}

/**
 * The one reader of a boundary sent in a request (design 7.2), used by the
 * rules and by the insert so they cannot choose differently:
 *
 * - only `…At`: a real `YYYY-MM-DDTHH:mm`, not in a daylight-saving hour;
 * - only `…On`: a real day, which means 00:00 when it opens and 23:59 when it
 *   closes (S-6), then the same checks (a day-only value is never in a
 *   daylight-saving hour);
 * - both: `INVALID` on the day-only key, never one of them picked, even when
 *   they agree (FR-9);
 * - neither: `REQUIRED` on the key of `family`.
 *
 * A form sent as null or empty is missing: `REQUIRED` on that form's key.
 */
function readBoundary(
  edge: Edge,
  at: string | null | undefined,
  on: string | null | undefined,
  family: Family,
): Boundary {
  if (at !== undefined && on !== undefined) {
    return { key: `${edge}On`, problem: 'INVALID' };
  }
  if (at === undefined && on === undefined) {
    return { key: `${edge}${family}`, problem: 'REQUIRED' };
  }
  const form: Family = at !== undefined ? 'At' : 'On';
  const key: BoundaryKey = `${edge}${form}`;
  const sent = at !== undefined ? at : on;
  if (sent === null || sent === undefined || sent === '') {
    return { key, problem: 'REQUIRED', raw: sent };
  }
  // The day of a day-only value is not checked on its own: `isRomeMinute`
  // refuses anything that is not a real `YYYY-MM-DD` with its time after it.
  const value =
    form === 'At' ? sent : edge === 'opens' ? dayStart(sent) : dayEnd(sent);
  if (!isRomeMinute(value)) return { key, problem: 'INVALID', raw: value };
  if (isDstHour(value)) return { key, problem: 'DST_HOUR', raw: value };
  return { key, moment: value, raw: value };
}

/** A boundary the request did not send: the stored moment, as it is. */
function storedBoundary(
  edge: Edge,
  moment: RomeMinute,
  family: Family,
): ReadBoundary {
  return { key: `${edge}${family}`, moment, raw: moment };
}

/**
 * The moments of a create step, read by the same reader the rules use (FR-1,
 * FR-9). Called after the rules accepted the request: a step that still has a
 * problem here is a caller that skipped them.
 */
export function momentsOfStep(step: TimelineStepInput): {
  opensAt: RomeMinute;
  closesAt: RomeMinute;
} {
  const opens = readBoundary('opens', step.opensAt, step.opensOn, 'At');
  const closes = readBoundary('closes', step.closesAt, step.closesOn, 'At');
  if (opens.moment === undefined || closes.moment === undefined) {
    throw new Error('A step was written before its moments were validated');
  }
  return { opensAt: opens.moment, closesAt: closes.moment };
}

/** Reports the problem of a boundary on its key; the boundary when it is usable. */
function reportProblem(
  boundary: Boundary,
  path: string,
  issues: FieldIssue[],
): ReadBoundary | undefined {
  if (boundary.problem !== undefined) {
    issues.push({ field: `${path}.${boundary.key}`, code: boundary.problem });
    return undefined;
  }
  return boundary as ReadBoundary;
}

// ---------------------------------------------------------------------------
// Edit (timeline-edit design 6, 7.1; FR-1, FR-3, FR-4, FR-5; DD-4, DD-5, DD-7)
// ---------------------------------------------------------------------------

/** A stored step, as `viewTimeline` reads it, with its name. */
export interface StoredTimelineStep {
  position: number;
  name: string;
  audience: StepAudience;
  opensAt: RomeMinute;
  closesAt: RomeMinute;
}

/** The timeline as stored: what the edit rules overlay the request on. */
export interface StoredTimeline {
  name: string;
  allPrograms: boolean;
  programIds: readonly number[];
  allResultTypes: boolean;
  resultTypeKeys: readonly string[];
  steps: readonly StoredTimelineStep[];
}

/** A step of an edit, addressed by position (S-4); only these fields can change. */
export interface TimelineStepUpdate {
  position: number;
  name?: string;
  /** A moment, `YYYY-MM-DDTHH:mm` (FR-1). Not together with its day-only form (FR-9). */
  opensAt?: string | null;
  closesAt?: string | null;
  /** The day-only form (FR-9): 00:00 of that day when it opens, 23:59 when it closes (S-6). */
  opensOn?: string | null;
  closesOn?: string | null;
}

/**
 * An edit request after the pipe (shape only). A key left out keeps its stored
 * value. `version` and `confirmInProgress` are the service's, not the rules'.
 */
export interface TimelineUpdateInput {
  name?: string;
  allPrograms?: boolean;
  programIds?: readonly number[] | null;
  allResultTypes?: boolean;
  resultTypeKeys?: readonly string[] | null;
  steps?: readonly TimelineStepUpdate[];
}

/**
 * Now, the catalogs and whether the timeline has a load. A catalog set is
 * read only for a scope list that changes (design 7.2), so for an unchanged
 * list the set may be empty: the rules do not look at it.
 */
export interface TimelineUpdateContext extends TimelineRulesContext {
  /** From the `TIMELINE_LOADS` port, the same source the view uses for the hold. */
  hasLoad: boolean;
}

/** A step of an edit once its sent boundaries are read; the others are the stored ones. */
interface ResolvedStep {
  opens: Boundary;
  closes: Boundary;
}

/**
 * The stored values overlaid with the sent ones (design 7.1 step 2), and, by
 * position, how each step's boundaries were read. Text is trimmed and lists
 * are deduped, as create does. A scope flag turned on with no list empties the
 * list; a list sent without its flag is merged under the stored flag. A step
 * position the timeline lacks is ignored (the rules report it). A boundary
 * sent in either form becomes the moment it means, so an unchanged value is
 * one whose moment equals the stored one (FR-9: a `closesOn` equal to the
 * stored date over a stored 17:30 is a change to 23:59); one sent in both
 * forms, or in none, keeps the stored value, and its problem is the rules'.
 */
function resolveUpdate(
  stored: StoredTimeline,
  request: TimelineUpdateInput,
): { snapshot: TimelineSnapshot; steps: Map<number, ResolvedStep> } {
  const programs = mergeScope(
    stored.allPrograms,
    stored.programIds,
    request.allPrograms,
    request.programIds,
  );
  const resultTypes = mergeScope(
    stored.allResultTypes,
    stored.resultTypeKeys,
    request.allResultTypes,
    request.resultTypeKeys,
  );
  const sent = firstStepUpdates(request.steps ?? [], stored);
  const family = requestFamily(request.steps ?? []);
  const resolved = new Map<number, ResolvedStep>();

  const steps = [...stored.steps]
    .sort((a, b) => a.position - b.position)
    .map((step) => {
      const update = sent.get(step.position)?.update;
      const opens =
        update?.opensAt !== undefined || update?.opensOn !== undefined
          ? readBoundary('opens', update.opensAt, update.opensOn, family)
          : storedBoundary('opens', step.opensAt, family);
      const closes =
        update?.closesAt !== undefined || update?.closesOn !== undefined
          ? readBoundary('closes', update.closesAt, update.closesOn, family)
          : storedBoundary('closes', step.closesAt, family);
      resolved.set(step.position, { opens, closes });
      return {
        position: step.position,
        name: (update?.name ?? step.name).trim(),
        opensAt: opens.raw !== undefined ? opens.raw : step.opensAt,
        closesAt: closes.raw !== undefined ? closes.raw : step.closesAt,
      };
    });

  return {
    snapshot: {
      name: (request.name ?? stored.name).trim(),
      allPrograms: programs.all,
      programIds: programs.ids,
      allResultTypes: resultTypes.all,
      resultTypeKeys: resultTypes.ids,
      steps,
    },
    steps: resolved,
  };
}

/**
 * The merged state of an edit (design 7.1 step 2). It can still hold values
 * the rules refuse; it is what the diff and the write take once they pass.
 */
export function mergeTimelineUpdate(
  stored: StoredTimeline,
  request: TimelineUpdateInput,
): TimelineSnapshot {
  return resolveUpdate(stored, request).snapshot;
}

/**
 * Every rule an edit breaks, as `{ field, code }`; empty when it is valid
 * (design 7.1). Fixed order: (1) structure, (2) the text checks on every sent
 * name, (3) the locks on changed fields, (4) the merged-state rules shared with
 * create. Paths: `name`, `programIds`, `resultTypeKeys`, `steps[position - 1].<key>`;
 * a position the timeline lacks is named by its index in the request (DD-7).
 *
 * The locks judge CHANGED fields only (DD-4): a value sent equal to the stored
 * one is not a change, so a drawer may resend a past date. The step state is
 * `viewTimeline`'s, over the stored steps, `hasLoad` and now, never worked
 * out here.
 */
export function validateTimelineUpdate(
  stored: StoredTimeline,
  request: TimelineUpdateInput,
  context: TimelineUpdateContext,
): FieldIssue[] {
  const issues: FieldIssue[] = [];
  const requestSteps = request.steps ?? [];

  // 1. Structure: a position the timeline lacks, or the same one twice.
  const sent = firstStepUpdates(requestSteps, stored);
  requestSteps.forEach((update, index) => {
    if (sent.get(update.position)?.index !== index) {
      issues.push({ field: `steps[${index}].position`, code: 'INVALID' });
    }
  });

  // 2. Text checks on every sent name (an unknown position is not judged).
  if (request.name !== undefined) checkText(request.name, 'name', issues);
  for (const { update } of sent.values()) {
    if (update.name !== undefined) {
      checkText(update.name, `${stepPath(update.position)}.name`, issues);
    }
  }

  // 3. Locks, on changed fields only.
  const { snapshot: merged, steps: boundaries } = resolveUpdate(
    stored,
    request,
  );
  checkLocks(stored, merged, boundaries, context, issues);

  // 4. Merged-state rules, the same function create calls. A scope is checked
  // against the catalog only when it changed; an unchanged one was valid.
  checkMergedState(
    {
      programs: {
        all: merged.allPrograms,
        ids: merged.programIds,
        known: scopeChanged(
          stored.allPrograms,
          stored.programIds,
          merged.allPrograms,
          merged.programIds,
        )
          ? context.knownProgramIds
          : null,
      },
      resultTypes: {
        all: merged.allResultTypes,
        ids: merged.resultTypeKeys,
        known: scopeChanged(
          stored.allResultTypes,
          stored.resultTypeKeys,
          merged.allResultTypes,
          merged.resultTypeKeys,
        )
          ? context.knownResultTypeKeys
          : null,
      },
      steps: merged.steps.map((step) => ({
        path: stepPath(step.position),
        ...boundaries.get(step.position)!,
      })),
    },
    issues,
  );

  return issues;
}

/** The field path of a step on an edit: its index in the timeline (DD-7). */
const stepPath = (position: number): string => `steps[${position - 1}]`;

/**
 * The first request entry for each position the timeline has, with its request
 * index; a later entry of the same position and an unknown position are absent
 * (the rules name those).
 */
function firstStepUpdates(
  requestSteps: readonly TimelineStepUpdate[],
  stored: StoredTimeline,
): Map<number, { update: TimelineStepUpdate; index: number }> {
  const known = new Set(stored.steps.map((step) => step.position));
  const first = new Map<
    number,
    { update: TimelineStepUpdate; index: number }
  >();
  requestSteps.forEach((update, index) => {
    if (known.has(update.position) && !first.has(update.position)) {
      first.set(update.position, { update, index });
    }
  });
  return first;
}

function mergeScope<T>(
  storedAll: boolean,
  storedIds: readonly T[],
  sentAll: boolean | undefined,
  sentIds: readonly T[] | null | undefined,
): { all: boolean; ids: T[] } {
  const all = sentAll ?? storedAll;
  if (sentIds !== undefined && sentIds !== null) {
    return { all, ids: [...new Set(sentIds)] };
  }
  // An "all" turned on empties the list, as create does (design 6).
  return { all, ids: sentAll === true ? [] : [...new Set(storedIds)] };
}

function scopeChanged<T>(
  storedAll: boolean,
  storedIds: readonly T[],
  mergedAll: boolean,
  mergedIds: readonly T[],
): boolean {
  const before = new Set(storedIds);
  const after = new Set(mergedIds);
  return (
    storedAll !== mergedAll ||
    before.size !== after.size ||
    [...after].some((item) => !before.has(item))
  );
}

/**
 * FR-3 and FR-4 over the fields whose merged value differs from the stored one.
 * Steps in position order (opening, then closing), then the programs and the
 * result types.
 */
function checkLocks(
  stored: StoredTimeline,
  merged: TimelineSnapshot,
  boundaries: ReadonlyMap<number, ResolvedStep>,
  context: TimelineUpdateContext,
  issues: FieldIssue[],
): void {
  const { stepStates } = viewTimeline({
    steps: stored.steps,
    assignedRoles: [],
    now: context.now,
    hasLoad: context.hasLoad,
  });
  // Before now, to the minute (S-4); a value that is not a usable moment is the
  // merged-state rules' to refuse, not a lock's.
  const beforeNow = (boundary: Boundary): boolean =>
    boundary.moment !== undefined &&
    compareMinutes(boundary.moment, context.now) < 0;

  const mergedByPosition = new Map(merged.steps.map((s) => [s.position, s]));
  for (const step of [...stored.steps].sort(
    (a, b) => a.position - b.position,
  )) {
    const after = mergedByPosition.get(step.position);
    const read = boundaries.get(step.position);
    if (after === undefined || read === undefined) continue;
    const path = stepPath(step.position);
    const state = stepStates[step.position];
    const opensChanged = after.opensAt !== step.opensAt;
    const closesChanged = after.closesAt !== step.closesAt;
    const opensField = `${path}.${read.opens.key}`;
    const closesField = `${path}.${read.closes.key}`;

    if (state === 'closed') {
      if (opensChanged) issues.push({ field: opensField, code: 'LOCKED' });
      if (closesChanged) issues.push({ field: closesField, code: 'LOCKED' });
    } else if (state === 'in_progress') {
      if (opensChanged) issues.push({ field: opensField, code: 'LOCKED' });
      if (closesChanged && beforeNow(read.closes)) {
        issues.push({ field: closesField, code: 'BEFORE_TODAY' });
      }
    } else if (opensChanged && beforeNow(read.opens)) {
      issues.push({ field: opensField, code: 'BEFORE_TODAY' });
    }
  }

  // A scope is open only while step 1 has not started (`upcoming`, a hold
  // included) and the timeline has no load (FR-4).
  const scopeOpen = stepStates[1] === 'upcoming' && !context.hasLoad;
  if (
    !scopeOpen &&
    scopeChanged(
      stored.allPrograms,
      stored.programIds,
      merged.allPrograms,
      merged.programIds,
    )
  ) {
    issues.push({ field: 'programIds', code: 'LOCKED' });
  }
  if (
    !scopeOpen &&
    scopeChanged(
      stored.allResultTypes,
      stored.resultTypeKeys,
      merged.allResultTypes,
      merged.resultTypeKeys,
    )
  ) {
    issues.push({ field: 'resultTypeKeys', code: 'LOCKED' });
  }
}
