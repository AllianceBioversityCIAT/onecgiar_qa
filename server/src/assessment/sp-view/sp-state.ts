// DD-11 (escalation/round-2): the state the program reads for a comment. Pure.
import type { CommentState } from '../../database/drizzle/schema/assessment-comments.js';
import type { SpResponseKind } from '../../database/drizzle/schema/sp-comment-responses.js';

/** The comment state each response kind sets. */
export const STATE_OF_KIND: Readonly<Record<SpResponseKind, CommentState>> = {
  accept: 'accepted',
  accept_with_comment: 'accepted_with_comment',
  disagree: 'disagreed',
  request_clarification: 'clarification_requested',
};

/** Stored states that record a review outcome (Lead, TPB, PPU) the program never sees (DD-11). */
export const REVIEW_STATES: readonly CommentState[] = [
  'escalated',
  'lead_sided_program',
  'tpb_sided_program',
  'tpb_sided_assessor',
  'done',
];

/**
 * DD-11: the state the program reads. A review state shows the state its
 * latest response implies (`open` with none); every other state is its own.
 */
export function programSideState(
  state: CommentState,
  latestKind: SpResponseKind | null,
  /** The latest response is a clarification request the assessor already answered (the program last saw `open`). */
  latestAnswered = false,
): CommentState {
  if (!REVIEW_STATES.includes(state)) return state;
  if (latestKind === 'request_clarification' && latestAnswered) return 'open';
  return latestKind === null ? 'open' : STATE_OF_KIND[latestKind];
}
