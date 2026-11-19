// @akili-spec escalation/round-2

// The round-2 end rules (design 7, DD-5, FR-11, FR-12, FR-13): a thin mapping
// over the round-1 end rule in `assessment-rules.ts`, which stays unchanged.
// Pure; the inputs are core-field facts only, so a non-core comment can never
// change the outcome.
import {
  endAfterValidation,
  endOnFinish,
  type CoreFieldState,
} from './assessment-rules.js';

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

function toCoreStates(
  core: readonly RoundTwoCoreFact[],
): CoreFieldState[] {
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
