import { describe, expect, it } from 'vitest';
import {
  mergeTimelineUpdate,
  momentsOfStep,
  validateTimelineCreate,
  validateTimelineUpdate,
  type StoredTimeline,
  type TimelineCreateInput,
  type TimelineRulesContext,
  type TimelineStepInput,
  type TimelineUpdateContext,
  type TimelineUpdateInput,
} from './timeline-rules.js';
import { dayEnd, dayStart, type RomeMinute } from '../rome-date.js';
import { viewTimeline } from './timeline-view.js';

// Expected issues are literal `{ field, code }` pairs taken from the FR-6 to
// FR-11 scenarios and design 7.5; none is computed by the rules. Today in Rome
// is 20 Oct 2026 (the FR-8 scenarios), and the catalogs hold programs 1, 2, 5
// and result types KP, IDEV. Every date row sits exactly on its boundary.
//
// Field paths are the request keys of design 6 (`programIds`, `resultTypeKeys`,
// `steps[i].<key>`). A missing date is REQUIRED and a malformed one INVALID.

const context: TimelineRulesContext = {
  now: dayStart('2026-10-20'),
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
      'step 1 opens on the day of now (now is 00:00, so the opening minute is not before it)',
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

  it('compares step 1 with the now it is given, not with the clock', () => {
    expect(
      validateTimelineCreate(valid(), {
        ...context,
        now: dayStart('2026-11-03'),
      }),
    ).toEqual([{ field: 'steps[0].opensOn', code: 'BEFORE_TODAY' }]);
    expect(
      validateTimelineCreate(valid(), {
        ...context,
        now: dayStart('2026-11-02'),
      }),
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

// ---------------------------------------------------------------------------
// validateTimelineUpdate (timeline-edit FR-1, FR-3, FR-4, FR-5, FR-11; design
// 6, 7.1, DD-4, DD-5, DD-7). Expected issues are literal `{ field, code }` pairs
// from the scenarios; none is computed by the rules.
//
// The stored timeline has three steps and the state of step 1 comes from
// `viewTimeline` (a guard test below pins each fixture's state through it, so
// no state is hand-built):
//   step 1  2 Nov to 6 Nov  (assessors)
//   step 2  10 Nov to 13 Nov (programs)
//   step 3  16 Nov to 20 Nov (lead_assessors)
// ---------------------------------------------------------------------------

function storedTimeline(
  overrides: Partial<StoredTimeline> = {},
): StoredTimeline {
  return {
    name: 'July 2026',
    allPrograms: false,
    programIds: [1],
    allResultTypes: false,
    resultTypeKeys: ['KP'],
    steps: [
      {
        position: 1,
        name: 'Assessors',
        audience: 'assessors',
        opensAt: dayStart('2026-11-02'),
        closesAt: dayEnd('2026-11-06'),
      },
      {
        position: 2,
        name: 'Programs',
        audience: 'programs',
        opensAt: dayStart('2026-11-10'),
        closesAt: dayEnd('2026-11-13'),
      },
      {
        position: 3,
        name: 'Lead assessors',
        audience: 'lead_assessors',
        opensAt: dayStart('2026-11-16'),
        closesAt: dayEnd('2026-11-20'),
      },
    ],
    ...overrides,
  };
}

type StateName = 'closed' | 'in_progress' | 'upcoming' | 'hold';

/** Step 1's state per fixture; a hold makes every step `upcoming`. */
const STATES: Record<
  StateName,
  { day: string; hasLoad: boolean; step1: string }
> = {
  closed: { day: '2026-11-08', hasLoad: true, step1: 'closed' },
  in_progress: { day: '2026-11-05', hasLoad: true, step1: 'in_progress' },
  upcoming: { day: '2026-10-20', hasLoad: false, step1: 'upcoming' },
  hold: { day: '2026-11-05', hasLoad: false, step1: 'upcoming' },
};

function updateContext(
  state: StateName,
  overrides: Partial<TimelineUpdateContext> = {},
): TimelineUpdateContext {
  const { day, hasLoad } = STATES[state];
  return { ...context, now: dayStart(day), hasLoad, ...overrides };
}

type UpdateRow = [
  label: string,
  state: StateName,
  request: TimelineUpdateInput,
  expected: Issue[],
];

/** A request that sends only step 1 with these fields. */
const onStep1 = (fields: object): TimelineUpdateInput => ({
  steps: [{ position: 1, ...fields }],
});

describe('validateTimelineUpdate: the state comes from viewTimeline (DD-2, DD-4)', () => {
  it.each(Object.entries(STATES))(
    '%s fixture: step 1 is %s through the view',
    (_name, { day, hasLoad, step1 }) => {
      const view = viewTimeline({
        steps: storedTimeline().steps,
        assignedRoles: [],
        now: dayStart(day),
        hasLoad,
      });
      expect(view.stepStates[1]).toBe(step1);
    },
  );

  it('the hold fixture has every step upcoming', () => {
    const { day, hasLoad } = STATES.hold;
    const view = viewTimeline({
      steps: storedTimeline().steps,
      assignedRoles: [],
      now: dayStart(day),
      hasLoad,
    });
    expect(view.stepStates).toEqual({
      1: 'upcoming',
      2: 'upcoming',
      3: 'upcoming',
    });
  });
});

describe('validateTimelineUpdate: locks by step state and changed field (FR-3, FR-4, DD-4)', () => {
  it.each<UpdateRow>([
    // --- closed step 1 (today 8 Nov, load done) ---------------------------
    [
      'closed: a changed opening date is locked',
      'closed',
      onStep1({ opensOn: '2026-11-01' }),
      [{ field: 'steps[0].opensOn', code: 'LOCKED' }],
    ],
    [
      'closed: a changed closing date is locked',
      'closed',
      onStep1({ closesOn: '2026-11-07' }),
      [{ field: 'steps[0].closesOn', code: 'LOCKED' }],
    ],
    [
      'closed: a new name is accepted',
      'closed',
      onStep1({ name: 'Renamed' }),
      [],
    ],
    [
      'closed: both dates resent unchanged are not a change',
      'closed',
      onStep1({ opensOn: '2026-11-02', closesOn: '2026-11-06' }),
      [],
    ],
    [
      'closed: a programs change is locked (step 1 has started)',
      'closed',
      { programIds: [1, 2] },
      [{ field: 'programIds', code: 'LOCKED' }],
    ],
    [
      'closed: a result types change is locked',
      'closed',
      { resultTypeKeys: ['IDEV'] },
      [{ field: 'resultTypeKeys', code: 'LOCKED' }],
    ],
    [
      'closed: the scope resent equal (other order, repeats) is not a change',
      'closed',
      { allPrograms: false, programIds: [1, 1], resultTypeKeys: ['KP', 'KP'] },
      [],
    ],
    [
      'closed: an upcoming step 2 may still move its opening date to a future day',
      'closed',
      { steps: [{ position: 2, opensOn: '2026-11-09' }] },
      [],
    ],
    [
      'closed: an upcoming step 2 cannot open before today',
      'closed',
      { steps: [{ position: 2, opensOn: '2026-11-07' }] },
      [{ field: 'steps[1].opensOn', code: 'BEFORE_TODAY' }],
    ],
    // --- in-progress step 1 (today 5 Nov, load done) ----------------------
    [
      'in progress: a changed opening date is locked',
      'in_progress',
      onStep1({ opensOn: '2026-11-03' }),
      [{ field: 'steps[0].opensOn', code: 'LOCKED' }],
    ],
    [
      'in progress: a closing date before today is refused',
      'in_progress',
      onStep1({ closesOn: '2026-11-04' }),
      [{ field: 'steps[0].closesOn', code: 'BEFORE_TODAY' }],
    ],
    [
      'in progress: a closing date of today is accepted',
      'in_progress',
      onStep1({ closesOn: '2026-11-05' }),
      [],
    ],
    [
      'in progress: a later closing date is accepted',
      'in_progress',
      onStep1({ closesOn: '2026-11-08' }),
      [],
    ],
    [
      'in progress: opening 3 Nov and closing 4 Nov are both refused in one answer',
      'in_progress',
      onStep1({ opensOn: '2026-11-03', closesOn: '2026-11-04' }),
      [
        { field: 'steps[0].opensOn', code: 'LOCKED' },
        { field: 'steps[0].closesOn', code: 'BEFORE_TODAY' },
      ],
    ],
    [
      'in progress: a new name is accepted',
      'in_progress',
      onStep1({ name: 'Renamed' }),
      [],
    ],
    [
      'in progress: the dates resent unchanged are not a change',
      'in_progress',
      onStep1({ opensOn: '2026-11-02', closesOn: '2026-11-06' }),
      [],
    ],
    [
      'in progress: a scope change is locked',
      'in_progress',
      { allResultTypes: true, resultTypeKeys: [] },
      [{ field: 'resultTypeKeys', code: 'LOCKED' }],
    ],
    // --- upcoming step 1 (today 20 Oct, no load) --------------------------
    [
      'upcoming: opening yesterday is refused',
      'upcoming',
      onStep1({ opensOn: '2026-10-19' }),
      [{ field: 'steps[0].opensOn', code: 'BEFORE_TODAY' }],
    ],
    [
      'upcoming: opening today is accepted',
      'upcoming',
      onStep1({ opensOn: '2026-10-20' }),
      [],
    ],
    [
      'upcoming: a later closing date is accepted',
      'upcoming',
      onStep1({ closesOn: '2026-11-08' }),
      [],
    ],
    [
      'upcoming: a closing date before its opening date is refused',
      'upcoming',
      onStep1({ closesOn: '2026-11-01' }),
      [{ field: 'steps[0].closesOn', code: 'CLOSES_BEFORE_OPENS' }],
    ],
    [
      'upcoming: a new name is accepted',
      'upcoming',
      onStep1({ name: 'Renamed' }),
      [],
    ],
    [
      'upcoming: programs from SP01 to SP01 and SP02 are accepted (FR-4 before step 1)',
      'upcoming',
      { allPrograms: false, programIds: [1, 2] },
      [],
    ],
    [
      'upcoming: result types may change',
      'upcoming',
      { resultTypeKeys: ['KP', 'IDEV'] },
      [],
    ],
    [
      'upcoming: an explicit all with no list is accepted',
      'upcoming',
      { allPrograms: true },
      [],
    ],
    // --- on hold (today 5 Nov, no load): step 1's day is in the past ------
    [
      'hold: opening on a past day is refused as before today',
      'hold',
      onStep1({ opensOn: '2026-11-03' }),
      [{ field: 'steps[0].opensOn', code: 'BEFORE_TODAY' }],
    ],
    [
      'hold: opening today is accepted',
      'hold',
      onStep1({ opensOn: '2026-11-05' }),
      [],
    ],
    [
      'hold: a later closing date is accepted',
      'hold',
      onStep1({ closesOn: '2026-11-08' }),
      [],
    ],
    [
      'FR-3 Unchanged past date on hold: a rename that resends step 1 as stored (past opening day) is accepted',
      'hold',
      {
        name: 'Renamed',
        steps: [
          {
            position: 1,
            name: 'Assessors',
            opensOn: '2026-11-02',
            closesOn: '2026-11-06',
          },
        ],
      },
      [],
    ],
    [
      'hold: the scope may change (step 1 has not started)',
      'hold',
      { programIds: [1, 2] },
      [],
    ],
  ])('%s', (_label, state, request, expected) => {
    expect(
      validateTimelineUpdate(storedTimeline(), request, updateContext(state)),
    ).toEqual(expected);
  });

  it('FR-4 Load done, step 1 not started: a timeline with a load locks the scope while step 1 is upcoming', () => {
    expect(
      validateTimelineUpdate(
        storedTimeline(),
        { programIds: [1, 2] },
        updateContext('upcoming', { hasLoad: true }),
      ),
    ).toEqual([{ field: 'programIds', code: 'LOCKED' }]);
  });

  it('a timeline with a load still accepts a scope sent equal to the stored one', () => {
    expect(
      validateTimelineUpdate(
        storedTimeline(),
        { programIds: [1] },
        updateContext('upcoming', { hasLoad: true }),
      ),
    ).toEqual([]);
  });

  it('a step closing today is still in progress: its opening date is locked, its closing date moves (day boundary)', () => {
    const context6 = updateContext('in_progress', {
      now: dayStart('2026-11-06'),
    });
    expect(
      validateTimelineUpdate(
        storedTimeline(),
        onStep1({ closesOn: '2026-11-07' }),
        context6,
      ),
    ).toEqual([]);
    expect(
      validateTimelineUpdate(
        storedTimeline(),
        onStep1({ opensOn: '2026-11-03' }),
        context6,
      ),
    ).toEqual([{ field: 'steps[0].opensOn', code: 'LOCKED' }]);
  });

  it('a step that closed yesterday is closed: its closing date is locked (day boundary)', () => {
    const context7 = updateContext('closed', { now: dayStart('2026-11-07') });
    expect(
      validateTimelineUpdate(
        storedTimeline(),
        onStep1({ closesOn: '2026-11-08' }),
        context7,
      ),
    ).toEqual([{ field: 'steps[0].closesOn', code: 'LOCKED' }]);
  });
});

describe('validateTimelineUpdate: structure is fixed (FR-1, DD-7)', () => {
  it.each<UpdateRow>([
    [
      'a position the timeline lacks is named by its request index',
      'upcoming',
      {
        steps: [
          { position: 1, name: 'A' },
          { position: 4, name: 'D' },
        ],
      },
      [{ field: 'steps[1].position', code: 'INVALID' }],
    ],
    [
      'position 0 is a position the timeline lacks',
      'upcoming',
      { steps: [{ position: 0, name: 'A' }] },
      [{ field: 'steps[0].position', code: 'INVALID' }],
    ],
    [
      'the same position twice names the second one',
      'upcoming',
      {
        steps: [
          { position: 1, name: 'A' },
          { position: 1, name: 'B' },
        ],
      },
      [{ field: 'steps[1].position', code: 'INVALID' }],
    ],
    [
      'an unknown position is not judged on its other fields',
      'upcoming',
      { steps: [{ position: 7, name: '', opensOn: '2020-01-01' }] },
      [{ field: 'steps[0].position', code: 'INVALID' }],
    ],
    [
      'every position problem is listed, in request order, before the text checks',
      'upcoming',
      {
        name: '',
        steps: [{ position: 9 }, { position: 2 }, { position: 2 }],
      },
      [
        { field: 'steps[0].position', code: 'INVALID' },
        { field: 'steps[2].position', code: 'INVALID' },
        { field: 'name', code: 'REQUIRED' },
      ],
    ],
  ])('%s', (_label, state, request, expected) => {
    expect(
      validateTimelineUpdate(storedTimeline(), request, updateContext(state)),
    ).toEqual(expected);
  });
});

describe('validateTimelineUpdate: step paths are the step position minus one (FR-5, DD-7)', () => {
  it('names an unsent step when an edit to step 1 makes it overlap', () => {
    expect(
      validateTimelineUpdate(
        storedTimeline(),
        onStep1({ closesOn: '2026-11-12' }),
        updateContext('upcoming'),
      ),
    ).toEqual([{ field: 'steps[1].opensOn', code: 'OVERLAPS_PREVIOUS_STEP' }]);
  });

  it('closing step 1 on the day step 2 opens still overlaps (a strictly later day is needed)', () => {
    expect(
      validateTimelineUpdate(
        storedTimeline(),
        onStep1({ closesOn: '2026-11-10' }),
        updateContext('upcoming'),
      ),
    ).toEqual([{ field: 'steps[1].opensOn', code: 'OVERLAPS_PREVIOUS_STEP' }]);
  });

  it('closing step 1 the day before step 2 opens is accepted', () => {
    expect(
      validateTimelineUpdate(
        storedTimeline(),
        onStep1({ closesOn: '2026-11-09' }),
        updateContext('upcoming'),
      ),
    ).toEqual([]);
  });

  it('uses the position, not the request index, for a step sent first', () => {
    // Step 3 is the only step sent (request index 0): its paths are steps[2].
    expect(
      validateTimelineUpdate(
        storedTimeline(),
        {
          steps: [{ position: 3, name: '', closesOn: '2026-11-15' }],
        },
        updateContext('upcoming'),
      ),
    ).toEqual([
      { field: 'steps[2].name', code: 'REQUIRED' },
      { field: 'steps[2].closesOn', code: 'CLOSES_BEFORE_OPENS' },
    ]);
  });

  it('names a locked change on the step by position', () => {
    expect(
      validateTimelineUpdate(
        storedTimeline(),
        { steps: [{ position: 1, closesOn: '2026-11-07' }] },
        updateContext('closed'),
      ),
    ).toEqual([{ field: 'steps[0].closesOn', code: 'LOCKED' }]);
  });
});

describe('validateTimelineUpdate: every problem at once (FR-5)', () => {
  it('lists an empty name, a closed step date change and a late scope change together, as catalog codes only', () => {
    const issues = validateTimelineUpdate(
      storedTimeline(),
      {
        name: '',
        steps: [{ position: 1, closesOn: '2026-11-07' }],
        programIds: [1, 2],
      },
      updateContext('closed'),
    );
    expect(issues).toEqual([
      { field: 'name', code: 'REQUIRED' },
      { field: 'steps[0].closesOn', code: 'LOCKED' },
      { field: 'programIds', code: 'LOCKED' },
    ]);
    for (const issue of issues) {
      expect(Object.keys(issue).sort()).toEqual(['code', 'field']);
    }
  });

  it('keeps going across structure, text, locks and merged-state rules, in a fixed order', () => {
    const issues = validateTimelineUpdate(
      storedTimeline(),
      {
        name: 'a'.repeat(121),
        allPrograms: true,
        programIds: [1],
        steps: [
          { position: 8 },
          { position: 1, name: ' ', closesOn: '2026-11-04' },
          { position: 2, opensOn: '2026-11-04' },
        ],
      },
      updateContext('in_progress'),
    );
    expect(issues).toEqual([
      { field: 'steps[0].position', code: 'INVALID' },
      { field: 'name', code: 'TOO_LONG', max: 120 },
      { field: 'steps[0].name', code: 'REQUIRED' },
      { field: 'steps[0].closesOn', code: 'BEFORE_TODAY' },
      { field: 'steps[1].opensOn', code: 'BEFORE_TODAY' },
      { field: 'programIds', code: 'LOCKED' },
      { field: 'programIds', code: 'INVALID' },
      { field: 'steps[1].opensOn', code: 'OVERLAPS_PREVIOUS_STEP' },
    ]);
  });

  it('does not change the stored timeline or the request it is given', () => {
    const storedBefore = storedTimeline();
    const request: TimelineUpdateInput = {
      name: ' x ',
      programIds: [2, 2, 1],
      steps: [{ position: 1, name: ' y ', closesOn: '2026-11-08' }],
    };
    const snapshot = JSON.stringify([storedBefore, request]);
    validateTimelineUpdate(storedBefore, request, updateContext('upcoming'));
    expect(JSON.stringify([storedBefore, request])).toBe(snapshot);
  });
});

describe('validateTimelineUpdate: the creation rules still hold on the merged state (FR-5, DD-5)', () => {
  it.each<UpdateRow>([
    ['an empty request changes nothing', 'upcoming', {}, []],
    [
      'a name of 120 characters once trimmed is accepted',
      'upcoming',
      { name: `  ${'a'.repeat(120)}  ` },
      [],
    ],
    [
      'a name of 121 characters is too long',
      'upcoming',
      { name: 'a'.repeat(121) },
      [{ field: 'name', code: 'TOO_LONG', max: 120 }],
    ],
    [
      'an empty step name is required',
      'closed',
      onStep1({ name: '   ' }),
      [{ field: 'steps[0].name', code: 'REQUIRED' }],
    ],
    [
      'a step name of 121 characters is too long',
      'upcoming',
      { steps: [{ position: 2, name: 'b'.repeat(121) }] },
      [{ field: 'steps[1].name', code: 'TOO_LONG', max: 120 }],
    ],
    [
      'an explicit all with a list is invalid',
      'upcoming',
      { allPrograms: true, programIds: [1] },
      [{ field: 'programIds', code: 'INVALID' }],
    ],
    [
      'a list sent without its flag is judged against the stored flag (stored false: accepted)',
      'upcoming',
      { resultTypeKeys: ['IDEV'] },
      [],
    ],
    [
      'an explicit list with no item is required',
      'upcoming',
      { allPrograms: false, programIds: [] },
      [{ field: 'programIds', code: 'REQUIRED' }],
    ],
    [
      'a program the catalog does not know is invalid',
      'upcoming',
      { programIds: [1, 9] },
      [{ field: 'programIds', code: 'INVALID' }],
    ],
    [
      'a result type the catalog does not know is invalid',
      'upcoming',
      { resultTypeKeys: ['NOPE'] },
      [{ field: 'resultTypeKeys', code: 'INVALID' }],
    ],
    [
      'a missing closing date is required',
      'upcoming',
      onStep1({ closesOn: '' }),
      [{ field: 'steps[0].closesOn', code: 'REQUIRED' }],
    ],
    [
      'a date that is not on the calendar is invalid',
      'upcoming',
      onStep1({ closesOn: '2026-02-30' }),
      [{ field: 'steps[0].closesOn', code: 'INVALID' }],
    ],
  ])('%s', (_label, state, request, expected) => {
    expect(
      validateTimelineUpdate(storedTimeline(), request, updateContext(state)),
    ).toEqual(expected);
  });

  it('judges a list sent without its flag against the stored flag (stored true: invalid)', () => {
    expect(
      validateTimelineUpdate(
        storedTimeline({ allPrograms: true, programIds: [] }),
        { programIds: [1] },
        updateContext('upcoming'),
      ),
    ).toEqual([{ field: 'programIds', code: 'INVALID' }]);
  });

  it('a flag turned off with no list leaves the scope with no item', () => {
    expect(
      validateTimelineUpdate(
        storedTimeline({ allPrograms: true, programIds: [] }),
        { allPrograms: false },
        updateContext('upcoming'),
      ),
    ).toEqual([{ field: 'programIds', code: 'REQUIRED' }]);
  });

  it('does not check an unchanged scope against the catalog (the catalog is not read for it)', () => {
    expect(
      validateTimelineUpdate(
        storedTimeline(),
        { programIds: [1], resultTypeKeys: ['KP'] },
        updateContext('closed', {
          knownProgramIds: new Set(),
          knownResultTypeKeys: new Set(),
        }),
      ),
    ).toEqual([]);
  });
});

describe('mergeTimelineUpdate (design 7.1 step 2)', () => {
  it('overlays the sent fields and keeps every other stored value', () => {
    expect(
      mergeTimelineUpdate(storedTimeline(), {
        steps: [{ position: 2, closesOn: '2026-11-14' }],
      }),
    ).toEqual({
      name: 'July 2026',
      allPrograms: false,
      programIds: [1],
      allResultTypes: false,
      resultTypeKeys: ['KP'],
      steps: [
        {
          position: 1,
          name: 'Assessors',
          opensAt: '2026-11-02T00:00',
          closesAt: '2026-11-06T23:59',
        },
        {
          position: 2,
          name: 'Programs',
          opensAt: '2026-11-10T00:00',
          closesAt: '2026-11-14T23:59',
        },
        {
          position: 3,
          name: 'Lead assessors',
          opensAt: '2026-11-16T00:00',
          closesAt: '2026-11-20T23:59',
        },
      ],
    });
  });

  it('trims the names and dedupes the lists, as create does', () => {
    const merged = mergeTimelineUpdate(storedTimeline(), {
      name: '  August 2026 ',
      programIds: [2, 2, 1],
      resultTypeKeys: ['IDEV', 'IDEV'],
      steps: [{ position: 1, name: '  Opened ' }],
    });
    expect(merged.name).toBe('August 2026');
    expect(merged.programIds).toEqual([2, 1]);
    expect(merged.resultTypeKeys).toEqual(['IDEV']);
    expect(merged.steps[0]?.name).toBe('Opened');
  });

  it('empties a list when its flag is turned on without a list', () => {
    const merged = mergeTimelineUpdate(storedTimeline(), {
      allPrograms: true,
    });
    expect(merged.allPrograms).toBe(true);
    expect(merged.programIds).toEqual([]);
  });

  it('ignores a step position the timeline lacks', () => {
    const merged = mergeTimelineUpdate(storedTimeline(), {
      steps: [{ position: 9, name: 'Ghost' }],
    });
    expect(merged.steps.map((s) => s.name)).toEqual([
      'Assessors',
      'Programs',
      'Lead assessors',
    ]);
  });
});

// --- timeline-step-times: a day-only value is a moment (FR-5, FR-9, S-6) ------

describe('a day-only value means 00:00 when it opens and 23:59 when it closes (timeline-step-times FR-9, S-6)', () => {
  it('step 1 opening today is before now once the day has begun (FR-5: judged to the minute)', () => {
    const request = withSteps(
      patch(0, { opensOn: '2026-10-20', closesOn: '2026-11-06' }),
    );
    expect(
      validateTimelineCreate(request, {
        ...context,
        now: '2026-10-20T10:00' as RomeMinute,
      }),
    ).toEqual([{ field: 'steps[0].opensOn', code: 'BEFORE_TODAY' }]);
    expect(
      validateTimelineCreate(request, {
        ...context,
        now: '2026-10-20T00:00' as RomeMinute,
      }),
    ).toEqual([]);
  });

  it.each([
    ['a moment in the day-only opening key', { opensOn: '2026-11-02T00:00' }],
    ['a moment in the day-only closing key', { closesOn: '2026-11-06T23:59' }],
    ['a moment with a time zone', { opensOn: '2026-11-02T00:00Z' }],
  ])('refuses %s as INVALID, on that key', (_label, fields) => {
    const key = 'opensOn' in fields ? 'opensOn' : 'closesOn';
    expect(
      validateTimelineCreate(withSteps(patch(0, fields)), context),
    ).toEqual([{ field: `steps[0].${key}`, code: 'INVALID' }]);
  });

  it('on an edit, a closesOn equal to the stored date over a stored 17:30 is a change to 23:59, so a closed step locks it', () => {
    const stored = storedTimeline();
    const withTimes: StoredTimeline = {
      ...stored,
      steps: stored.steps.map((s) =>
        s.position === 1
          ? { ...s, closesAt: '2026-11-06T17:30' as RomeMinute }
          : s,
      ),
    };
    const merged = mergeTimelineUpdate(withTimes, {
      steps: [{ position: 1, closesOn: '2026-11-06' }],
    });
    expect(merged.steps[0]?.closesAt).toBe('2026-11-06T23:59');
    expect(
      validateTimelineUpdate(
        withTimes,
        { steps: [{ position: 1, closesOn: '2026-11-06' }] },
        updateContext('closed'),
      ),
    ).toEqual([{ field: 'steps[0].closesOn', code: 'LOCKED' }]);
  });

  it('on an edit, a day equal to a stored 00:00 / 23:59 is not a change', () => {
    expect(
      validateTimelineUpdate(
        storedTimeline(),
        onStep1({ opensOn: '2026-11-02', closesOn: '2026-11-06' }),
        updateContext('closed'),
      ),
    ).toEqual([]);
  });
});

// --- timeline-step-times T-4: the minute-level write rules --------------------
//
// Expected values are the literal moments, fields and codes of the scenarios of
// requirements FR-1, FR-3, FR-4, FR-5, FR-6 and FR-9; none is computed by the
// rules. Every case pins `now` itself and never reads a clock.

const minute = (value: string): RomeMinute => value as RomeMinute;

function atStep(
  audience: string,
  opensAt: string | null | undefined,
  closesAt: string | null | undefined,
  round: number,
  requiresLoad: boolean,
): TimelineStepInput {
  return {
    name: `Step ${audience}`,
    audience,
    opensAt,
    closesAt,
    round,
    requiresLoad,
  };
}

/** Two steps written with moments: 10 to 12 Nov, then 13 to 14 Nov. */
function twoStepsAt(): TimelineStepInput[] {
  return [
    atStep('assessors', '2026-11-10T14:00', '2026-11-12T17:30', 1, true),
    atStep('programs', '2026-11-13T09:00', '2026-11-14T17:00', 1, false),
  ];
}

const patchAt = (
  index: number,
  changes: Partial<TimelineStepInput>,
  steps: TimelineStepInput[] = twoStepsAt(),
): TimelineStepInput[] =>
  steps.map((s, i) => (i === index ? { ...s, ...changes } : s));

const at = (value: string): RomeMinute => minute(value);
const createAt = (now: string): TimelineRulesContext => ({
  ...context,
  now: at(now),
});

describe('FR-1 Valid moments (timeline-step-times)', () => {
  it('a step from 2026-11-10T14:00 to 2026-11-12T17:30 is valid at 2026-11-02T10:00', () => {
    expect(
      validateTimelineCreate(
        withSteps(twoStepsAt()),
        createAt('2026-11-02T10:00'),
      ),
    ).toEqual([]);
  });
});

describe('FR-1 Malformed or missing moment (timeline-step-times)', () => {
  it.each([
    ['seconds', '2026-11-10T14:00:00'],
    ['an offset', '2026-11-10T14:00Z'],
    ['a date that does not exist', '2026-02-30T10:00'],
    ['hour 24', '2026-11-10T24:00'],
    ['a minute of 60', '2026-11-10T14:60'],
    ['a bare day', '2026-11-10'],
  ])('an opening moment with %s is INVALID on opensAt', (_label, value) => {
    expect(
      validateTimelineCreate(
        withSteps(patchAt(0, { opensAt: value })),
        createAt('2026-11-02T10:00'),
      ),
    ).toEqual([{ field: 'steps[0].opensAt', code: 'INVALID' }]);
  });

  it.each([
    ['seconds', '2026-11-12T17:30:00'],
    ['an offset', '2026-11-12T17:30+01:00'],
    ['a date that does not exist', '2026-02-30T10:00'],
    ['hour 24', '2026-11-12T24:00'],
  ])('a closing moment with %s is INVALID on closesAt', (_label, value) => {
    expect(
      validateTimelineCreate(
        withSteps(patchAt(0, { closesAt: value })),
        createAt('2026-11-02T10:00'),
      ),
    ).toEqual([{ field: 'steps[0].closesAt', code: 'INVALID' }]);
  });

  it.each([
    ['absent', undefined],
    ['null', null],
    ['empty', ''],
  ])('a %s closing moment is REQUIRED on closesAt', (_label, value) => {
    expect(
      validateTimelineCreate(
        withSteps(patchAt(1, { closesAt: value })),
        createAt('2026-11-02T10:00'),
      ),
    ).toEqual([{ field: 'steps[1].closesAt', code: 'REQUIRED' }]);
  });

  it('a step with neither form for its opening moment is REQUIRED on opensAt', () => {
    expect(
      validateTimelineCreate(
        withSteps(patchAt(0, { opensAt: undefined })),
        createAt('2026-11-02T10:00'),
      ),
    ).toEqual([{ field: 'steps[0].opensAt', code: 'REQUIRED' }]);
  });

  it('the step is not dropped: a bad moment on step 2 keeps the index of the rule problem on step 3', () => {
    const steps = [
      ...patchAt(1, { opensAt: '2026-11-13T14:00:00' }),
      atStep('lead_assessors', '2026-11-12T09:00', '2026-11-12T10:00', 3, true),
    ];
    expect(
      validateTimelineCreate(withSteps(steps), createAt('2026-11-02T10:00')),
    ).toEqual([
      { field: 'steps[1].opensAt', code: 'INVALID' },
      { field: 'steps[2].opensAt', code: 'OVERLAPS_PREVIOUS_STEP' },
      { field: 'steps[2].round', code: 'ROUND_SEQUENCE' },
    ]);
  });

  it('a moment with an offset is refused, not read in another zone', () => {
    // 13:00Z would be 14:00 in Rome; it must not be accepted as that.
    expect(
      validateTimelineCreate(
        withSteps(patchAt(0, { opensAt: '2026-11-10T13:00Z' })),
        createAt('2026-11-02T10:00'),
      ),
    ).toEqual([{ field: 'steps[0].opensAt', code: 'INVALID' }]);
  });
});

describe('FR-3 Order and overlap at minute level (timeline-step-times)', () => {
  const now = createAt('2026-11-02T10:00');

  it('Same moment or reversed: the same minute is CLOSES_BEFORE_OPENS on closesAt', () => {
    expect(
      validateTimelineCreate(
        withSteps(
          patchAt(0, {
            opensAt: '2026-11-10T14:00',
            closesAt: '2026-11-10T14:00',
          }),
        ),
        now,
      ),
    ).toEqual([{ field: 'steps[0].closesAt', code: 'CLOSES_BEFORE_OPENS' }]);
  });

  it('Same moment or reversed: a closing minute before the opening one is CLOSES_BEFORE_OPENS on closesAt', () => {
    expect(
      validateTimelineCreate(
        withSteps(
          patchAt(0, {
            opensAt: '2026-11-10T14:00',
            closesAt: '2026-11-10T13:59',
          }),
        ),
        now,
      ),
    ).toEqual([{ field: 'steps[0].closesAt', code: 'CLOSES_BEFORE_OPENS' }]);
  });

  it('Same moment or reversed: one minute later is valid', () => {
    expect(
      validateTimelineCreate(
        withSteps(
          patchAt(0, {
            opensAt: '2026-11-10T14:00',
            closesAt: '2026-11-10T14:01',
          }),
        ),
        now,
      ),
    ).toEqual([]);
  });

  it('Two steps on the same day: step 1 closing at 12:00, step 2 opening at 14:00, is valid', () => {
    const steps = [
      atStep('assessors', '2026-11-10T09:00', '2026-11-10T12:00', 1, true),
      atStep('programs', '2026-11-10T14:00', '2026-11-10T17:00', 1, false),
    ];
    expect(validateTimelineCreate(withSteps(steps), now)).toEqual([]);
  });

  describe('Overlap: step 1 closes at 2026-11-10T12:00', () => {
    const overlapSteps = (opensAt: string): TimelineStepInput[] => [
      atStep('assessors', '2026-11-10T09:00', '2026-11-10T12:00', 1, true),
      atStep('programs', opensAt, '2026-11-10T17:00', 1, false),
    ];

    it.each([
      ['the same minute', '2026-11-10T12:00'],
      ['an earlier minute', '2026-11-10T11:59'],
      ['before step 1 opened', '2026-11-10T08:00'],
    ])(
      'step 2 opening at %s is OVERLAPS_PREVIOUS_STEP on opensAt',
      (_l, value) => {
        expect(
          validateTimelineCreate(withSteps(overlapSteps(value)), now),
        ).toEqual([
          { field: 'steps[1].opensAt', code: 'OVERLAPS_PREVIOUS_STEP' },
        ]);
      },
    );

    it('AND IT MUST accept 2026-11-10T12:01', () => {
      expect(
        validateTimelineCreate(
          withSteps(overlapSteps('2026-11-10T12:01')),
          now,
        ),
      ).toEqual([]);
    });
  });
});

describe('FR-4 Spring and autumn (timeline-step-times)', () => {
  const now = createAt('2026-10-20T10:00');

  it('a step opening at 2027-03-28T02:30 (the hour does not exist) is DST_HOUR on opensAt', () => {
    expect(
      validateTimelineCreate(
        withSteps([
          atStep('assessors', '2027-03-28T02:30', '2027-03-29T09:00', 1, true),
        ]),
        now,
      ),
    ).toEqual([{ field: 'steps[0].opensAt', code: 'DST_HOUR' }]);
  });

  it('a step closing at 2026-10-25T02:15 (the hour happens twice) is DST_HOUR on closesAt', () => {
    expect(
      validateTimelineCreate(
        withSteps([
          atStep('assessors', '2026-10-24T09:00', '2026-10-25T02:15', 1, true),
        ]),
        now,
      ),
    ).toEqual([{ field: 'steps[0].closesAt', code: 'DST_HOUR' }]);
  });

  it.each([
    ['2026-10-25T03:00', 'closes'],
    ['2026-10-25T01:59', 'closes'],
  ])('BUT %s is not refused', (value) => {
    expect(
      validateTimelineCreate(
        withSteps([atStep('assessors', '2026-10-24T09:00', value, 1, true)]),
        now,
      ),
    ).toEqual([]);
  });

  it('02:30 on an ordinary day is not refused', () => {
    expect(
      validateTimelineCreate(
        withSteps([
          atStep('assessors', '2026-11-10T02:30', '2026-11-10T09:00', 1, true),
        ]),
        now,
      ),
    ).toEqual([]);
  });
});

describe('FR-5 Earlier today (timeline-step-times)', () => {
  const now = createAt('2026-11-10T14:20');
  const stepOpeningAt = (opensAt: string): TimelineStepInput[] => [
    atStep('assessors', opensAt, '2026-11-12T17:30', 1, true),
  ];

  it('step 1 opening at 2026-11-10T14:00 is BEFORE_TODAY on opensAt at 14:20', () => {
    expect(
      validateTimelineCreate(withSteps(stepOpeningAt('2026-11-10T14:00')), now),
    ).toEqual([{ field: 'steps[0].opensAt', code: 'BEFORE_TODAY' }]);
  });

  it('AND IT MUST accept 2026-11-10T14:20, the current minute, and the step is in progress at once', () => {
    expect(
      validateTimelineCreate(withSteps(stepOpeningAt('2026-11-10T14:20')), now),
    ).toEqual([]);
    const view = viewTimeline({
      steps: [
        {
          position: 1,
          audience: 'assessors',
          opensAt: at('2026-11-10T14:20'),
          closesAt: at('2026-11-12T17:30'),
        },
      ],
      assignedRoles: [],
      now: now.now,
      hasLoad: true,
    });
    expect(view.stepStates[1]).toBe('in_progress');
  });
});

/**
 * The same rules with the two forms of one boundary (FR-9: "every rule of
 * FR-3...FR-6 applies to the resulting moment"). A row is written once as days
 * and times; the day-only form uses the days of the same moments, which mean
 * 00:00 and 23:59, so the outcome is the same and only the key differs.
 */
describe('the same rules with both forms of input (FR-9)', () => {
  type Form = 'moments' | 'day-only';
  type Bounds = [opens: string, closes: string | null | undefined];
  const build = (form: Form, a: Bounds, b: Bounds): TimelineStepInput[] => {
    const write = (
      audience: string,
      [opens, closes]: Bounds,
      round: number,
      load: boolean,
    ): TimelineStepInput =>
      form === 'moments'
        ? atStep(
            audience,
            `${opens}T00:00`,
            closes ? `${closes}T23:59` : closes,
            round,
            load,
          )
        : step(audience, opens, closes, round, load);
    return [write('assessors', a, 1, true), write('programs', b, 1, false)];
  };
  const key = (form: Form, edge: 'opens' | 'closes') =>
    `${edge}${form === 'moments' ? 'At' : 'On'}`;
  const now = createAt('2026-11-10T00:00');

  describe.each<Form>(['moments', 'day-only'])('written as %s', (form) => {
    it('valid: later days are accepted', () => {
      expect(
        validateTimelineCreate(
          withSteps(
            build(
              form,
              ['2026-11-10', '2026-11-12'],
              ['2026-11-13', '2026-11-14'],
            ),
          ),
          now,
        ),
      ).toEqual([]);
    });

    it('a closing before the opening is CLOSES_BEFORE_OPENS on the key that was sent', () => {
      expect(
        validateTimelineCreate(
          withSteps(
            build(
              form,
              ['2026-11-12', '2026-11-10'],
              ['2026-11-13', '2026-11-14'],
            ),
          ),
          now,
        ),
      ).toEqual([
        {
          field: `steps[0].${key(form, 'closes')}`,
          code: 'CLOSES_BEFORE_OPENS',
        },
      ]);
    });

    it('a step opening on the day the previous one closes is OVERLAPS_PREVIOUS_STEP on the key that was sent', () => {
      expect(
        validateTimelineCreate(
          withSteps(
            build(
              form,
              ['2026-11-10', '2026-11-12'],
              ['2026-11-12', '2026-11-14'],
            ),
          ),
          now,
        ),
      ).toEqual([
        {
          field: `steps[1].${key(form, 'opens')}`,
          code: 'OVERLAPS_PREVIOUS_STEP',
        },
      ]);
    });

    it('step 1 opening before now is BEFORE_TODAY on the key that was sent', () => {
      expect(
        validateTimelineCreate(
          withSteps(
            build(
              form,
              ['2026-11-09', '2026-11-12'],
              ['2026-11-13', '2026-11-14'],
            ),
          ),
          now,
        ),
      ).toEqual([
        { field: `steps[0].${key(form, 'opens')}`, code: 'BEFORE_TODAY' },
      ]);
    });

    it('a step with no closing value is REQUIRED on the key its other boundary used', () => {
      expect(
        validateTimelineCreate(
          withSteps(
            build(
              form,
              ['2026-11-10', '2026-11-12'],
              ['2026-11-13', undefined],
            ),
          ),
          now,
        ),
      ).toEqual([
        { field: `steps[1].${key(form, 'closes')}`, code: 'REQUIRED' },
      ]);
    });
  });
});

describe('FR-9 Both forms for the same moment (timeline-step-times)', () => {
  const now = createAt('2026-11-02T10:00');

  it.each([
    ['they differ', '2026-11-10T14:00', '2026-11-11'],
    ['they agree', '2026-11-10T00:00', '2026-11-10'],
  ])(
    'opensAt and opensOn together are INVALID on opensOn, even when %s',
    (_l, opensAt, opensOn) => {
      expect(
        validateTimelineCreate(
          withSteps(patchAt(0, { opensAt, opensOn })),
          now,
        ),
      ).toEqual([{ field: 'steps[0].opensOn', code: 'INVALID' }]);
    },
  );

  it.each([
    ['they differ', '2026-11-12T17:30', '2026-11-13'],
    ['they agree', '2026-11-12T23:59', '2026-11-12'],
  ])(
    'closesAt and closesOn together are INVALID on closesOn, even when %s',
    (_l, closesAt, closesOn) => {
      expect(
        validateTimelineCreate(
          withSteps(patchAt(0, { closesAt, closesOn })),
          now,
        ),
      ).toEqual([{ field: 'steps[0].closesOn', code: 'INVALID' }]);
    },
  );

  it('on an edit, both forms for one boundary are INVALID on the day-only key too', () => {
    expect(
      validateTimelineUpdate(
        storedTimes(),
        onStep1({ closesAt: '2026-11-12T18:00', closesOn: '2026-11-12' }),
        editContext('2026-11-02T10:00', true),
      ),
    ).toEqual([{ field: 'steps[0].closesOn', code: 'INVALID' }]);
  });
});

// --- the edit rules at minute level -----------------------------------------

/**
 * A stored timeline with real times:
 *   step 1  2026-11-10T09:00 to 2026-11-12T17:30
 *   step 2  2026-11-13T09:00 to 2026-11-14T17:00
 *   step 3  2026-11-16T09:00 to 2026-11-17T17:00
 */
function storedTimes(): StoredTimeline {
  const stored = storedTimeline();
  const times: Array<[string, string]> = [
    ['2026-11-10T09:00', '2026-11-12T17:30'],
    ['2026-11-13T09:00', '2026-11-14T17:00'],
    ['2026-11-16T09:00', '2026-11-17T17:00'],
  ];
  return {
    ...stored,
    steps: stored.steps.map((s, i) => ({
      ...s,
      opensAt: at(times[i]![0]),
      closesAt: at(times[i]![1]),
    })),
  };
}

const editContext = (now: string, hasLoad: boolean): TimelineUpdateContext => ({
  ...context,
  now: at(now),
  hasLoad,
});

describe('FR-6 Close an in-progress step now (timeline-step-times)', () => {
  // Now is 14:20:30 Rome, which the rules receive as the minute 14:20.
  const now = '2026-11-10T14:20';

  it('guard: step 1 is in progress at that minute, through the view', () => {
    const view = viewTimeline({
      steps: storedTimes().steps,
      assignedRoles: [],
      now: at(now),
      hasLoad: true,
    });
    expect(view.stepStates[1]).toBe('in_progress');
  });

  it('moving the closing moment to 2026-11-10T14:20 is accepted', () => {
    expect(
      validateTimelineUpdate(
        storedTimes(),
        onStep1({ closesAt: '2026-11-10T14:20' }),
        editContext(now, true),
      ),
    ).toEqual([]);
  });

  it('BUT 2026-11-10T14:19 is BEFORE_TODAY on closesAt', () => {
    expect(
      validateTimelineUpdate(
        storedTimes(),
        onStep1({ closesAt: '2026-11-10T14:19' }),
        editContext(now, true),
      ),
    ).toEqual([{ field: 'steps[0].closesAt', code: 'BEFORE_TODAY' }]);
  });

  it('an opening moment sent for the step in progress is LOCKED on opensAt', () => {
    expect(
      validateTimelineUpdate(
        storedTimes(),
        onStep1({ opensAt: '2026-11-10T09:30' }),
        editContext(now, true),
      ),
    ).toEqual([{ field: 'steps[0].opensAt', code: 'LOCKED' }]);
  });
});

describe('FR-6 Unchanged past moment (timeline-step-times)', () => {
  // On hold (no load), step 1 opened in the past on 10 Nov at 09:00.
  const hold = editContext('2026-11-11T10:00', false);

  it('only renaming the timeline succeeds', () => {
    expect(
      validateTimelineUpdate(storedTimes(), { name: 'Renamed' }, hold),
    ).toEqual([]);
  });

  it('sending the stored opening moment again is not a change', () => {
    expect(
      validateTimelineUpdate(
        storedTimes(),
        onStep1({ opensAt: '2026-11-10T09:00', closesAt: '2026-11-12T17:30' }),
        hold,
      ),
    ).toEqual([]);
  });

  it('a different past opening moment is a change and is BEFORE_TODAY on opensAt', () => {
    expect(
      validateTimelineUpdate(
        storedTimes(),
        onStep1({ opensAt: '2026-11-10T09:01' }),
        hold,
      ),
    ).toEqual([{ field: 'steps[0].opensAt', code: 'BEFORE_TODAY' }]);
  });
});

describe('FR-9 Day-only edit over a stored time (timeline-step-times)', () => {
  it('an edit that sends only steps[1].name keeps both moments of step 2', () => {
    const merged = mergeTimelineUpdate(storedTimes(), {
      steps: [{ position: 2, name: 'Renamed' }],
    });
    expect(merged.steps[1]).toEqual({
      position: 2,
      name: 'Renamed',
      opensAt: '2026-11-13T09:00',
      closesAt: '2026-11-14T17:00',
    });
  });

  it('BUT a closesOn equal to the stored date is a change to 23:59, not "unchanged"', () => {
    const request = onStep1({ closesOn: '2026-11-12' });
    const merged = mergeTimelineUpdate(storedTimes(), request);
    expect(merged.steps[0]?.closesAt).toBe('2026-11-12T23:59');
    // Step 1 closed at 17:30 on 12 Nov; at 12 Nov 18:00 it is closed, and the
    // change to 23:59 meets the lock instead of passing as unchanged.
    expect(
      validateTimelineUpdate(
        storedTimes(),
        request,
        editContext('2026-11-12T18:00', true),
      ),
    ).toEqual([{ field: 'steps[0].closesOn', code: 'LOCKED' }]);
  });

  it('the same closesOn on a step in progress is accepted and extends it to 23:59', () => {
    expect(
      validateTimelineUpdate(
        storedTimes(),
        onStep1({ closesOn: '2026-11-12' }),
        editContext('2026-11-10T14:20', true),
      ),
    ).toEqual([]);
  });
});

describe('errors name the key that was sent (DD-5)', () => {
  it('moments: an edit that makes the next step overlap names steps[1].opensAt', () => {
    expect(
      validateTimelineUpdate(
        storedTimes(),
        onStep1({ closesAt: '2026-11-13T09:00' }),
        editContext('2026-11-02T10:00', false),
      ),
    ).toEqual([{ field: 'steps[1].opensAt', code: 'OVERLAPS_PREVIOUS_STEP' }]);
  });

  it('day-only: the same edit names steps[1].opensOn', () => {
    expect(
      validateTimelineUpdate(
        storedTimes(),
        onStep1({ closesOn: '2026-11-13' }),
        editContext('2026-11-02T10:00', false),
      ),
    ).toEqual([{ field: 'steps[1].opensOn', code: 'OVERLAPS_PREVIOUS_STEP' }]);
  });

  it('a lock on a boundary sent as a moment names closesAt', () => {
    expect(
      validateTimelineUpdate(
        storedTimes(),
        onStep1({ closesAt: '2026-11-12T18:00' }),
        editContext('2026-11-12T18:00', true),
      ),
    ).toEqual([{ field: 'steps[0].closesAt', code: 'LOCKED' }]);
  });

  it('a DST hour sent on an edit names the key sent', () => {
    expect(
      validateTimelineUpdate(
        storedTimes(),
        {
          steps: [{ position: 3, closesAt: '2026-10-25T02:15' }],
        },
        editContext('2026-10-20T10:00', false),
      ),
    ).toEqual([{ field: 'steps[2].closesAt', code: 'DST_HOUR' }]);
  });
});

describe('one reader for the rules and the insert (timeline-step-times T-4)', () => {
  it('FR-1: a step with moments is read as exactly those moments', () => {
    expect(
      momentsOfStep(
        atStep('assessors', '2026-11-10T14:00', '2026-11-12T17:30', 1, true),
      ),
    ).toEqual({ opensAt: '2026-11-10T14:00', closesAt: '2026-11-12T17:30' });
  });

  it('FR-9: a day-only step is read as 00:00 and 23:59, and the forms may be mixed per boundary', () => {
    expect(
      momentsOfStep(step('assessors', '2026-11-10', '2026-11-12', 1, true)),
    ).toEqual({ opensAt: '2026-11-10T00:00', closesAt: '2026-11-12T23:59' });
    expect(
      momentsOfStep({
        ...atStep('assessors', '2026-11-10T14:00', undefined, 1, true),
        closesOn: '2026-11-12',
      }),
    ).toEqual({ opensAt: '2026-11-10T14:00', closesAt: '2026-11-12T23:59' });
  });

  it('a step the rules would refuse is not read (both forms, a DST hour)', () => {
    expect(() =>
      momentsOfStep({
        ...atStep('assessors', '2026-11-10T14:00', '2026-11-12T17:30', 1, true),
        opensOn: '2026-11-10',
      }),
    ).toThrow();
    expect(() =>
      momentsOfStep(
        atStep('assessors', '2027-03-28T02:30', '2027-03-29T09:00', 1, true),
      ),
    ).toThrow();
  });
});
