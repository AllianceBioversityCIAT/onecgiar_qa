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

// Expected values are literals from design 7.7's table (TRD 7.3, ADR-006),
// FR-19 and P2-3911: the author writes `open`, `withdrawn` and answers a
// clarification (back to `open`); the program responds from open or from any
// earlier response.

type Move = [CommentState | null, CommentState, TransitionActor];

const FROM: CommentState[] = [
  'open',
  'accepted',
  'accepted_with_comment',
  'disagreed',
  'clarification_requested',
];
const TO: CommentState[] = [
  'accepted',
  'accepted_with_comment',
  'disagreed',
  'clarification_requested',
];

describe('comment transitions (FR-19, design 7.7, P2-3911)', () => {
  it.each<Move>([
    [null, 'open', 'author'],
    ['open', 'withdrawn', 'author'],
    ['clarification_requested', 'open', 'author'],
    ...FROM.flatMap((from) => TO.map((to): Move => [from, to, 'program'])),
  ])('allows %s -> %s by %s', (from, to, by) => {
    expect(isTransitionAllowed(from, to, by)).toBe(true);
  });

  it.each<Move>([
    ['open', 'withdrawn', 'program'],
    [null, 'open', 'program'],
    ['withdrawn', 'open', 'author'],
    ['withdrawn', 'withdrawn', 'author'],
    ['clarification_requested', 'withdrawn', 'author'],
    ['accepted', 'open', 'author'],
    ['accepted', 'withdrawn', 'author'],
    ['open', 'accepted', 'author'],
    ['open', 'open', 'author'],
    [null, 'withdrawn', 'author'],
    ['open', 'escalated', 'program'],
    ['open', 'open', 'program'],
    ['withdrawn', 'accepted', 'program'],
    ['escalated', 'accepted', 'program'],
    ['done', 'disagreed', 'program'],
    ['accepted', 'open', 'program'],
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

  it('has exactly the 23 reachable moves: 3 by the author, 20 by the program', () => {
    const reachable = COMMENT_TRANSITIONS.filter((row) => row.reachable);
    expect(reachable).toHaveLength(23);
    expect(
      reachable
        .filter((row) => row.by === 'author')
        .map((row) => `${row.from}->${row.to}`),
    ).toEqual([
      'null->open',
      'open->withdrawn',
      'clarification_requested->open',
    ]);
    expect(reachable.filter((row) => row.by === 'program')).toHaveLength(20);
  });
});
