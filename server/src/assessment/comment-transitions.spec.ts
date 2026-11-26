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

const LEAD_FROM: CommentState[] = [
  'disagreed',
  'open',
  'clarification_requested',
];

describe('comment transitions (FR-19, design 7.7, P2-3911)', () => {
  it.each<Move>([
    [null, 'open', 'author'],
    ['open', 'withdrawn', 'author'],
    ['clarification_requested', 'open', 'author'],
    ...FROM.flatMap((from) => TO.map((to): Move => [from, to, 'program'])),
    // Round 2 (design 4, DD-6): the Lead's agree closes a comment when the review ends.
    ...LEAD_FROM.map((from): Move => [from, 'lead_sided_program', 'lead']),
    // Round 2 (T-9): the Lead's escalate moves the comment when the review ends `escalated`.
    ...LEAD_FROM.map((from): Move => [from, 'escalated', 'lead']),
    // Round 2, step 4 (P2-3916): the TPB's decisions move an escalated comment when its review ends.
    ['escalated', 'tpb_sided_program', 'tpb'],
    ['escalated', 'tpb_sided_assessor', 'tpb'],
    // Round 2, step 5 (P2-3917): the PPU's Done closes the case when the result ends.
    ['tpb_sided_assessor', 'done', 'ppu'],
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
    // The Lead closes only a comment it can decide; and it is the only one to write this state.
    ['accepted', 'lead_sided_program', 'lead'],
    ['accepted_with_comment', 'lead_sided_program', 'lead'],
    ['withdrawn', 'lead_sided_program', 'lead'],
    ['escalated', 'lead_sided_program', 'lead'],
    ['lead_sided_program', 'lead_sided_program', 'lead'],
    [null, 'lead_sided_program', 'lead'],
    ['disagreed', 'lead_sided_program', 'program'],
    ['disagreed', 'lead_sided_program', 'author'],
    ['disagreed', 'accepted', 'lead'],
    ['disagreed', 'open', 'lead'],
    // The Lead escalates only a comment it can decide.
    ['accepted', 'escalated', 'lead'],
    ['accepted_with_comment', 'escalated', 'lead'],
    ['withdrawn', 'escalated', 'lead'],
    ['escalated', 'escalated', 'lead'],
    [null, 'escalated', 'lead'],
    ['disagreed', 'escalated', 'author'],
    // The TPB decides escalated comments only, and only it writes its states.
    ['disagreed', 'tpb_sided_program', 'tpb'],
    ['lead_sided_program', 'tpb_sided_assessor', 'tpb'],
    ['open', 'tpb_sided_assessor', 'tpb'],
    ['escalated', 'tpb_sided_program', 'lead'],
    ['escalated', 'tpb_sided_assessor', 'program'],
    ['escalated', 'lead_sided_program', 'tpb'],
    // Only a PPU case closes, and only the PPU closes it.
    ['tpb_sided_program', 'done', 'ppu'],
    ['escalated', 'done', 'ppu'],
    ['tpb_sided_assessor', 'done', 'tpb'],
    ['tpb_sided_assessor', 'done', 'program'],
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

  it('has exactly the 32 reachable moves: 3 by the author, 20 by the program, 6 by the Lead, 2 by the TPB, 1 by the PPU', () => {
    const reachable = COMMENT_TRANSITIONS.filter((row) => row.reachable);
    expect(reachable).toHaveLength(32);
    expect(
      reachable
        .filter((row) => row.by === 'ppu')
        .map((row) => `${row.from}->${row.to}`),
    ).toEqual(['tpb_sided_assessor->done']);
    expect(
      reachable
        .filter((row) => row.by === 'tpb')
        .map((row) => `${row.from}->${row.to}`),
    ).toEqual(['escalated->tpb_sided_program', 'escalated->tpb_sided_assessor']);
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
    expect(
      reachable
        .filter((row) => row.by === 'lead')
        .map((row) => `${row.from}->${row.to}`),
    ).toEqual([
      'disagreed->lead_sided_program',
      'open->lead_sided_program',
      'clarification_requested->lead_sided_program',
      'disagreed->escalated',
      'open->escalated',
      'clarification_requested->escalated',
    ]);
  });

  it('declares the Lead escalations (T-9) as reachable', () => {
    for (const from of LEAD_FROM) {
      expect(findTransition(from, 'escalated', 'lead')?.reachable).toBe(true);
      expect(isTransitionAllowed(from, 'escalated', 'lead')).toBe(true);
    }
  });
});
