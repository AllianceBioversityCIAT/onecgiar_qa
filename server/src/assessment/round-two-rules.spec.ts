// @akili-spec escalation/round-2
import { describe, expect, it } from 'vitest';
import { commentStates } from '../database/drizzle/schema/assessment-comments.js';
import {
  effectiveGreen,
  isActionable,
  isCarriedGreen,
  isDecidable,
  type DecidableComment,
  type DecisionChoice,
  type RoundOneFacts,
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
    ['all core fields green', [green('F1'), green('F2')], 'quality_assessed'],
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
    [
      'a grey core field stays open',
      [green('F1'), greyUndecided('F2')],
      'none',
    ],
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

describe('isActionable (FR-3, design 7)', () => {
  it.each([
    ['assessed', true, true],
    ['assessed', false, false],
    ['view_only', true, false],
    ['view_only', false, false],
    ['hidden', true, false],
  ])('%s with isCore=%s is actionable=%s', (visibility, isCore, expected) => {
    expect(isActionable({ visibility, isCore })).toBe(expected);
  });
});

// FR-7 and DD-4, literals from the spec: the stored row wins; with none, a
// field is green only when it was green in round 1, carries no round-1 comment
// and is not in `changed_fields`.
describe('effectiveGreen and isCarriedGreen (FR-7, DD-4)', () => {
  const facts = (over: Partial<RoundOneFacts> = {}): RoundOneFacts => ({
    green: true,
    commented: false,
    changed: false,
    ...over,
  });

  it.each<
    [string, boolean | undefined, Partial<RoundOneFacts>, boolean, boolean]
  >([
    // [name, stored, round-1 facts, effective green, carried]
    ['carried green: green, uncommented, unchanged', undefined, {}, true, true],
    [
      'a changed field is not carried (FR-7 BUT)',
      undefined,
      { changed: true },
      false,
      false,
    ],
    [
      'a round-1 comment blocks the carry',
      undefined,
      { commented: true },
      false,
      false,
    ],
    [
      'grey in round 1 is not carried',
      undefined,
      { green: false },
      false,
      false,
    ],
    [
      'the Lead un-greened it: the stored false wins over the carry',
      false,
      {},
      false,
      false,
    ],
    [
      'the Lead greened a changed field (FR-7 Accepted and corrected)',
      true,
      { changed: true, green: false },
      true,
      false,
    ],
    [
      'stored green on a carry-eligible field is the Lead own mark, not carried',
      true,
      {},
      true,
      false,
    ],
  ])('%s', (_name, stored, over, green, carried) => {
    expect(effectiveGreen(stored, facts(over))).toBe(green);
    expect(isCarriedGreen(stored, facts(over))).toBe(carried);
  });
});

// Design 7, `isDecidable` row. The table walks every comment state for a
// round-1 comment so a state added later has to be chosen here.
describe('isDecidable (FR-4, FR-8, design 7)', () => {
  const core = { visibility: 'assessed', isCore: true };
  const comment = (over: Partial<DecidableComment> = {}): DecidableComment => ({
    origin: 'round_one',
    state: 'disagreed',
    deleted: false,
    ...over,
  });
  const both: DecisionChoice[] = ['agree_program', 'escalate'];
  const LEAD = 'LEAD_ASSESSOR';

  it.each(
    commentStates.map((state) => [
      state,
      ['disagreed', 'open', 'clarification_requested'].includes(state)
        ? both
        : [],
    ]) as Array<[string, DecisionChoice[]]>,
  )('a round-1 comment in state %s gives %j to the Lead', (state, expected) => {
    expect(isDecidable(comment({ state: state as never }), core, LEAD)).toEqual(
      expected,
    );
  });

  it('a deleted round-1 comment gives none', () => {
    expect(isDecidable(comment({ deleted: true }), core, LEAD)).toEqual([]);
  });

  it('a field that is not actionable gives none', () => {
    expect(
      isDecidable(comment(), { visibility: 'assessed', isCore: false }, LEAD),
    ).toEqual([]);
    expect(
      isDecidable(comment(), { visibility: 'view_only', isCore: true }, LEAD),
    ).toEqual([]);
  });

  it.each([['ASSESSOR'], ['TPB'], ['PPU'], ['ADMIN'], [null]])(
    'a caller that is not the Lead (%s) gets none',
    (role) => {
      expect(isDecidable(comment(), core, role)).toEqual([]);
    },
  );

  it.each<[string, Partial<DecidableComment>, DecisionChoice[]]>([
    ['own open comment', { state: 'open' }, ['escalate']],
    ['own withdrawn comment', { state: 'withdrawn' }, []],
    ['own deleted comment', { state: 'open', deleted: true }, []],
  ])('the Lead own round-2 comment: %s', (_name, over, expected) => {
    expect(
      isDecidable(comment({ origin: 'lead_round_two', ...over }), core, LEAD),
    ).toEqual(expected);
  });
});
