// @akili-spec escalation/round-2
import { describe, expect, it } from 'vitest';
import {
  endRoundTwoAfterWrite,
  endRoundTwoOnFinish,
  type RoundTwoCoreFact,
  type RoundTwoFinishOutcome,
  type RoundTwoWriteOutcome,
} from './round-two-rules.js';

// Expected values are literals from FR-11 (*Escalated*, *Undecided*), FR-12 and
// FR-13 (*Regression*). The functions take core facts only: there is no input
// for a non-core field or comment, so none can change an outcome.

const green = (key: string): RoundTwoCoreFact => ({
  key,
  effectiveGreen: true,
  escalated: false,
});
const greyEscalated = (key: string): RoundTwoCoreFact => ({
  key,
  effectiveGreen: false,
  escalated: true,
});
const greyUndecided = (key: string): RoundTwoCoreFact => ({
  key,
  effectiveGreen: false,
  escalated: false,
});

describe('endRoundTwoOnFinish (FR-11, FR-12, FR-13)', () => {
  it.each<[string, RoundTwoCoreFact[], RoundTwoFinishOutcome]>([
    [
      'all core fields green',
      [green('F1'), green('F2')],
      'quality_assessed',
    ],
    [
      'grey F2 with an escalate decision (FR-11 Escalated)',
      [green('F1'), greyEscalated('F2')],
      'escalated',
    ],
    [
      'grey F2 without an escalate decision (FR-11 Undecided, FR-13 Regression)',
      [green('F1'), greyUndecided('F2')],
      { error: 'core_undecided', fieldKeys: ['F2'] },
    ],
    [
      'every undecided key is named, in the order given',
      [greyUndecided('F3'), greyEscalated('F2'), greyUndecided('F1')],
      { error: 'core_undecided', fieldKeys: ['F3', 'F1'] },
    ],
    ['no core field at all (FR-12)', [], 'quality_assessed'],
  ])('%s', (_name, core, expected) => {
    expect(endRoundTwoOnFinish(core)).toEqual(expected);
  });

  it('never returns `returned` (FR-13)', () => {
    const outcomes = [
      endRoundTwoOnFinish([greyEscalated('F1')]),
      endRoundTwoOnFinish([greyUndecided('F1')]),
      endRoundTwoOnFinish([green('F1')]),
      endRoundTwoOnFinish([]),
    ];
    expect(outcomes).not.toContain('returned');
  });
});

describe('endRoundTwoAfterWrite (FR-12)', () => {
  it.each<[string, RoundTwoCoreFact[], RoundTwoWriteOutcome]>([
    ['all core fields green', [green('F1'), green('F2')], 'quality_assessed'],
    ['a grey core field stays open', [green('F1'), greyUndecided('F2')], 'none'],
    [
      'a grey core field with an escalate decision stays open',
      [green('F1'), greyEscalated('F2')],
      'none',
    ],
    ['no core field never ends by itself', [], 'none'],
  ])('%s', (_name, core, expected) => {
    expect(endRoundTwoAfterWrite(core)).toBe(expected);
  });
});
