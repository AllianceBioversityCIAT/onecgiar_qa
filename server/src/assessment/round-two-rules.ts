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
 * takes `escalate` only while it is `open` (none once withdrawn or moved by the end); anything else, none. The field must be actionable.
 */
export function isDecidable(
  comment: DecidableComment,
  field: ConfiguredField,
  role: string | null,
): readonly DecisionChoice[] {
  if (role !== RoleCode.LEAD_ASSESSOR) return [];
  if (comment.deleted || !isActionable(field)) return [];
  if (comment.origin === 'lead_round_two') {
    // `open` only: the end moves a decided own comment to `escalated`, and a withdrawn one has left.
    return comment.state === 'open' ? ['escalate'] : [];
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

// ---- Step 4: the Third-Party Broker (escalation/round-2-tpb) ----------------

export type TpbChoice = 'tpb_agree_program' | 'tpb_agree_assessor';

/** The two TPB decisions (P2-3916 AC5), in the order the front offers them. */
export const TPB_CHOICES: readonly TpbChoice[] = [
  'tpb_agree_program',
  'tpb_agree_assessor',
];

/**
 * FR-3: what a TPB may decide on a comment; empty = not decidable. Only an
 * `escalated` comment (a round-1 one or the Lead's own) that is not deleted,
 * on an actionable (core) field, takes the two TPB choices.
 */
export function isTpbDecidable(
  comment: { state: CommentState; deleted: boolean },
  field: ConfiguredField,
  role: string | null,
): readonly TpbChoice[] {
  if (role !== RoleCode.TPB) return [];
  if (comment.deleted || !isActionable(field)) return [];
  return comment.state === 'escalated' ? TPB_CHOICES : [];
}

/** One live escalated comment of a field, with the TPB's decision on it (`null` = none). */
export interface TpbItem {
  commentId: number;
  fieldKey: string;
  decision: string | null;
}

/**
 * FR-6, DD-T8: the step-4 green of a field from its escalated items. Green
 * when every item sides with the program; grey when one is undecided or sides
 * with the assessor. `null` when the field has no escalated item: the TPB
 * has nothing to say on it and its green is the step-3 one.
 */
export function tpbFieldGreen(items: readonly TpbItem[]): boolean | null {
  if (items.length === 0) return null;
  return items.every((item) => item.decision === 'tpb_agree_program');
}

/** FR-8: the fields with an escalated item the TPB has not decided, sorted; empty = Finish may run. */
export function tpbUndecidedFields(items: readonly TpbItem[]): string[] {
  return [
    ...new Set(
      items.filter((item) => item.decision === null).map((i) => i.fieldKey),
    ),
  ].sort();
}

// ---- Step 5: the PPU (escalation/round-2-ppu) --------------------------------

export type PpuChoice = 'ppu_done';

/** The one PPU decision (P2-3917 AC4). */
export const PPU_CHOICES: readonly PpuChoice[] = ['ppu_done'];

/**
 * FR-3: what a PPU may decide on a comment; empty = not decidable. Only a
 * case (`tpb_sided_assessor`: the TPB sided with the assessor) that is not
 * deleted, on an actionable (core) field, takes `ppu_done`.
 */
export function isPpuDecidable(
  comment: { state: CommentState; deleted: boolean },
  field: ConfiguredField,
  role: string | null,
): readonly PpuChoice[] {
  if (role !== RoleCode.PPU) return [];
  if (comment.deleted || !isActionable(field)) return [];
  return comment.state === 'tpb_sided_assessor' ? PPU_CHOICES : [];
}

/** One live PPU case of a field, with the PPU's decision on it (`null` = not Done). */
export interface PpuCase {
  commentId: number;
  fieldKey: string;
  decision: string | null;
}

/**
 * FR-6: the step-5 green of a field from its cases: green once every case on
 * it is Done. `null` when the field has no case: its green is the step-4 one.
 */
export function ppuFieldGreen(cases: readonly PpuCase[]): boolean | null {
  if (cases.length === 0) return null;
  return cases.every((item) => item.decision === 'ppu_done');
}

/** FR-6: the cases not Done yet; empty = no PPU case is pending. */
export function ppuOpenCases(cases: readonly PpuCase[]): PpuCase[] {
  return cases.filter((item) => item.decision !== 'ppu_done');
}

/**
 * FR-6 (AC7): the result ends Quality Assessed when no case is open and every
 * core field is effectively green. Never by itself: only after a Done.
 */
export function ppuEnds(
  cases: readonly PpuCase[],
  coreGreens: readonly boolean[],
): boolean {
  return ppuOpenCases(cases).length === 0 && coreGreens.every(Boolean);
}
