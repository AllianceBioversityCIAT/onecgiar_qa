// Mock data for the Cycle view, copied from the "QA Platform" mockup (OFFICIAL0, CY_BATCHES,
// RUN_TARGETS, DEMO_ACCESS, PROG_ROWS, PROGRAMS, TYPES, ST_DEFAULT.rtypes…).
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

export const PROGRAMS: Readonly<Record<string, string>> = {
  SP01: 'Breeding for Tomorrow',
  SP02: 'Sustainable Farming',
  SP03: 'Sustainable Animal and Aquatic Foods',
  SP04: 'Multifunctional Landscapes',
  SP05: 'Better Diets and Nutrition',
  SP06: 'Climate Action',
  SP07: 'Policy Innovations',
  SP08: 'Food Frontiers and Security',
  SP09: 'Scaling for Impact',
  SP10: 'Gender Equality and Inclusion',
  SP11: 'Capacity Sharing',
  SP12: 'Digital Transformation',
  SP13: 'Genebank',
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
  name: 'Annual report 2026',
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
    id: 'may',
    name: 'May 2026 sub-timeline',
    kind: 'Sub-timeline',
    status: 'Closed',
    results: 142,
    programs: ['SP04', 'SP11'],
    types: [],
    steps: [
      step(0, '11 May 2026', '15 May 2026', '142 assessed · 27 returned', true),
      step(1, '18 May 2026', '21 May 2026', '27 answered · 2 unchanged'),
      step(2, '22 May 2026', '25 May 2026', '9 highlighted', true),
      step(3, '26 May 2026', '27 May 2026', '9 corrected'),
      step(4, '28 May 2026', '29 May 2026', '142 closed'),
    ],
  },
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
