// @akili-spec escalation/round-2

// The round-2 end rules (design 7, DD-5, FR-11, FR-12, FR-13): a thin mapping
// over the round-1 end rule in `assessment-rules.ts`, which stays unchanged.
// Pure; the inputs are core-field facts only, so a non-core comment can never
// change the outcome.
import type { CommentState } from '../database/drizzle/schema/assessment-comments.js';
import { RoleCode } from '../users/permissions.js';
import {
  endAfterValidation,
  endOnFinish,
  type CoreFieldState,
} from './assessment-rules.js';

/** The two facts of a configured field that `isActionable` reads. */
export interface ConfiguredField {
  visibility: string;
  isCore: boolean;
}

/** FR-3: only an Assessed core field of the pinned version accepts a round-2 write; every other field is context. */
export function isActionable(field: ConfiguredField): boolean {
  return field.visibility === 'assessed' && field.isCore;
}

/** One core field of a round-2 assessment, as the end rule sees it. */
export interface RoundTwoCoreFact {
  key: string;
  /** Effectively green: stored validation, or carried green from round 1. */
  effectiveGreen: boolean;
  /** Carries an `escalate` Lead decision (on a round-1 comment or the Lead's own). */
  escalated: boolean;
}

/** FR-11: a grey core field without an `escalate` decision blocks Finish. */
export interface CoreUndecided {
  error: 'core_undecided';
  fieldKeys: readonly string[];
}

export type RoundTwoFinishOutcome =
  'quality_assessed' | 'escalated' | CoreUndecided;

export type RoundTwoWriteOutcome = 'quality_assessed' | 'none';

function toCoreStates(core: readonly RoundTwoCoreFact[]): CoreFieldState[] {
  return core.map((field) => ({
    key: field.key,
    validated: field.effectiveGreen,
    commented: field.escalated,
  }));
}

/** On Finish (FR-11, FR-12, FR-13): never `returned`; the round-1 `returned` is `escalated`. */
export function endRoundTwoOnFinish(
  core: readonly RoundTwoCoreFact[],
): RoundTwoFinishOutcome {
  const outcome = endOnFinish(toCoreStates(core));
  if (outcome === 'returned') return 'escalated';
  if (typeof outcome === 'object') {
    return { error: 'core_undecided', fieldKeys: outcome.fieldKeys };
  }
  return outcome;
}

/** After a write (FR-12): round > 1, so comments are not read. */
export function endRoundTwoAfterWrite(
  core: readonly RoundTwoCoreFact[],
): RoundTwoWriteOutcome {
  return endAfterValidation(toCoreStates(core));
}

/** The round-1 facts about one core field that decide a carried green (FR-7, DD-4). */
export interface RoundOneFacts {
  /** The previous membership's step-1 validation of the field is green. */
  green: boolean;
  /** A round-1 comment (not withdrawn, not deleted) is on the field. */
  commented: boolean;
  /** The field's key is in the membership's `changed_fields`. */
  changed: boolean;
}

/**
 * FR-7, DD-4: the stored validation wins; with none, a field starts green when
 * it was green in round 1, carries no round-1 comment and did not change.
 * Computed on read, never copied (no write on read).
 */
export function effectiveGreen(
  stored: boolean | undefined,
  roundOne: RoundOneFacts,
): boolean {
  return stored ?? (roundOne.green && !roundOne.commented && !roundOne.changed);
}

/** The green was carried: nothing is stored and the round-1 facts made it green. */
export function isCarriedGreen(
  stored: boolean | undefined,
  roundOne: RoundOneFacts,
): boolean {
  return stored === undefined && effectiveGreen(stored, roundOne);
}

export type DecisionChoice = 'agree_program' | 'escalate';

/** The comment a Lead may decide on: a round-1 comment, or the Lead's own round-2 one. */
export interface DecidableComment {
  origin: 'round_one' | 'lead_round_two';
  state: CommentState;
  /** `deleted_at` is set (FR-10). */
  deleted: boolean;
}

const ROUND_ONE_DECIDABLE_STATES: readonly CommentState[] = [
  'disagreed',
  'open',
  'clarification_requested',
];

/**
 * Design 7: what the caller may decide on a comment; empty = not decidable.
 * Only a Lead decides. A round-1 comment in `disagreed`, `open` or
 * `clarification_requested` takes both choices; the Lead's own round-2 comment
 * takes `escalate` only; anything else, none. The field must be actionable.
 */
export function isDecidable(
  comment: DecidableComment,
  field: ConfiguredField,
  role: string | null,
): readonly DecisionChoice[] {
  if (role !== RoleCode.LEAD_ASSESSOR) return [];
  if (comment.deleted || !isActionable(field)) return [];
  if (comment.origin === 'lead_round_two') {
    return comment.state === 'withdrawn' ? [] : ['escalate'];
  }
  return ROUND_ONE_DECIDABLE_STATES.includes(comment.state)
    ? ['agree_program', 'escalate']
    : [];
}

/**
 * FR-8 (HITL O-1): the core fields among `fieldKeys` that carry a live round-1
 * comment the Lead may decide (`disagreed`, `open`, `clarification_requested`)
 * with no live decision yet. `comments` are the live (not withdrawn, not
 * deleted) comments of the round-1 assessment; `decidedCommentIds` those with a
 * decision. Sorted ascending; empty = nothing blocks.
 */
export function undecidedCommentFields(
  comments: readonly { id: number; fieldKey: string; state: CommentState }[],
  decidedCommentIds: ReadonlySet<number>,
  fieldKeys: ReadonlySet<string>,
): string[] {
  const core: ConfiguredField = { visibility: 'assessed', isCore: true };
  const blocked = new Set<string>();
  for (const comment of comments) {
    if (!fieldKeys.has(comment.fieldKey)) continue;
    if (decidedCommentIds.has(comment.id)) continue;
    const choices = isDecidable(
      { origin: 'round_one', state: comment.state, deleted: false },
      core,
      RoleCode.LEAD_ASSESSOR,
    );
    if (choices.length > 0) blocked.add(comment.fieldKey);
  }
  return [...blocked].sort();
}
