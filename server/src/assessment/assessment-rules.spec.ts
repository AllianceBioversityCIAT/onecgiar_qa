// @akili-spec assessment/step-1-assessment
import { describe, expect, it } from 'vitest';
import {
  endAfterValidation,
  endOnFinish,
  type CoreFieldState,
} from './assessment-rules.js';

// Expected values are literals from FR-14 (*Last core goes green*) and FR-15
// (*Return*, OQ-2 and OQ-9 defaults).

const green = (key: string, commented = false): CoreFieldState => ({
  key,
  validated: true,
  commented,
});
const grey = (key: string, commented = false): CoreFieldState => ({
  key,
  validated: false,
  commented,
});

describe('endAfterValidation (FR-14)', () => {
  it.each<[string, CoreFieldState[], 'quality_assessed' | 'none']>([
    ['zero core fields never ends by itself (OQ-2 default)', [], 'none'],
    [
      'the last of 3 core fields goes green',
      [green('a'), green('b'), green('c')],
      'quality_assessed',
    ],
    [
      '2 of 3 core fields green stays open',
      [green('a'), green('b'), grey('c')],
      'none',
    ],
    ['one core field, green', [green('a')], 'quality_assessed'],
    [
      'a grey core field with a comment still stays open',
      [green('a'), grey('b', true)],
      'none',
    ],
  ])('%s', (_name, core, expected) => {
    expect(endAfterValidation(core)).toBe(expected);
  });
});

describe('endOnFinish (FR-15)', () => {
  it('zero core fields: Finish ends as quality_assessed (OQ-2 default)', () => {
    expect(endOnFinish([])).toBe('quality_assessed');
  });

  it('all core fields green: FR-14 applies', () => {
    expect(endOnFinish([green('a'), green('b')])).toBe('quality_assessed');
  });

  it('a grey core field with a comment: returned (scenario Return)', () => {
    expect(endOnFinish([grey('general.title', true), green('b')])).toBe(
      'returned',
    );
  });

  it('a grey core field without a comment: refused, naming the field', () => {
    expect(endOnFinish([grey('general.title'), green('b')])).toEqual({
      error: 'core_uncommented',
      fieldKeys: ['general.title'],
    });
  });

  it('names only the grey core fields that lack a comment, in the order given', () => {
    expect(
      endOnFinish([
        grey('z.last'),
        grey('m.commented', true),
        green('g'),
        grey('a.first'),
      ]),
    ).toEqual({
      error: 'core_uncommented',
      fieldKeys: ['z.last', 'a.first'],
    });
  });

  it('a comment on a green core field does not count for a grey one', () => {
    expect(endOnFinish([green('a', true), grey('b')])).toEqual({
      error: 'core_uncommented',
      fieldKeys: ['b'],
    });
  });
});

describe('round 1: any comment sends the result back (OQ-2, 2026-11-18)', () => {
  it('no core field but a comment: returned, not quality_assessed', () => {
    expect(endOnFinish([], true)).toBe('returned');
  });

  it('every core field green but a comment elsewhere: returned', () => {
    expect(endOnFinish([green('a'), green('b')], true)).toBe('returned');
  });

  it('no comment at all and every core green: quality_assessed', () => {
    expect(endOnFinish([green('a')], false)).toBe('quality_assessed');
  });

  it('a grey core field with no comment still refuses first', () => {
    expect(endOnFinish([grey('a')], true)).toEqual({
      error: 'core_uncommented',
      fieldKeys: ['a'],
    });
  });

  it('the last core going green never ends a commented result by itself', () => {
    expect(endAfterValidation([green('a')], true)).toBe('none');
    expect(endAfterValidation([green('a')], false)).toBe('quality_assessed');
  });
});
