// @akili-spec assessment/step-1-assessment
import { describe, expect, it } from 'vitest';
import { commentStates } from '../database/drizzle/schema/assessment-comments.js';
import {
  COMMENT_TRANSITIONS,
  findTransition,
  isTransitionAllowed,
  type TransitionActor,
} from './comment-transitions.js';
import type { CommentState } from '../database/drizzle/schema/assessment-comments.js';

// Expected values are literals from design 7.7's table (TRD 7.3, ADR-006) and
// FR-19: this spec writes `open` and `withdrawn`; the rest is declared only.

type Move = [CommentState | null, CommentState, TransitionActor];

describe('comment transitions (FR-19, design 7.7)', () => {
  it.each<Move>([
    [null, 'open', 'author'],
    ['open', 'withdrawn', 'author'],
  ])('allows %s -> %s by %s', (from, to, by) => {
    expect(isTransitionAllowed(from, to, by)).toBe(true);
  });

  it.each<Move>([
    ['open', 'clarification_requested', 'program'],
    ['clarification_requested', 'open', 'author'],
    ['open', 'accepted', 'program'],
    ['open', 'accepted_with_comment', 'program'],
    ['open', 'disagreed', 'program'],
  ])(
    'declares %s -> %s by %s, but no route of this spec writes it',
    (from, to, by) => {
      expect(findTransition(from, to, by)).toBeDefined();
      expect(isTransitionAllowed(from, to, by)).toBe(false);
    },
  );

  it.each<Move>([
    ['open', 'withdrawn', 'program'],
    [null, 'open', 'program'],
    ['withdrawn', 'open', 'author'],
    ['withdrawn', 'withdrawn', 'author'],
    ['clarification_requested', 'withdrawn', 'author'],
    ['accepted', 'open', 'author'],
    ['open', 'accepted', 'author'],
    ['open', 'open', 'author'],
    [null, 'withdrawn', 'author'],
    ['open', 'escalated', 'program'],
  ])('refuses %s -> %s by %s', (from, to, by) => {
    expect(findTransition(from, to, by)).toBeUndefined();
    expect(isTransitionAllowed(from, to, by)).toBe(false);
  });

  it('only ever names states the schema declares (DD-10)', () => {
    for (const row of COMMENT_TRANSITIONS) {
      expect(commentStates).toContain(row.to);
      if (row.from !== null) expect(commentStates).toContain(row.from);
    }
  });

  it('has exactly two moves reachable in this spec', () => {
    expect(
      COMMENT_TRANSITIONS.filter((row) => row.reachable).map(
        (row) => `${row.from}->${row.to}`,
      ),
    ).toEqual(['null->open', 'open->withdrawn']);
  });
});
