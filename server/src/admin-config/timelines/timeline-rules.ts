import type { FieldIssue } from '../../users/users.errors.js';
import { compareDates, isCalendarDate } from '../rome-date.js';
import { DEFAULT_STEPS } from './default-steps.js';

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
  /** Today's date in Europe/Rome, `YYYY-MM-DD` (S-4); never read from a clock here. */
  today: string;
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
  checkScope(
    request.allPrograms,
    request.programIds,
    'programIds',
    context.knownProgramIds,
    issues,
  );
  checkScope(
    request.allResultTypes,
    request.resultTypeKeys,
    'resultTypeKeys',
    context.knownResultTypeKeys,
    issues,
  );

  const { steps } = request;
  if (steps.length < STEPS_MIN || steps.length > STEPS_MAX) {
    issues.push({ field: 'steps', code: 'OUT_OF_RANGE' });
  }

  let lastAudienceRank = -1;
  steps.forEach((step, index) => {
    const path = `steps[${index}]`;
    const previous = index > 0 ? steps[index - 1] : undefined;

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

    const opensOn = readDate(step.opensOn, `${path}.opensOn`, issues);
    if (opensOn !== undefined) {
      if (index === 0 && compareDates(opensOn, context.today) < 0) {
        issues.push({ field: `${path}.opensOn`, code: 'BEFORE_TODAY' });
      }
      const previousClose = previous && validDate(previous.closesOn);
      if (previousClose && compareDates(opensOn, previousClose) <= 0) {
        issues.push({
          field: `${path}.opensOn`,
          code: 'OVERLAPS_PREVIOUS_STEP',
        });
      }
    }

    const closesOn = readDate(step.closesOn, `${path}.closesOn`, issues);
    if (
      opensOn !== undefined &&
      closesOn !== undefined &&
      compareDates(closesOn, opensOn) < 0
    ) {
      issues.push({ field: `${path}.closesOn`, code: 'CLOSES_BEFORE_OPENS' });
    }

    if (index === 0 && !step.requiresLoad) {
      issues.push({ field: `${path}.requiresLoad`, code: 'FIRST_STEP_LOAD' });
    }

    const roundOk = previous
      ? step.round === previous.round || step.round === previous.round + 1
      : step.round === 1;
    if (!roundOk) {
      issues.push({ field: `${path}.round`, code: 'ROUND_SEQUENCE' });
    }
  });

  return issues;
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
 * checked against the catalog only when the list is the scope.
 */
function checkScope<T>(
  all: boolean,
  list: readonly T[] | null | undefined,
  field: string,
  known: ReadonlySet<T>,
  issues: FieldIssue[],
): void {
  const items = list ?? [];
  if (all) {
    if (items.length > 0) issues.push({ field, code: 'INVALID' });
  } else if (items.length === 0) {
    issues.push({ field, code: 'REQUIRED' });
  } else if (!items.every((item) => known.has(item))) {
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
