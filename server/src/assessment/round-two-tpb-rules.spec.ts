// @akili-spec escalation/round-2-tpb
import { describe, expect, it } from 'vitest';
import {
  commentStates,
  type CommentState,
} from '../database/drizzle/schema/assessment-comments.js';
import { RoleCode } from '../users/permissions.js';
import {
  endRoundTwoOnFinish,
  isTpbDecidable,
  TPB_CHOICES,
  tpbFieldGreen,
  tpbUndecidedFields,
  type TpbItem,
} from './round-two-rules.js';

// Expected values are literals from P2-3916 AC3, AC7, AC9-AC11 (FR-3, FR-6,
// FR-8): only escalated comments are decided; a field turns green once every
// escalated item on it sides with the program; Finish needs every item decided.

const core = { visibility: 'assessed', isCore: true };

describe('isTpbDecidable (FR-3)', () => {
  it('offers both TPB choices on a live escalated comment of a core field', () => {
    expect(
      isTpbDecidable({ state: 'escalated', deleted: false }, core, RoleCode.TPB),
    ).toEqual(['tpb_agree_program', 'tpb_agree_assessor']);
  });

  it.each(commentStates.filter((s) => s !== 'escalated'))(
    'offers nothing on a %s comment',
    (state) => {
      expect(
        isTpbDecidable(
          { state: state as CommentState, deleted: false },
          core,
          RoleCode.TPB,
        ),
      ).toEqual([]);
    },
  );

  it('offers nothing on a deleted comment, a non-core field, or to another role', () => {
    expect(
      isTpbDecidable({ state: 'escalated', deleted: true }, core, RoleCode.TPB),
    ).toEqual([]);
    expect(
      isTpbDecidable(
        { state: 'escalated', deleted: false },
        { visibility: 'assessed', isCore: false },
        RoleCode.TPB,
      ),
    ).toEqual([]);
    expect(
      isTpbDecidable(
        { state: 'escalated', deleted: false },
        core,
        RoleCode.LEAD_ASSESSOR,
      ),
    ).toEqual([]);
    expect(
      isTpbDecidable({ state: 'escalated', deleted: false }, core, null),
    ).toEqual([]);
  });

  it('declares the two values in the decision order', () => {
    expect(TPB_CHOICES).toEqual(['tpb_agree_program', 'tpb_agree_assessor']);
  });
});

const item = (
  commentId: number,
  fieldKey: string,
  decision: string | null,
): TpbItem => ({ commentId, fieldKey, decision });

describe('tpbFieldGreen (FR-6, DD-T8)', () => {
  it.each<[string, TpbItem[], boolean | null]>([
    ['no escalated item', [], null],
    ['one item with the program', [item(1, 'f', 'tpb_agree_program')], true],
    ['one item with the assessor', [item(1, 'f', 'tpb_agree_assessor')], false],
    ['one item undecided', [item(1, 'f', null)], false],
    [
      'two items with the program',
      [item(1, 'f', 'tpb_agree_program'), item(2, 'f', 'tpb_agree_program')],
      true,
    ],
    [
      'one with the program, one undecided',
      [item(1, 'f', 'tpb_agree_program'), item(2, 'f', null)],
      false,
    ],
    [
      'one with the program, one with the assessor',
      [item(1, 'f', 'tpb_agree_program'), item(2, 'f', 'tpb_agree_assessor')],
      false,
    ],
  ])('%s', (_name, items, expected) => {
    expect(tpbFieldGreen(items)).toBe(expected);
  });
});

describe('tpbUndecidedFields (FR-8)', () => {
  it('names each field with an undecided item once, sorted', () => {
    expect(
      tpbUndecidedFields([
        item(1, 'z.field', null),
        item(2, 'a.field', 'tpb_agree_program'),
        item(3, 'm.field', null),
        item(4, 'z.field', null),
      ]),
    ).toEqual(['m.field', 'z.field']);
  });

  it('is empty when every item is decided', () => {
    expect(
      tpbUndecidedFields([
        item(1, 'a', 'tpb_agree_program'),
        item(2, 'b', 'tpb_agree_assessor'),
      ]),
    ).toEqual([]);
  });
});

describe('the TPB end through endRoundTwoOnFinish (FR-8, design § 6)', () => {
  it('all green: Quality Assessed', () => {
    expect(
      endRoundTwoOnFinish([
        { key: 'a', effectiveGreen: true, escalated: false },
        { key: 'b', effectiveGreen: true, escalated: false },
      ]),
    ).toBe('quality_assessed');
  });

  it('a grey field with an assessor decision: escalated (Pending PPU)', () => {
    expect(
      endRoundTwoOnFinish([
        { key: 'a', effectiveGreen: true, escalated: false },
        { key: 'b', effectiveGreen: false, escalated: true },
      ]),
    ).toBe('escalated');
  });
});
