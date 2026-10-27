import type { FieldIssue } from '../../users/users.errors.js';
import { compareDates, isCalendarDate } from '../rome-date.js';
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
  /** Absent, null or empty counts as missing (FR-8). */
  opensAt?: string | null;
  closesAt?: string | null;
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
  /** The Rome day to judge by, `YYYY-MM-DD` (S-4); never read from a clock here. */
  now: string;
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
        opensAt: step.opensAt,
        closesAt: step.closesAt,
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
      afterOpensAt: (index, opensAt) => {
        if (index === 0 && compareDates(opensAt, context.now) < 0) {
          issues.push({ field: 'steps[0].opensOn', code: 'BEFORE_TODAY' });
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
    opensAt?: string | null;
    closesAt?: string | null;
  }[];
}

/** What a caller adds between the shared checks, by step index (create only). */
interface MergedStateHooks {
  /** After both scopes, before the first step. */
  afterScope?: () => void;
  /** Before a step's date checks. */
  beforeDates?: (index: number) => void;
  /** After a step's opening date was read as a real date, before its overlap check. */
  afterOpensAt?: (index: number, opensAt: string) => void;
  /** After a step's date checks. */
  afterDates?: (index: number) => void;
}

/**
 * The rules of the state a request leaves behind, shared by create and update
 * (timeline-edit DD-5): the scope pairs and catalog membership, dates real, no
 * step closing before it opens, each step opening after the previous step's
 * closing day. Order: programs, result types, then each step in turn
 * (opening date, overlap, closing date, closes-before-opens).
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

    const opensAt = readDate(step.opensAt, `${step.path}.opensOn`, issues);
    if (opensAt !== undefined) {
      hooks.afterOpensAt?.(index, opensAt);
      const previousClose = previous && validDate(previous.closesAt);
      if (previousClose && compareDates(opensAt, previousClose) <= 0) {
        issues.push({
          field: `${step.path}.opensOn`,
          code: 'OVERLAPS_PREVIOUS_STEP',
        });
      }
    }

    const closesAt = readDate(step.closesAt, `${step.path}.closesOn`, issues);
    if (
      opensAt !== undefined &&
      closesAt !== undefined &&
      compareDates(closesAt, opensAt) < 0
    ) {
      issues.push({
        field: `${step.path}.closesOn`,
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

/** The date when real; a missing one is REQUIRED and a malformed one INVALID (FR-8). */
function readDate(
  value: string | null | undefined,
  field: string,
  issues: FieldIssue[],
): string | undefined {
  if (value === undefined || value === null || value === '') {
    issues.push({ field, code: 'REQUIRED' });
    return undefined;
  }
  if (!isCalendarDate(value)) {
    issues.push({ field, code: 'INVALID' });
    return undefined;
  }
  return value;
}

function validDate(value: string | null | undefined): string | undefined {
  return typeof value === 'string' && isCalendarDate(value) ? value : undefined;
}

// ---------------------------------------------------------------------------
// Edit (timeline-edit design 6, 7.1; FR-1, FR-3, FR-4, FR-5; DD-4, DD-5, DD-7)
// ---------------------------------------------------------------------------

/** A stored step, as `viewTimeline` reads it, with its name. */
export interface StoredTimelineStep {
  position: number;
  name: string;
  audience: StepAudience;
  opensAt: string;
  closesAt: string;
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
  opensAt?: string | null;
  closesAt?: string | null;
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
 * Today, the catalogs and whether the timeline has a load. A catalog set is
 * read only for a scope list that changes (design 7.2), so for an unchanged
 * list the set may be empty: the rules do not look at it.
 */
export interface TimelineUpdateContext extends TimelineRulesContext {
  /** From the `TIMELINE_LOADS` port, the same source the view uses for the hold. */
  hasLoad: boolean;
}

/**
 * The stored values overlaid with the sent ones (design 7.1 step 2). Text is
 * trimmed and lists are deduped, as create does. A scope flag turned on with no
 * list empties the list; a list sent without its flag is merged under the
 * stored flag. A step position the timeline lacks is ignored (the rules report
 * it). The result can still hold values the rules refuse; it is what the diff
 * and the write take once they pass.
 */
export function mergeTimelineUpdate(
  stored: StoredTimeline,
  request: TimelineUpdateInput,
): TimelineSnapshot {
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

  return {
    name: (request.name ?? stored.name).trim(),
    allPrograms: programs.all,
    programIds: programs.ids,
    allResultTypes: resultTypes.all,
    resultTypeKeys: resultTypes.ids,
    steps: [...stored.steps]
      .sort((a, b) => a.position - b.position)
      .map((step) => {
        const update = sent.get(step.position)?.update;
        return {
          position: step.position,
          name: (update?.name ?? step.name).trim(),
          opensAt:
            update?.opensAt !== undefined ? update.opensAt : step.opensAt,
          closesAt:
            update?.closesAt !== undefined ? update.closesAt : step.closesAt,
        };
      }),
  };
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
 * `viewTimeline`'s, over the stored steps, `hasLoad` and today, never worked
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
  const merged = mergeTimelineUpdate(stored, request);
  checkLocks(stored, merged, context, issues);

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
        opensAt: step.opensAt,
        closesAt: step.closesAt,
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
  context: TimelineUpdateContext,
  issues: FieldIssue[],
): void {
  const { stepStates } = viewTimeline({
    steps: stored.steps,
    assignedRoles: [],
    now: context.now,
    hasLoad: context.hasLoad,
  });
  const beforeToday = (value: string | null | undefined): boolean =>
    typeof value === 'string' &&
    isCalendarDate(value) &&
    compareDates(value, context.now) < 0;

  const mergedByPosition = new Map(merged.steps.map((s) => [s.position, s]));
  for (const step of [...stored.steps].sort(
    (a, b) => a.position - b.position,
  )) {
    const after = mergedByPosition.get(step.position);
    if (after === undefined) continue;
    const path = stepPath(step.position);
    const state = stepStates[step.position];
    const opensChanged = after.opensAt !== step.opensAt;
    const closesChanged = after.closesAt !== step.closesAt;

    if (state === 'closed') {
      if (opensChanged)
        issues.push({ field: `${path}.opensOn`, code: 'LOCKED' });
      if (closesChanged) {
        issues.push({ field: `${path}.closesOn`, code: 'LOCKED' });
      }
    } else if (state === 'in_progress') {
      if (opensChanged)
        issues.push({ field: `${path}.opensOn`, code: 'LOCKED' });
      if (closesChanged && beforeToday(after.closesAt)) {
        issues.push({ field: `${path}.closesOn`, code: 'BEFORE_TODAY' });
      }
    } else if (opensChanged && beforeToday(after.opensAt)) {
      issues.push({ field: `${path}.opensOn`, code: 'BEFORE_TODAY' });
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
