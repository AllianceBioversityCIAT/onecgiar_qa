import { DEMO_PROGRAMS } from '../../../core/domain/demo-programs';
// Mock data for the Overview view (QA lead), copied from the "QA Platform" mockup JS.
// TODO(api): replace every export here with data from the QA API. The view only reads these shapes.
// Note: timelines and result types are also used by the Cycle / Results views; each view keeps its
// own copy for now (a dev will unify them behind an API). Programs already share DEMO_PROGRAMS.

/** "Today" in the mockup. Every relative date (closes in N days) is computed against it. */
export const MOCK_TODAY = new Date(2026, 6, 19);

export const CYCLE_YEAR = 2026;

// ---------- Science programs and result types ----------

export const PROGRAMS = DEMO_PROGRAMS;

/** Result types with the number of submitted results of each type (official timeline). */
export const RESULT_TYPES: readonly (readonly [name: string, count: number])[] = [
  ['Knowledge product', 342],
  ['Innovation development', 261],
  ['Capacity sharing for development', 198],
  ['Other output', 74],
  ['Innovation use', 112],
  ['Policy change', 89],
  ['Other outcome', 38],
];

/** Results counted by RESULT_TYPES (denominator of the load estimate). */
export const OFFICIAL_RESULTS = 1114;

/** Order used when the load summary lists result types. */
export const RESULT_TYPE_ORDER = [
  'Knowledge product',
  'Innovation development',
  'Capacity sharing for development',
  'Innovation use',
  'Policy change',
  'Other output',
  'Other outcome',
] as const;

export const RESULT_TYPE_PLURAL: Readonly<Record<string, string>> = {
  'Knowledge product': 'knowledge products',
  'Innovation development': 'innovation development results',
  'Capacity sharing for development': 'capacity sharing results',
  'Innovation use': 'innovation use results',
  'Policy change': 'policy change results',
  'Other output': 'other output results',
  'Other outcome': 'other outcome results',
};

/** Platform settings → result types: the step each type joins at, and whether it is auto-approved. */
export interface ResultTypeRule {
  readonly phase: number;
  readonly auto: boolean;
}
export const RESULT_TYPE_RULES: Readonly<Record<string, ResultTypeRule>> = Object.fromEntries(
  RESULT_TYPE_ORDER.map((t) => [t, t === 'Knowledge product' ? { phase: 3, auto: true } : { phase: 1, auto: false }]),
);

/** How many results of a type are auto-approved (fallback: a quarter of the type). */
export const AUTO_APPROVED: Readonly<Record<string, number>> = { 'Knowledge product': 84 };

// ---------- Timelines ----------

export const PHASE_NAMES = [
  'QA platform open for assessors',
  'Science programs correct in the reporting tool',
  'QA platform open for lead assessor',
  'QA platform open for third-party broker',
  'QA platform open for PPU',
] as const;

/** Short step names for labels under the Timelines bar, in PHASE_NAMES order. */
export const PHASE_SHORT: Readonly<Record<string, string>> = {
  [PHASE_NAMES[0]]: 'Assessors',
  [PHASE_NAMES[1]]: 'Programs correct',
  [PHASE_NAMES[2]]: 'Lead assessor',
  [PHASE_NAMES[3]]: 'Third-party broker',
  [PHASE_NAMES[4]]: 'PPU',
};

export type TimelineStatus = 'Live' | 'Scheduled' | 'Closed';
export type TimelineKind = 'Official timeline' | 'Sub-timeline';

export interface TimelinePhase {
  readonly name: string;
  readonly start: string;
  readonly end: string;
  /** Summary once the step has finished ("1,114 assessed · 418 returned"). */
  readonly done?: string;
  /** Progress of the step that is open now. */
  readonly active?: { readonly pct: number; readonly done: number; readonly of: number };
}

export interface Timeline {
  readonly id: string;
  readonly name: string;
  readonly kind: TimelineKind;
  readonly status: TimelineStatus;
  readonly test?: boolean;
  readonly results: number;
  readonly programs: readonly string[];
  readonly types: readonly string[];
  readonly phases: readonly TimelinePhase[];
}

const P = (i: number, start: string, end: string, done?: string): TimelinePhase => ({ name: PHASE_NAMES[i], start, end, done });

// Live timelines add up to the 1,330 results in QA (989 + 216 + 84 + 41). Each one has its own steps:
// a sub-timeline can skip steps, so "Step 2 of 3" is as valid as "Step 4 of 5".
export const TIMELINES: readonly Timeline[] = [
  {
    id: 'annual', name: 'Annual report 2026', kind: 'Official timeline', status: 'Live', results: 989,
    programs: [], types: [],
    phases: [
      P(0, '02 Mar 2026', '27 Mar 2026', '989 assessed · 372 returned'),
      P(1, '30 Mar 2026', '17 Apr 2026', '372 answered · 38 unchanged'),
      P(2, '20 Apr 2026', '24 Apr 2026', '85 highlighted'),
      { ...P(3, '06 Jul 2026', '23 Jul 2026'), active: { pct: 88, done: 870, of: 989 } },
      P(4, '24 Jul 2026', '07 Aug 2026'),
    ],
  },
  {
    id: 'jul', name: 'July 2026 sub-timeline', kind: 'Sub-timeline', status: 'Live', results: 216,
    programs: ['SP02', 'SP05'], types: [],
    phases: [
      { ...P(0, '06 Jul 2026', '23 Jul 2026'), active: { pct: 34, done: 74, of: 216 } },
      P(1, '24 Jul 2026', '28 Jul 2026'), P(2, '29 Jul 2026', '30 Jul 2026'), P(3, '31 Jul 2026', '03 Aug 2026'), P(4, '04 Aug 2026', '10 Aug 2026'),
    ],
  },
  {
    id: 'kp', name: 'Knowledge products fast track', kind: 'Sub-timeline', status: 'Live', results: 84,
    programs: [], types: ['Knowledge product'],
    phases: [
      P(0, '29 Jun 2026', '10 Jul 2026', '84 assessed · 31 returned'),
      { ...P(1, '13 Jul 2026', '28 Jul 2026'), active: { pct: 40, done: 34, of: 84 } },
      P(4, '29 Jul 2026', '07 Aug 2026'),
    ],
  },
  {
    id: 'sp03', name: 'SP03 late reporting', kind: 'Sub-timeline', status: 'Live', results: 41,
    programs: ['SP03'], types: [],
    phases: [
      { ...P(0, '13 Jul 2026', '02 Aug 2026'), active: { pct: 12, done: 5, of: 41 } },
      P(1, '03 Aug 2026', '07 Aug 2026'), P(2, '10 Aug 2026', '11 Aug 2026'), P(4, '12 Aug 2026', '18 Aug 2026'),
    ],
  },
  {
    id: 'sep', name: 'September pilot', kind: 'Sub-timeline', status: 'Scheduled', test: true, results: 0,
    programs: ['SP09'], types: [],
    phases: [
      P(0, '01 Sep 2026', '03 Sep 2026'), P(1, '04 Sep 2026', '06 Sep 2026'), P(2, '07 Sep 2026', '08 Sep 2026'),
      P(3, '09 Sep 2026', '10 Sep 2026'), P(4, '11 Sep 2026', '12 Sep 2026'),
    ],
  },
  {
    id: 'c25a', name: 'Annual report 2025', kind: 'Official timeline', status: 'Closed', results: 986, programs: [], types: [],
    phases: [
      P(0, '04 Mar 2025', '28 Mar 2025', '986 assessed · 371 returned'), P(1, '31 Mar 2025', '17 Apr 2025', '371 answered · 38 unchanged'),
      P(2, '22 Apr 2025', '25 Apr 2025', '84 highlighted'), P(3, '28 Apr 2025', '06 May 2025', '84 corrected'), P(4, '07 May 2025', '12 Jun 2025', '986 closed'),
    ],
  },
  {
    id: 'c25n', name: 'May 2025 sub-timeline', kind: 'Sub-timeline', status: 'Closed', results: 142, programs: ['SP04', 'SP11'], types: [],
    phases: [
      P(0, '12 May 2025', '16 May 2025', '142 assessed · 27 returned'), P(1, '19 May 2025', '22 May 2025', '27 answered · 2 unchanged'),
      P(2, '23 May 2025', '26 May 2025', '9 highlighted'), P(3, '27 May 2025', '28 May 2025', '9 corrected'), P(4, '29 May 2025', '30 May 2025', '142 closed'),
    ],
  },
  {
    id: 'c24a', name: 'Annual report 2024', kind: 'Official timeline', status: 'Closed', results: 874, programs: [], types: [],
    phases: [
      P(0, '26 Feb 2024', '22 Mar 2024', '874 assessed · 302 returned'), P(1, '25 Mar 2024', '12 Apr 2024', '302 answered · 31 unchanged'),
      P(2, '15 Apr 2024', '18 Apr 2024', '70 highlighted'), P(3, '22 Apr 2024', '30 Apr 2024', '70 corrected'), P(4, '02 May 2024', '30 May 2024', '874 closed'),
    ],
  },
];

// ---------- Results in QA ----------

export type ResultStatus = 'Pending' | 'In review' | 'Awaiting response' | 'Answered' | 'Quality assessed';

export const STATUS_COUNTS: readonly (readonly [status: ResultStatus, count: number])[] = [
  ['Pending', 148],
  ['In review', 312],
  ['Awaiting response', 212],
  ['Answered', 301],
  ['Quality assessed', 357],
];

// ---------- Stages ----------

/** What closes each stage, by stage name. Each timeline has its own stages; a stage not listed here shows no condition. */
export const STAGE_CRITERIA: Readonly<Record<string, string>> = {
  [PHASE_NAMES[0]]: 'Closes when every assigned assessor has reviewed all of their results.',
  [PHASE_NAMES[1]]: 'Closes when every returned result has been corrected in the reporting tool or the window ends.',
  [PHASE_NAMES[2]]: 'Closes when every escalated case has a decision from a lead assessor.',
  [PHASE_NAMES[3]]: 'Closes when every highlighted field has a final decision from a broker.',
  [PHASE_NAMES[4]]: 'Closes when PPU has closed every result in the timeline.',
};

// ---------- Needs attention ----------

/** Text segment: [text, subject]. Subject segments (SP05, Assessor LM) are the only bold words. */
export type AttentionSegment = readonly [text: string, subject?: boolean];

/** Where the admin fixes the problem: assign or reassign people, or move a step date. */
export type AttentionPath = '/assessors' | '/cycle';

/**
 * Something the admin can fix in QA before a step closes. Rows she can only watch
 * (nothing she does changes them) belong in the other Overview blocks, not here.
 */
export interface AttentionRow {
  /** Results affected; breaks ties between rows that close on the same day. */
  readonly sev?: number;
  readonly text: string;
  readonly segs: readonly AttentionSegment[];
  /** "July 2026 sub-timeline · Step 1": the timeline and the open step the row belongs to. */
  readonly context: string;
  /** Day the step closes ("23 Jul 2026"); rows are sorted by it. */
  readonly closes: string;
  readonly label: string;
  readonly path: AttentionPath;
}

export type AttentionGroupKey = 'unreviewed' | 'risk';

export interface AttentionGroup {
  readonly key: AttentionGroupKey;
  readonly name: string;
  readonly rows: readonly AttentionRow[];
}

// TODO(api): build these rows from assignments, sign-ins and step progress per timeline.
// "Waiting on a program" stays out until business confirms what happens to unanswered
// results when the correction window closes (docs/ideas.md).
export const ATTENTION: readonly AttentionGroup[] = [
  {
    key: 'unreviewed', name: "Won't be reviewed",
    rows: [
      { sev: 40, text: 'Assessor LM has never signed in. 40 results are assigned to them.', segs: [['Assessor LM', true], [' has never signed in. 40 results are assigned to them.']], context: 'July 2026 sub-timeline · Step 1', closes: '23 Jul 2026', label: 'Open Assessors', path: '/assessors' },
      { sev: 26, text: 'Innovation use has no active assessor. 26 results are waiting for one.', segs: [['Innovation use', true], [' has no active assessor. 26 results are waiting for one.']], context: 'SP03 late reporting · Step 1', closes: '02 Aug 2026', label: 'Open Assessors', path: '/assessors' },
    ],
  },
  {
    key: 'risk', name: 'At risk before the stage closes',
    rows: [
      { sev: 67, text: 'Assessor DD has assessed 21 of 88 knowledge products.', segs: [['Assessor DD', true], [' has assessed 21 of 88 knowledge products.']], context: 'July 2026 sub-timeline · Step 1', closes: '23 Jul 2026', label: 'Open Assessors', path: '/assessors' },
      { sev: 119, text: 'Annual report 2026: 119 results are still with the third-party broker.', segs: [['Annual report 2026', true], [': 119 results are still with the third-party broker.']], context: 'Annual report 2026 · Step 4', closes: '23 Jul 2026', label: 'Open Cycle', path: '/cycle' },
      { sev: 25, text: 'SP05 has corrected 6 of 31 returned knowledge products.', segs: [['SP05', true], [' has corrected 6 of 31 returned knowledge products.']], context: 'Knowledge products fast track · Step 2', closes: '28 Jul 2026', label: 'Open Cycle', path: '/cycle' },
    ],
  },
];

// ---------- Assessment pace ----------

/** Results done in a timeline's open step, day by day, from the day it opened until today. */
export interface PaceSeries {
  readonly timelineId: string;
  /** Cumulative results done in the step, one value per day from the step's start to MOCK_TODAY. */
  readonly done: readonly number[];
}

// TODO(api): daily history of results done per open step (needs a back-end endpoint).
export const PACE: readonly PaceSeries[] = [
  { timelineId: 'jul', done: [0, 3, 8, 14, 20, 27, 34, 41, 47, 54, 59, 64, 69, 74] },
  { timelineId: 'annual', done: [700, 715, 731, 744, 760, 773, 786, 799, 811, 824, 836, 848, 859, 870] },
  { timelineId: 'kp', done: [0, 3, 7, 13, 19, 26, 34] },
  { timelineId: 'sp03', done: [0, 0, 1, 2, 3, 4, 5] },
];

// ---------- Assessor load ----------

/** Results assigned to an assessor in timelines whose open step is the assessors' step. */
export interface AssessorLoad {
  readonly name: string;
  readonly done: number;
  readonly left: number;
  readonly neverSignedIn?: boolean;
}

// TODO(api): assignments per assessor for the timelines in the assessors' step.
// Totals match the Timelines block: 74 + 5 done and 142 + 36 left (July sub-timeline and SP03).
export const ASSESSOR_LOAD: readonly AssessorLoad[] = [
  { name: 'Assessor DD', done: 21, left: 67 },
  { name: 'Assessor LM', done: 0, left: 40, neverSignedIn: true },
  { name: 'Assessor KR', done: 20, left: 25 },
  { name: 'Assessor JS', done: 5, left: 20 },
  { name: 'Assessor PA', done: 18, left: 18 },
  { name: 'Assessor MT', done: 15, left: 8 },
];

// ---------- Load results into QA ----------

export interface LoadTarget {
  readonly id: string;
  readonly label: string;
  readonly desc: string;
  /** True when the target is the first step of its timeline. */
  readonly first: boolean;
}

export const LOAD_TARGETS: readonly LoadTarget[] = [
  { id: 'jul:0', label: 'July 2026 sub-timeline · QA platform open for assessors', desc: 'Open · closes 23 Jul', first: true },
  { id: 'annual:4', label: 'Annual report 2026 · QA platform open for PPU', desc: 'Opens 24 Jul', first: false },
  { id: 'sep:0', label: 'September pilot · QA platform open for assessors', desc: 'Opens 01 Sep', first: true },
];

/** Submitted results available to load, and how many of them are already in QA. */
export const LOAD_SUBMITTED = 1200;
export const LOAD_ALREADY_IN_QA = 86;
