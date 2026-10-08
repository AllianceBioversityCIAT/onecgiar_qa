// Mock data for the Cycle view, copied from the "QA Platform" mockup (OFFICIAL0, CY_BATCHES,
// CYCLE_LIST, RUN_TARGETS, DEMO_ACCESS, PROG_ROWS, PROGRAMS, TYPES, ST_DEFAULT.rtypes…).
// TODO(api): replace with the cycle / timeline endpoints. PROGRAMS and RESULT_TYPES are local
// copies of data other views also use (Results, Assessors, Fields).

export type TimelineKind = 'Official' | 'Official timeline' | 'Sub-timeline';
export type TimelineStatus = 'Live' | 'Scheduled' | 'Closed';
export type ReopenMode = 'comments' | 'all';

export interface ExtendedAccess {
  code: string;
  range: string;
}

/** One step ("phase" in the mockup) of a timeline. Dates use the mockup format "06 Jul 2026". */
export interface CycleStep {
  name: string;
  /** Who can work in the step (one of AUDIENCES). */
  audience: string;
  start: string;
  /** Empty when the step has no closing date (last step). */
  end: string;
  /** Summary shown on a completed step ("1,114 assessed · 418 returned"). */
  done?: string;
  /** Progress of the step that is running now. */
  active?: { pct: number; done: number; of: number };
  /** The step loads results when it opens (starts a QA round). */
  batch: boolean;
  /** "Results loaded on 06 Jul · 216 results" once the load ran. */
  ran: string;
  reopen?: ReopenMode;
  access?: ExtendedAccess[];
}

export interface Timeline {
  id: string;
  name: string;
  kind: TimelineKind;
  status: TimelineStatus;
  test?: boolean;
  results: number;
  programs: string[];
  types: string[];
  steps: CycleStep[];
  created?: boolean;
}

export interface CycleSummary {
  name: string;
  range: string;
  results: number;
  active?: boolean;
}

export interface RunTarget {
  /** "<timelineId>:<stepIndex>" */
  id: string;
  label: string;
  desc: string;
  first: boolean;
}

export interface ProgramProgress {
  code: string;
  done: number;
  of: number;
}

export interface ResultTypeRule {
  /** Step (1-based) where results of this type join the timeline. */
  phase: number;
  /** Auto-approved on load (status "Automatic"). */
  auto: boolean;
}

/** Fixed "today" of the mockup, used to compute step states ("Opens in 44 days"). */
export const TODAY = new Date(2026, 6, 19);

export const ACTIVE_CYCLE = { name: '2026 cycle', range: '02 Mar – 19 Jul 2026', results: 1114 } as const;

export const PROGRAMS: Readonly<Record<string, string>> = {
  SP01: 'Breeding for Tomorrow',
  SP02: 'Rice Agrifood Systems',
  SP04: 'Climate Action',
  SP05: 'Multifunctional Landscapes',
  SP07: 'Genetic Innovation',
  SP09: 'Sustainable Animal and Aquatic Foods',
  SP11: 'Policy Innovations',
  SP12: 'Scaling for Impact',
};

/** Result types with the number of results of each type in the cycle (1,114 in total). */
export const RESULT_TYPES: readonly (readonly [string, number])[] = [
  ['Knowledge product', 342],
  ['Innovation development', 261],
  ['Capacity sharing for development', 198],
  ['Other output', 74],
  ['Innovation use', 112],
  ['Policy change', 89],
  ['Other outcome', 38],
];
export const TOTAL_RESULTS = 1114;

/** Order used for the "join here" and load summary lines. */
export const RT_ORDER = [
  'Knowledge product',
  'Innovation development',
  'Capacity sharing for development',
  'Innovation use',
  'Policy change',
  'Other output',
  'Other outcome',
] as const;

export const RT_PLURAL: Readonly<Record<string, string>> = {
  'Knowledge product': 'knowledge products',
  'Innovation development': 'innovation development results',
  'Capacity sharing for development': 'capacity sharing results',
  'Innovation use': 'innovation use results',
  'Policy change': 'policy change results',
  'Other output': 'other output results',
  'Other outcome': 'other outcome results',
};
export const RT_SHORT: Readonly<Record<string, string>> = { 'Knowledge product': 'Knowledge products' };
export const RT_AUTO_N: Readonly<Record<string, number>> = { 'Knowledge product': 84 };

/** Settings > Result types defaults: knowledge products join at step 3 and are auto-approved. */
export const RESULT_TYPE_RULES: Readonly<Record<string, ResultTypeRule>> = Object.fromEntries(
  RT_ORDER.map((t) => [t, t === 'Knowledge product' ? { phase: 3, auto: true } : { phase: 1, auto: false }]),
);

export const CORRECTION_AUDIENCE = 'Nobody in QA';
export const AUDIENCES = ['Assessors', CORRECTION_AUDIENCE, 'Lead assessor', 'Third-party broker', 'PPU'] as const;
export const STEP_NAMES = [
  'QA platform open for assessors',
  'Science programs correct in the reporting tool',
  'QA platform open for lead assessor',
  'QA platform open for third-party broker',
  'QA platform open for PPU',
] as const;

const step = (i: number, start: string, end: string, done?: string, batch?: boolean, ran?: string): CycleStep => ({
  name: STEP_NAMES[i],
  audience: AUDIENCES[i],
  start,
  end,
  done,
  batch: !!batch,
  ran: ran ?? '',
});

export const OFFICIAL_TIMELINE: Timeline = {
  id: 'official',
  name: 'Official timeline',
  kind: 'Official',
  status: 'Live',
  results: 1114,
  programs: [],
  types: [],
  steps: [
    step(0, '02 Mar 2026', '27 Mar 2026', '1,114 assessed · 418 returned', true),
    step(1, '30 Mar 2026', '17 Apr 2026', '418 answered · 43 unchanged'),
    step(2, '20 Apr 2026', '24 Apr 2026', '96 highlighted', true),
    step(3, '27 Apr 2026', '05 May 2026', '96 corrected'),
    { ...step(4, '06 May 2026', '19 Jul 2026'), active: { pct: 94, done: 1047, of: 1114 } },
  ],
};

export const TIMELINES: Timeline[] = [
  {
    id: 'jul',
    name: 'July 2026 sub-timeline',
    kind: 'Sub-timeline',
    status: 'Live',
    results: 216,
    programs: ['SP02', 'SP05'],
    types: ['Innovation development', 'Knowledge product'],
    steps: [
      step(0, '06 Jul 2026', '11 Jul 2026', '214 assessed · 38 returned', true, 'Results loaded on 06 Jul · 216 results'),
      step(1, '11 Jul 2026', '14 Jul 2026', '38 answered · 4 unchanged'),
      step(2, '15 Jul 2026', '16 Jul 2026', '12 highlighted', true, 'Results loaded on 15 Jul · 38 results'),
      step(3, '17 Jul 2026', '18 Jul 2026', '12 corrected'),
      { ...step(4, '19 Jul 2026', ''), active: { pct: 62, done: 134, of: 216 } },
    ],
  },
  {
    id: 'sep',
    name: 'September pilot',
    kind: 'Sub-timeline',
    status: 'Scheduled',
    test: true,
    results: 0,
    programs: ['SP09'],
    types: [],
    steps: [
      step(0, '01 Sep 2026', '03 Sep 2026', undefined, true),
      step(1, '04 Sep 2026', '06 Sep 2026'),
      step(2, '07 Sep 2026', '08 Sep 2026', undefined, true),
      step(3, '09 Sep 2026', '10 Sep 2026'),
      step(4, '11 Sep 2026', '12 Sep 2026'),
    ],
  },
  {
    id: 'annual',
    name: 'Annual report 2026',
    kind: 'Official timeline',
    status: 'Live',
    results: 1114,
    programs: [],
    types: [],
    steps: [
      step(0, '02 Mar 2026', '27 Mar 2026', '1,114 assessed · 418 returned', true, 'Results loaded on 02 Mar · 1,114 results'),
      step(1, '30 Mar 2026', '17 Apr 2026', '418 answered · 43 unchanged'),
      step(2, '20 Apr 2026', '24 Apr 2026', '96 highlighted', true, 'Results loaded on 20 Apr · 461 results'),
      step(3, '27 Apr 2026', '05 May 2026', '96 corrected'),
      { ...step(4, '06 May 2026', '19 Jul 2026'), active: { pct: 94, done: 1047, of: 1114 } },
    ],
  },
  {
    id: 'c25a',
    name: 'Annual report 2025',
    kind: 'Official timeline',
    status: 'Closed',
    results: 986,
    programs: [],
    types: [],
    steps: [
      step(0, '04 Mar 2025', '28 Mar 2025', '986 assessed · 371 returned', true),
      step(1, '31 Mar 2025', '17 Apr 2025', '371 answered · 38 unchanged'),
      step(2, '22 Apr 2025', '25 Apr 2025', '84 highlighted', true),
      step(3, '28 Apr 2025', '06 May 2025', '84 corrected'),
      step(4, '07 May 2025', '12 Jun 2025', '986 closed'),
    ],
  },
  {
    id: 'c25n',
    name: 'May 2025 sub-timeline',
    kind: 'Sub-timeline',
    status: 'Closed',
    results: 142,
    programs: ['SP04', 'SP11'],
    types: [],
    steps: [
      step(0, '12 May 2025', '16 May 2025', '142 assessed · 27 returned', true),
      step(1, '19 May 2025', '22 May 2025', '27 answered · 2 unchanged'),
      step(2, '23 May 2025', '26 May 2025', '9 highlighted', true),
      step(3, '27 May 2025', '28 May 2025', '9 corrected'),
      step(4, '29 May 2025', '30 May 2025', '142 closed'),
    ],
  },
  {
    id: 'c24a',
    name: 'Annual report 2024',
    kind: 'Official timeline',
    status: 'Closed',
    results: 874,
    programs: [],
    types: [],
    steps: [
      step(0, '26 Feb 2024', '22 Mar 2024', '874 assessed · 302 returned', true),
      step(1, '25 Mar 2024', '12 Apr 2024', '302 answered · 31 unchanged'),
      step(2, '15 Apr 2024', '18 Apr 2024', '70 highlighted', true),
      step(3, '22 Apr 2024', '30 Apr 2024', '70 corrected'),
      step(4, '02 May 2024', '30 May 2024', '874 closed'),
    ],
  },
];

/** Closed timelines that exist beyond the ones listed ("Showing 3 of 14 closed timelines"). */
export const CLOSED_EXTRA = 11;

export const CYCLE_LIST: readonly CycleSummary[] = [
  { name: '2026 cycle', range: '02 Mar – 19 Jul 2026', results: 1114, active: true },
  { name: '2025 cycle', range: '04 Mar – 12 Jun 2025', results: 986 },
  { name: '2024 cycle', range: '26 Feb – 30 May 2024', results: 874 },
];

export const RUN_TARGETS: readonly RunTarget[] = [
  { id: 'jul:0', label: 'July 2026 sub-timeline · QA platform open for assessors', desc: 'Open · closes 11 Jul', first: true },
  { id: 'annual:2', label: 'Annual report 2026 · QA platform open for lead assessor', desc: 'Opens 20 Apr', first: false },
  { id: 'sep:0', label: 'September pilot · QA platform open for assessors', desc: 'Opens 01 Sep', first: true },
];

/** Default dates of a new sub-timeline. */
export const DEFAULT_STEP_DATES: readonly (readonly [string, string])[] = [
  ['01 Sep 2026', '05 Sep 2026'],
  ['07 Sep 2026', '11 Sep 2026'],
  ['14 Sep 2026', '15 Sep 2026'],
  ['16 Sep 2026', '17 Sep 2026'],
  ['18 Sep 2026', ''],
];

/** Extended access sample shown on every existing step. */
export const DEMO_ACCESS: readonly ExtendedAccess[] = [
  { code: 'SP05', range: '20 Jul – 24 Jul 2026' },
  { code: 'SP09', range: '20 Jul – 22 Jul 2026' },
];

/** The mockup uses the same per-program sample rows in every "View progress" drawer. */
export const PROGRAM_PROGRESS: readonly ProgramProgress[] = [
  { code: 'SP09', done: 8, of: 41 },
  { code: 'SP02', done: 19, of: 58 },
  { code: 'SP05', done: 24, of: 47 },
  { code: 'SP11', done: 28, of: 34 },
  { code: 'SP07', done: 30, of: 31 },
  { code: 'SP04', done: 25, of: 25 },
];
