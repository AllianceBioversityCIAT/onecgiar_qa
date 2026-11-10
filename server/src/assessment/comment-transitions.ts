// @akili-spec assessment/step-1-assessment
import type { CommentState } from '../database/drizzle/schema/assessment-comments.js';

// The comment thread state machine (TRD 7.3, design 7.7, ADR-006, FR-19, DD-10).
// Every state is declared in the schema; this table says which moves exist and
// which of them a route of this spec may write. P2-3911 flips `reachable`, it
// adds no schema.

/** `author` = the user who wrote the comment; `program` = a Science Program user. */
export type TransitionActor = 'author' | 'program';

export interface CommentTransition {
  /** `null` = the comment does not exist yet. */
  readonly from: CommentState | null;
  readonly to: CommentState;
  readonly by: TransitionActor;
  /** Written by a route of step-1-assessment (`false`: declared for P2-3911). */
  readonly reachable: boolean;
}

export const COMMENT_TRANSITIONS: readonly CommentTransition[] = [
  { from: null, to: 'open', by: 'author', reachable: true },
  { from: 'open', to: 'withdrawn', by: 'author', reachable: true },
  {
    from: 'open',
    to: 'clarification_requested',
    by: 'program',
    reachable: false,
  },
  {
    from: 'clarification_requested',
    to: 'open',
    by: 'author',
    reachable: false,
  },
  { from: 'open', to: 'accepted', by: 'program', reachable: false },
  {
    from: 'open',
    to: 'accepted_with_comment',
    by: 'program',
    reachable: false,
  },
  { from: 'open', to: 'disagreed', by: 'program', reachable: false },
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
