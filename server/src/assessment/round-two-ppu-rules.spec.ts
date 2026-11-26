// @akili-spec escalation/round-2-ppu
import { describe, expect, it } from 'vitest';
import {
  commentStates,
  type CommentState,
} from '../database/drizzle/schema/assessment-comments.js';
import { RoleCode } from '../users/permissions.js';
import {
  isPpuDecidable,
  PPU_CHOICES,
  ppuEnds,
  ppuFieldGreen,
  ppuOpenCases,
  type PpuCase,
} from './round-two-rules.js';

// Expected values are literals from P2-3917 AC4, AC5, AC7 (FR-3, FR-4, FR-6):
// only a case (`tpb_sided_assessor`) takes Done; a field turns green once every
// case on it is Done; the result ends when no case is open and the core is green.

const core = { visibility: 'assessed', isCore: true };
const item = (
  commentId: number,
  fieldKey: string,
  decision: string | null,
): PpuCase => ({ commentId, fieldKey, decision });

describe('isPpuDecidable (FR-3)', () => {
  it('offers ppu_done on a live case of a core field', () => {
    expect(
      isPpuDecidable(
        { state: 'tpb_sided_assessor', deleted: false },
        core,
        RoleCode.PPU,
      ),
    ).toEqual(['ppu_done']);
    expect(PPU_CHOICES).toEqual(['ppu_done']);
  });

  it.each(commentStates.filter((s) => s !== 'tpb_sided_assessor'))(
    'offers nothing on a %s comment',
    (state) => {
      expect(
        isPpuDecidable(
          { state: state as CommentState, deleted: false },
          core,
          RoleCode.PPU,
        ),
      ).toEqual([]);
    },
  );

  it('offers nothing on a deleted case, a non-core field or to another role', () => {
    const live = { state: 'tpb_sided_assessor' as const, deleted: false };
    expect(
      isPpuDecidable({ ...live, deleted: true }, core, RoleCode.PPU),
    ).toEqual([]);
    expect(
      isPpuDecidable(live, { visibility: 'assessed', isCore: false }, RoleCode.PPU),
    ).toEqual([]);
    expect(isPpuDecidable(live, core, RoleCode.TPB)).toEqual([]);
    expect(isPpuDecidable(live, core, null)).toEqual([]);
  });
});

describe('ppuFieldGreen (FR-6)', () => {
  it.each<[string, PpuCase[], boolean | null]>([
    ['no case', [], null],
    ['one case Done', [item(1, 'f', 'ppu_done')], true],
    ['one case open', [item(1, 'f', null)], false],
    ['two cases, one Done', [item(1, 'f', 'ppu_done'), item(2, 'f', null)], false],
    ['two cases Done', [item(1, 'f', 'ppu_done'), item(2, 'f', 'ppu_done')], true],
  ])('%s', (_name, cases, expected) => {
    expect(ppuFieldGreen(cases)).toBe(expected);
  });
});

describe('ppuOpenCases and ppuEnds (FR-6, AC7)', () => {
  const cases = [item(1, 'a', 'ppu_done'), item(2, 'b', null)];

  it('lists the cases not Done', () => {
    expect(ppuOpenCases(cases).map((c) => c.commentId)).toEqual([2]);
  });

  it('ends only when no case is open and every core field is green', () => {
    expect(ppuEnds(cases, [true, true])).toBe(false);
    expect(ppuEnds([item(1, 'a', 'ppu_done')], [true, false])).toBe(false);
    expect(ppuEnds([item(1, 'a', 'ppu_done')], [true, true])).toBe(true);
    expect(ppuEnds([], [true])).toBe(true);
  });
});
