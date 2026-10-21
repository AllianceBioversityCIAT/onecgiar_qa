import { describe, expect, it } from 'vitest';
import {
  validateTimelineCreate,
  type TimelineCreateInput,
  type TimelineRulesContext,
  type TimelineStepInput,
} from './timeline-rules.js';

// Expected issues are literal `{ field, code }` pairs taken from the FR-6 to
// FR-11 scenarios and design 7.5; none is computed by the rules. Today in Rome
// is 20 Oct 2026 (the FR-8 scenarios), and the catalogs hold programs 1, 2, 5
// and result types KP, IDEV. Every date row sits exactly on its boundary.
//
// Field paths are the request keys of design 6 (`programIds`, `resultTypeKeys`,
// `steps[i].<key>`). A missing date is REQUIRED and a malformed one INVALID.

const context: TimelineRulesContext = {
  today: '2026-10-20',
  knownProgramIds: new Set([1, 2, 5]),
  knownResultTypeKeys: new Set(['KP', 'IDEV']),
};

function step(
  audience: string,
  opensOn: string | null | undefined,
  closesOn: string | null | undefined,
  round: number,
  requiresLoad: boolean,
): TimelineStepInput {
  return {
    name: `Step ${audience}`,
    audience,
    opensOn,
    closesOn,
    round,
    requiresLoad,
  };
}

// The five audiences in workflow order, rounds 1,1,2,2,2, no overlaps.
function fiveSteps(): TimelineStepInput[] {
  return [
    step('assessors', '2026-11-02', '2026-11-06', 1, true),
    step('programs', '2026-11-09', '2026-11-13', 1, false),
    step('lead_assessors', '2026-11-16', '2026-11-20', 2, true),
    step('tpb', '2026-11-23', '2026-11-27', 2, false),
    step('ppu', '2026-11-30', '2026-12-04', 2, false),
  ];
}

function twoSteps(): TimelineStepInput[] {
  return fiveSteps().slice(0, 2);
}

function valid(
  overrides: Partial<TimelineCreateInput> = {},
): TimelineCreateInput {
  return {
    name: 'July 2026',
    allPrograms: false,
    programIds: [2, 5],
    allResultTypes: false,
    resultTypeKeys: ['IDEV'],
    steps: twoSteps(),
    ...overrides,
  };
}

function withSteps(
  steps: TimelineStepInput[],
  overrides: Partial<TimelineCreateInput> = {},
): TimelineCreateInput {
  return valid({ steps, ...overrides });
}

function patch(
  index: number,
  changes: Partial<TimelineStepInput>,
  steps: TimelineStepInput[] = twoSteps(),
): TimelineStepInput[] {
  return steps.map((s, i) => (i === index ? { ...s, ...changes } : s));
}

/** The request with a scope list left out altogether, as a body that never sent the key. */
function without(
  key: 'programIds' | 'resultTypeKeys',
  request: TimelineCreateInput = valid(),
): TimelineCreateInput {
  const { [key]: _omitted, ...rest } = request;
  return rest;
}

type Issue = { field: string; code: string; max?: number };
type Row = [label: string, request: TimelineCreateInput, expected: Issue[]];

describe('validateTimelineCreate: a valid request (FR-6 to FR-10)', () => {
  it('has no issues', () => {
    expect(validateTimelineCreate(valid(), context)).toEqual([]);
  });

  it('accepts the five default-shaped steps', () => {
    expect(validateTimelineCreate(withSteps(fiveSteps()), context)).toEqual([]);
  });
});

describe('name (FR-6)', () => {
  it.each<Row>([
    ['empty', valid({ name: '' }), [{ field: 'name', code: 'REQUIRED' }]],
    [
      'spaces only count as empty after trimming',
      valid({ name: '   ' }),
      [{ field: 'name', code: 'REQUIRED' }],
    ],
    ['120 characters is valid', valid({ name: 'a'.repeat(120) }), []],
    [
      '120 characters plus surrounding spaces is valid (trimmed)',
      valid({ name: `  ${'a'.repeat(120)}  ` }),
      [],
    ],
    [
      '121 characters is too long',
      valid({ name: 'a'.repeat(121) }),
      [{ field: 'name', code: 'TOO_LONG', max: 120 }],
    ],
  ])('%s', (_label, request, expected) => {
    expect(validateTimelineCreate(request, context)).toEqual(expected);
  });
});

describe('programs scope (FR-6, DD-6)', () => {
  it.each<Row>([
    [
      'all programs with no ids',
      valid({ allPrograms: true, programIds: [] }),
      [],
    ],
    [
      'explicit programs from the catalog',
      valid({ allPrograms: false, programIds: [2, 5] }),
      [],
    ],
    [
      'all programs together with ids is refused',
      valid({ allPrograms: true, programIds: [2] }),
      [{ field: 'programIds', code: 'INVALID' }],
    ],
    [
      'all programs with an unknown id is one issue, not two',
      valid({ allPrograms: true, programIds: [999] }),
      [{ field: 'programIds', code: 'INVALID' }],
    ],
    [
      'an empty list is not "all"',
      valid({ allPrograms: false, programIds: [] }),
      [{ field: 'programIds', code: 'REQUIRED' }],
    ],
    [
      'an id the catalog does not have',
      valid({ allPrograms: false, programIds: [2, 999] }),
      [{ field: 'programIds', code: 'INVALID' }],
    ],
    [
      'an absent list is missing, as an empty one is (FR-6, FR-11)',
      without('programIds', valid({ allPrograms: false })),
      [{ field: 'programIds', code: 'REQUIRED' }],
    ],
    [
      'a null list is missing too',
      valid({ allPrograms: false, programIds: null }),
      [{ field: 'programIds', code: 'REQUIRED' }],
    ],
    [
      'all programs with an absent list is fine',
      without('programIds', valid({ allPrograms: true })),
      [],
    ],
    [
      'all programs with a null list is fine',
      valid({ allPrograms: true, programIds: null }),
      [],
    ],
  ])('%s', (_label, request, expected) => {
    expect(validateTimelineCreate(request, context)).toEqual(expected);
  });
});

describe('result types scope (FR-6, DD-6)', () => {
  it.each<Row>([
    [
      'all result types with no keys',
      valid({ allResultTypes: true, resultTypeKeys: [] }),
      [],
    ],
    [
      'explicit keys from the catalog',
      valid({ allResultTypes: false, resultTypeKeys: ['KP', 'IDEV'] }),
      [],
    ],
    [
      'all result types together with keys is refused',
      valid({ allResultTypes: true, resultTypeKeys: ['KP'] }),
      [{ field: 'resultTypeKeys', code: 'INVALID' }],
    ],
    [
      'all result types with an unknown key is one issue, not two',
      valid({ allResultTypes: true, resultTypeKeys: ['NOPE'] }),
      [{ field: 'resultTypeKeys', code: 'INVALID' }],
    ],
    [
      'an empty list is not "all"',
      valid({ allResultTypes: false, resultTypeKeys: [] }),
      [{ field: 'resultTypeKeys', code: 'REQUIRED' }],
    ],
    [
      'a key the catalog does not have',
      valid({ allResultTypes: false, resultTypeKeys: ['KP', 'NOPE'] }),
      [{ field: 'resultTypeKeys', code: 'INVALID' }],
    ],
    [
      'an absent list is missing, as an empty one is (FR-6, FR-11)',
      without('resultTypeKeys', valid({ allResultTypes: false })),
      [{ field: 'resultTypeKeys', code: 'REQUIRED' }],
    ],
    [
      'a null list is missing too',
      valid({ allResultTypes: false, resultTypeKeys: null }),
      [{ field: 'resultTypeKeys', code: 'REQUIRED' }],
    ],
    [
      'all result types with an absent list is fine',
      without('resultTypeKeys', valid({ allResultTypes: true })),
      [],
    ],
    [
      'all result types with a null list is fine',
      valid({ allResultTypes: true, resultTypeKeys: null }),
      [],
    ],
  ])('%s', (_label, request, expected) => {
    expect(validateTimelineCreate(request, context)).toEqual(expected);
  });
});

describe('step count and names (FR-7)', () => {
  it.each<Row>([
    ['0 steps', withSteps([]), [{ field: 'steps', code: 'OUT_OF_RANGE' }]],
    ['1 step', withSteps(fiveSteps().slice(0, 1)), []],
    ['5 steps', withSteps(fiveSteps()), []],
    [
      '6 steps (the sixth can only repeat an audience)',
      withSteps([
        ...fiveSteps(),
        step('ppu', '2026-12-07', '2026-12-11', 2, false),
      ]),
      [
        { field: 'steps', code: 'OUT_OF_RANGE' },
        { field: 'steps[5].audience', code: 'AUDIENCE_ORDER' },
      ],
    ],
    [
      'a renamed step keeps its audience',
      withSteps(patch(0, { name: 'Assessment window' })),
      [],
    ],
    [
      'an empty step name',
      withSteps(patch(1, { name: '' })),
      [{ field: 'steps[1].name', code: 'REQUIRED' }],
    ],
    [
      'a 120 character step name',
      withSteps(patch(1, { name: 'a'.repeat(120) })),
      [],
    ],
    [
      'a 121 character step name',
      withSteps(patch(1, { name: 'a'.repeat(121) })),
      [{ field: 'steps[1].name', code: 'TOO_LONG', max: 120 }],
    ],
  ])('%s', (_label, request, expected) => {
    expect(validateTimelineCreate(request, context)).toEqual(expected);
  });
});

describe('audiences (FR-7, S-2)', () => {
  it.each<Row>([
    [
      'a gap in the workflow is allowed',
      withSteps([
        step('assessors', '2026-11-02', '2026-11-06', 1, true),
        step('lead_assessors', '2026-11-09', '2026-11-13', 1, false),
        step('ppu', '2026-11-16', '2026-11-20', 2, false),
      ]),
      [],
    ],
    [
      'two steps share an audience',
      withSteps(patch(1, { audience: 'assessors' })),
      [{ field: 'steps[1].audience', code: 'AUDIENCE_ORDER' }],
    ],
    [
      'ppu before tpb',
      withSteps([
        step('assessors', '2026-11-02', '2026-11-06', 1, true),
        step('ppu', '2026-11-09', '2026-11-13', 1, false),
        step('tpb', '2026-11-16', '2026-11-20', 2, false),
      ]),
      [{ field: 'steps[2].audience', code: 'AUDIENCE_ORDER' }],
    ],
    [
      'an audience that is not one of the five',
      withSteps(patch(1, { audience: 'reviewers' })),
      [{ field: 'steps[1].audience', code: 'INVALID' }],
    ],
  ])('%s', (_label, request, expected) => {
    expect(validateTimelineCreate(request, context)).toEqual(expected);
  });
});

describe('step dates (FR-8, S-1)', () => {
  it.each<Row>([
    [
      'a step that opens and closes on the same day is valid',
      withSteps(patch(0, { opensOn: '2026-11-02', closesOn: '2026-11-02' })),
      [],
    ],
    [
      'a step that closes the day before it opens',
      withSteps(patch(0, { opensOn: '2026-11-02', closesOn: '2026-11-01' })),
      [{ field: 'steps[0].closesOn', code: 'CLOSES_BEFORE_OPENS' }],
    ],
    [
      'the next step opens on the previous closing day',
      withSteps(patch(1, { opensOn: '2026-11-06', closesOn: '2026-11-13' })),
      [{ field: 'steps[1].opensOn', code: 'OVERLAPS_PREVIOUS_STEP' }],
    ],
    [
      'the next step opens the day after the previous closing day',
      withSteps(patch(1, { opensOn: '2026-11-07', closesOn: '2026-11-13' })),
      [],
    ],
    [
      'the next step opens before the previous one opened',
      withSteps(patch(1, { opensOn: '2026-11-01', closesOn: '2026-11-13' })),
      [{ field: 'steps[1].opensOn', code: 'OVERLAPS_PREVIOUS_STEP' }],
    ],
    [
      'a step with a missing closing date is kept at its place',
      withSteps(patch(1, { closesOn: undefined })),
      [{ field: 'steps[1].closesOn', code: 'REQUIRED' }],
    ],
    [
      'a missing opening date',
      withSteps(patch(0, { opensOn: undefined })),
      [{ field: 'steps[0].opensOn', code: 'REQUIRED' }],
    ],
    [
      'a null date',
      withSteps(patch(0, { closesOn: null })),
      [{ field: 'steps[0].closesOn', code: 'REQUIRED' }],
    ],
    [
      'an empty date',
      withSteps(patch(0, { opensOn: '' })),
      [{ field: 'steps[0].opensOn', code: 'REQUIRED' }],
    ],
    [
      'a date that does not exist (30 Feb)',
      withSteps(patch(0, { closesOn: '2026-02-30' })),
      [{ field: 'steps[0].closesOn', code: 'INVALID' }],
    ],
    [
      'a date not written YYYY-MM-DD',
      withSteps(patch(0, { opensOn: '02/11/2026' })),
      [{ field: 'steps[0].opensOn', code: 'INVALID' }],
    ],
    [
      'step 1 opens yesterday',
      withSteps(patch(0, { opensOn: '2026-10-19', closesOn: '2026-11-06' })),
      [{ field: 'steps[0].opensOn', code: 'BEFORE_TODAY' }],
    ],
    [
      'step 1 opens today',
      withSteps(patch(0, { opensOn: '2026-10-20', closesOn: '2026-11-06' })),
      [],
    ],
  ])('%s', (_label, request, expected) => {
    expect(validateTimelineCreate(request, context)).toEqual(expected);
  });

  it('keeps the index of every later step when a date is missing', () => {
    const steps = patch(
      2,
      { round: 3 },
      patch(1, { closesOn: undefined }, fiveSteps().slice(0, 3)),
    );
    expect(validateTimelineCreate(withSteps(steps), context)).toEqual([
      { field: 'steps[1].closesOn', code: 'REQUIRED' },
      { field: 'steps[2].round', code: 'ROUND_SEQUENCE' },
    ]);
  });

  it('compares step 1 with the today it is given, not with the clock', () => {
    expect(
      validateTimelineCreate(valid(), { ...context, today: '2026-11-03' }),
    ).toEqual([{ field: 'steps[0].opensOn', code: 'BEFORE_TODAY' }]);
    expect(
      validateTimelineCreate(valid(), { ...context, today: '2026-11-02' }),
    ).toEqual([]);
  });
});

describe('first step load (FR-9)', () => {
  it.each<Row>([
    [
      'the first step does not require a load',
      withSteps(patch(0, { requiresLoad: false })),
      [{ field: 'steps[0].requiresLoad', code: 'FIRST_STEP_LOAD' }],
    ],
    [
      'a later step may skip the load',
      withSteps(patch(1, { requiresLoad: false })),
      [],
    ],
  ])('%s', (_label, request, expected) => {
    expect(validateTimelineCreate(request, context)).toEqual(expected);
  });
});

describe('rounds (FR-10)', () => {
  const rounds = (values: number[]): TimelineCreateInput =>
    withSteps(fiveSteps().map((s, i) => ({ ...s, round: values[i]! })));

  it.each<Row>([
    ['1,1,2,2,2', rounds([1, 1, 2, 2, 2]), []],
    ['1,2,3,3,3', rounds([1, 2, 3, 3, 3]), []],
    [
      'the first round is 2',
      withSteps(twoSteps().map((s) => ({ ...s, round: 2 }))),
      [{ field: 'steps[0].round', code: 'ROUND_SEQUENCE' }],
    ],
    [
      'the first round is 0',
      withSteps(patch(0, { round: 0 })),
      [{ field: 'steps[0].round', code: 'ROUND_SEQUENCE' }],
    ],
    [
      '1,2,1 decreases',
      rounds([1, 2, 1, 1, 1]),
      [{ field: 'steps[2].round', code: 'ROUND_SEQUENCE' }],
    ],
    [
      '1,1,3 skips a round',
      rounds([1, 1, 3, 3, 3]),
      [{ field: 'steps[2].round', code: 'ROUND_SEQUENCE' }],
    ],
  ])('%s', (_label, request, expected) => {
    expect(validateTimelineCreate(request, context)).toEqual(expected);
  });
});

describe('all issues at once (FR-11)', () => {
  it('lists name, programs and a missing closing date, and nothing else', () => {
    const request = withSteps(
      patch(2, { closesOn: undefined }, fiveSteps().slice(0, 3)),
      { name: '', allPrograms: false, programIds: [] },
    );
    expect(validateTimelineCreate(request, context)).toEqual([
      { field: 'name', code: 'REQUIRED' },
      { field: 'programIds', code: 'REQUIRED' },
      { field: 'steps[2].closesOn', code: 'REQUIRED' },
    ]);
  });

  it('lists name, an ABSENT programs list and a missing closing date together: the list key is not in the request', () => {
    const request = without(
      'programIds',
      withSteps(patch(2, { closesOn: undefined }, fiveSteps().slice(0, 3)), {
        name: '',
        allPrograms: false,
      }),
    );
    expect('programIds' in request).toBe(false);
    expect(validateTimelineCreate(request, context)).toEqual([
      { field: 'name', code: 'REQUIRED' },
      { field: 'programIds', code: 'REQUIRED' },
      { field: 'steps[2].closesOn', code: 'REQUIRED' },
    ]);
  });

  it('keeps going across scope, steps and each step, in field order', () => {
    const request: TimelineCreateInput = {
      name: 'a'.repeat(121),
      allPrograms: true,
      programIds: [2],
      allResultTypes: false,
      resultTypeKeys: [],
      steps: [
        step('assessors', '2026-10-19', '2026-10-18', 2, false),
        step('assessors', '2026-10-18', '2026-10-25', 4, true),
      ],
    };
    expect(validateTimelineCreate(request, context)).toEqual([
      { field: 'name', code: 'TOO_LONG', max: 120 },
      { field: 'programIds', code: 'INVALID' },
      { field: 'resultTypeKeys', code: 'REQUIRED' },
      { field: 'steps[0].opensOn', code: 'BEFORE_TODAY' },
      { field: 'steps[0].closesOn', code: 'CLOSES_BEFORE_OPENS' },
      { field: 'steps[0].requiresLoad', code: 'FIRST_STEP_LOAD' },
      { field: 'steps[0].round', code: 'ROUND_SEQUENCE' },
      { field: 'steps[1].audience', code: 'AUDIENCE_ORDER' },
      { field: 'steps[1].opensOn', code: 'OVERLAPS_PREVIOUS_STEP' },
      { field: 'steps[1].round', code: 'ROUND_SEQUENCE' },
    ]);
  });

  it('does not change the request it is given', () => {
    const request = valid({ name: '' });
    const snapshot = JSON.stringify(request);
    validateTimelineCreate(request, context);
    expect(JSON.stringify(request)).toBe(snapshot);
  });
});
