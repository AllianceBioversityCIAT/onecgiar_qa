// @akili-spec assessment/step-1-assessment
import type { CommentState } from '../database/drizzle/schema/assessment-comments.js';

// The comment thread state machine (TRD 7.3, design 7.7, ADR-006, FR-19, DD-10).
// Every state is declared in the schema; this table says which moves exist and
// which of them a route may write. P2-3911 made the program responses and the
// clarification answer reachable; it added no comment state.

/** `author` = the user who wrote the comment; `program` = a Science Program user; `lead` = a Lead Assessor (round 2); `tpb` = a Third-Party Broker (round 2, step 4); `ppu` = the PPU (round 2, step 5). */
export type TransitionActor = 'author' | 'program' | 'lead' | 'tpb' | 'ppu';

export interface CommentTransition {
  /** `null` = the comment does not exist yet. */
  readonly from: CommentState | null;
  readonly to: CommentState;
  readonly by: TransitionActor;
  /** Written by a route of step-1-assessment (`false`: declared for P2-3911). */
  readonly reachable: boolean;
}

/**
 * P2-3911: the states a Science Program response may start from, and the
 * states it may set. A response can be changed while the programs step is
 * open: the latest counts, the earlier ones stay as history, so every from
 * state is also a to state (or `open`).
 */
export const PROGRAM_FROM_STATES: readonly CommentState[] = [
  'open',
  'accepted',
  'accepted_with_comment',
  'disagreed',
  'clarification_requested',
];
export const PROGRAM_TO_STATES: readonly CommentState[] = [
  'accepted',
  'accepted_with_comment',
  'disagreed',
  'clarification_requested',
];

/** The states a Lead may decide a round-1 comment from (`isDecidable`, design 7). */
export const LEAD_FROM_STATES: readonly CommentState[] = [
  'disagreed',
  'open',
  'clarification_requested',
];

export const COMMENT_TRANSITIONS: readonly CommentTransition[] = [
  { from: null, to: 'open', by: 'author', reachable: true },
  { from: 'open', to: 'withdrawn', by: 'author', reachable: true },
  // P2-3911: the author answers the clarification the program requested.
  {
    from: 'clarification_requested',
    to: 'open',
    by: 'author',
    reachable: true,
  },
  // P2-3911: every program response, from every state a response may start from.
  ...PROGRAM_FROM_STATES.flatMap((from) =>
    PROGRAM_TO_STATES.map((to): CommentTransition => ({
      from,
      to,
      by: 'program',
      reachable: true,
    })),
  ),
  // Round 2 (escalation/round-2 design 4, DD-6, DD-7): written when the Lead's
  // review ends, from the states a Lead can decide. `lead_sided_program` closes
  // the comment (the Lead agreed with the program).
  ...LEAD_FROM_STATES.map((from): CommentTransition => ({
    from,
    to: 'lead_sided_program',
    by: 'lead',
    reachable: true,
  })),
  // Round 2, the `escalated` end (T-9): written when the Lead's review ends with an `escalate` decision on the comment.
  ...LEAD_FROM_STATES.map((from): CommentTransition => ({
    from,
    to: 'escalated',
    by: 'lead',
    reachable: true,
  })),
  // Round 2, step 4 (escalation/round-2-tpb, DD-7): written when the TPB's
  // review ends, from `escalated` only. `tpb_sided_assessor` is the PPU case.
  { from: 'escalated', to: 'tpb_sided_program', by: 'tpb', reachable: true },
  { from: 'escalated', to: 'tpb_sided_assessor', by: 'tpb', reachable: true },
  // Round 2, step 5 (escalation/round-2-ppu, DD-7): the PPU's Done closes the case when the result ends.
  { from: 'tpb_sided_assessor', to: 'done', by: 'ppu', reachable: true },
];

/** The declared transition, reachable or not; `undefined` when the table has none. */
export function findTransition(
  from: CommentState | null,
  to: CommentState,
  by: TransitionActor,
): CommentTransition | undefined {
  return COMMENT_TRANSITIONS.find(
    (row) => row.from === from && row.to === to && row.by === by,
  );
}

/** May a route of this spec write this move? Declared and reachable. */
export function isTransitionAllowed(
  from: CommentState | null,
  to: CommentState,
  by: TransitionActor,
): boolean {
  return findTransition(from, to, by)?.reachable === true;
}
