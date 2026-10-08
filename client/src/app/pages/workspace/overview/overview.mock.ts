// Mock data for the Overview view (QA lead), copied from the "QA Platform" mockup JS.
// TODO(api): replace every export here with data from the QA API. The view only reads these shapes.
// Note: timelines, programs and result types are also used by the Cycle / Results views; each view
// keeps its own copy for now (a dev will unify them behind an API).

/** "Today" in the mockup. Every relative date (closes in N days) is computed against it. */
export const MOCK_TODAY = new Date(2026, 6, 19);

export const CYCLE_YEAR = 2026;

// ---------- Science programs and result types ----------

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

export const TIMELINES: readonly Timeline[] = [
  {
    id: 'jul', name: 'July 2026 sub-timeline', kind: 'Sub-timeline', status: 'Live', results: 216,
    programs: ['SP02', 'SP05'], types: ['Innovation development', 'Knowledge product'],
    phases: [
      P(0, '06 Jul 2026', '11 Jul 2026', '214 assessed · 38 returned'),
      P(1, '11 Jul 2026', '14 Jul 2026', '38 answered · 4 unchanged'),
      P(2, '15 Jul 2026', '16 Jul 2026', '12 highlighted'),
      P(3, '17 Jul 2026', '18 Jul 2026', '12 corrected'),
      { ...P(4, '19 Jul 2026', ''), active: { pct: 62, done: 134, of: 216 } },
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
    id: 'annual', name: 'Annual report 2026', kind: 'Official timeline', status: 'Live', results: 1114,
    programs: [], types: [],
    phases: [
      P(0, '02 Mar 2026', '27 Mar 2026', '1,114 assessed · 418 returned'),
      P(1, '30 Mar 2026', '17 Apr 2026', '418 answered · 43 unchanged'),
      P(2, '20 Apr 2026', '24 Apr 2026', '96 highlighted'),
      P(3, '27 Apr 2026', '05 May 2026', '96 corrected'),
      { ...P(4, '06 May 2026', '19 Jul 2026'), active: { pct: 94, done: 1047, of: 1114 } },
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

// ---------- Stage completion ----------

export interface Stage {
  readonly name: string;
  readonly criterion: string;
  /** Done / total for the July sub-timeline (216 results); the view scales them to the timeline. */
  readonly done: number;
  readonly of: number;
  readonly word: string;
  readonly closed: boolean;
  /** Result statuses the row opens in Results. */
  readonly statuses: readonly ResultStatus[];
  /** % of the stage window already elapsed (below it the stage is "Behind"). */
  readonly elapsed?: number;
}

/** Results the stage numbers above are based on. */
export const STAGE_BASE = 216;

export const STAGES: readonly Stage[] = [
  { name: 'Assessor review', criterion: 'Closes when every assigned assessor has reviewed all of their results.', done: 216, of: 216, word: 'reviewed', closed: true, statuses: ['Pending', 'In review'] },
  { name: 'Science program corrections', criterion: 'Closes when every returned result has been corrected in the reporting tool or the window ends.', done: 31, of: 38, word: 'corrected', closed: true, statuses: ['Awaiting response'] },
  { name: 'Lead assessor review', criterion: 'Closes when every escalated case has a decision from a lead assessor.', done: 12, of: 12, word: 'decided', closed: true, statuses: ['Answered'] },
  { name: 'Third-party broker decisions', criterion: 'Closes when every highlighted field has a final decision from a broker.', done: 12, of: 12, word: 'decided', closed: true, statuses: ['In review'] },
  { name: 'PPU closure', criterion: 'Closes when PPU has closed every result in the timeline.', done: 134, of: 216, word: 'closed', closed: false, statuses: ['Answered'], elapsed: 55 },
];

// ---------- Needs attention ----------

/** % of the current stage window already elapsed; pace alerts fire 30 points below it. */
export const PHASE_ELAPSED = 60;

/** Text segment: [text, mono]. Mono segments are the numbers and names in bold mono. */
export type AttentionSegment = readonly [text: string, mono?: boolean];

export type AttentionTarget =
  | { readonly kind: 'route'; readonly path: '/assessors' }
  | { readonly kind: 'status'; readonly statuses: readonly ResultStatus[] }
  | { readonly kind: 'risk'; readonly key: string };

export interface AttentionRow {
  readonly sev?: number;
  readonly pct?: number;
  readonly text: string;
  readonly segs: readonly AttentionSegment[];
  readonly label: string;
  readonly to: AttentionTarget;
}

export type AttentionGroupKey = 'coverage' | 'pace' | 'waiting';

export interface AttentionGroup {
  readonly key: AttentionGroupKey;
  readonly name: string;
  readonly rows: readonly AttentionRow[];
}

export const ATTENTION: readonly AttentionGroup[] = [
  {
    key: 'coverage', name: 'Coverage',
    rows: [
      { sev: 299, text: '2 result types have no active assessor. 299 results will not be reviewed.', segs: [['2', true], [' result types have no active assessor. '], ['299', true], [' results will not be reviewed.']], label: 'Go to Assessors', to: { kind: 'route', path: '/assessors' } },
      { sev: 64, text: 'Assessor LM has never signed in. 64 results are assigned to them.', segs: [['Assessor LM', true], [' has never signed in. '], ['64', true], [' results are assigned to them.']], label: 'Go to Assessors', to: { kind: 'route', path: '/assessors' } },
    ],
  },
  {
    key: 'pace', name: 'Pace',
    rows: [
      { pct: 20, text: 'Capacity sharing for development is 20% reviewed with 4 days left.', segs: [['Capacity sharing for development is '], ['20%', true], [' reviewed with '], ['4', true], [' days left.']], label: 'See the assessor', to: { kind: 'risk', key: 'type:Capacity sharing for development' } },
      { pct: 19, text: 'SP09 has corrected 6 of 31 returned results with 2 days left.', segs: [['SP09', true], [' has corrected '], ['6', true], [' of '], ['31', true], [' returned results with '], ['2', true], [' days left.']], label: 'See SP09', to: { kind: 'risk', key: 'program:SP09' } },
      { pct: 24, text: 'Assessor DD is 24% through 88 knowledge products.', segs: [['Assessor DD', true], [' is '], ['24%', true], [' through '], ['88', true], [' knowledge products.']], label: 'See their results', to: { kind: 'risk', key: 'assessor:Assessor DD' } },
    ],
  },
  {
    key: 'waiting', name: 'Waiting',
    rows: [
      { sev: 14, text: '212 returned results have been waiting on a program for more than 14 days.', segs: [['212', true], [' returned results have been waiting on a program for more than '], ['14', true], [' days.']], label: 'See them', to: { kind: 'status', statuses: ['Awaiting response'] } },
    ],
  },
];

// ---------- Where the work is ----------

export type Pace = 'On track' | 'Behind' | 'At risk';

export interface WorkRow {
  /** Result type name, program code or assessor nickname. */
  readonly key: string;
  /** Assessor full name (assessor rows only). */
  readonly person?: string;
  readonly pct: number;
  /** Pending results for "All timelines" (1,330 results); the view scales them to the timeline. */
  readonly pending: number;
  readonly pace: Pace;
}

export const WORK_BASE = 1330;

export const WORK_BY: Readonly<Record<'type' | 'program' | 'assessor', readonly WorkRow[]>> = {
  type: [
    { key: 'Capacity sharing for development', pct: 20, pending: 158, pace: 'At risk' },
    { key: 'Innovation development', pct: 31, pending: 180, pace: 'At risk' },
    { key: 'Knowledge product', pct: 54, pending: 157, pace: 'Behind' },
    { key: 'Innovation use', pct: 68, pending: 36, pace: 'Behind' },
    { key: 'Policy change', pct: 86, pending: 12, pace: 'On track' },
    { key: 'Other output', pct: 91, pending: 7, pace: 'On track' },
    { key: 'Other outcome', pct: 97, pending: 1, pace: 'On track' },
  ],
  program: [
    { key: 'SP09', pct: 19, pending: 152, pace: 'At risk' },
    { key: 'SP02', pct: 33, pending: 143, pace: 'At risk' },
    { key: 'SP11', pct: 51, pending: 59, pace: 'Behind' },
    { key: 'SP05', pct: 64, pending: 53, pace: 'Behind' },
    { key: 'SP07', pct: 78, pending: 29, pace: 'On track' },
    { key: 'SP04', pct: 88, pending: 12, pace: 'On track' },
    { key: 'SP01', pct: 94, pending: 6, pace: 'On track' },
  ],
  assessor: [
    { key: 'Assessor LM', person: 'L. Mwangi', pct: 0, pending: 64, pace: 'At risk' },
    { key: 'Assessor DD', person: 'D. Okeke', pct: 24, pending: 67, pace: 'At risk' },
    { key: 'Assessor RS', person: 'R. Silva', pct: 41, pending: 42, pace: 'Behind' },
    { key: 'Assessor AF', person: 'A. Farooq', pct: 57, pending: 18, pace: 'Behind' },
    { key: 'Assessor MC', person: 'M. Chen', pct: 69, pending: 17, pace: 'On track' },
    { key: 'Assessor SR', person: 'S. Restrepo', pct: 82, pending: 16, pace: 'On track' },
    { key: 'Assessor TA', person: 'T. Abebe', pct: 91, pending: 3, pace: 'On track' },
    { key: 'Assessor NH', person: 'N. Haddad', pct: 98, pending: 1, pace: 'On track' },
  ],
};

export interface TimelineWorkRow {
  readonly id: string;
  readonly name: string;
  readonly chip: 'Official' | 'Sub';
  readonly pct: number;
  readonly pending: number;
  readonly pace: Pace;
}

export const WORK_BY_TIMELINE: readonly TimelineWorkRow[] = [
  { id: 'annual', name: 'Annual report 2026', chip: 'Official', pct: 62, pending: 420, pace: 'Behind' },
  { id: 'jul', name: 'July 2026 sub-timeline', chip: 'Sub', pct: 38, pending: 134, pace: 'At risk' },
  { id: 'sep', name: 'September pilot', chip: 'Sub', pct: 0, pending: 0, pace: 'On track' },
];

// ---------- Assessment outcomes (for the 1,114 results of the official timeline) ----------

export const OUTCOMES = {
  approvedFirstPass: 534,
  returnedResolved: 301,
  returnedOpen: 212,
  neverFinished: 67,
  autoApproved: 84,
} as const;

// ---------- Step progress drawer ----------

export interface ProgramProgress {
  readonly code: string;
  readonly done: number;
  readonly of: number;
}

export const PROGRAM_PROGRESS: readonly ProgramProgress[] = [
  { code: 'SP09', done: 8, of: 41 },
  { code: 'SP02', done: 19, of: 58 },
  { code: 'SP05', done: 24, of: 47 },
  { code: 'SP11', done: 28, of: 34 },
  { code: 'SP07', done: 30, of: 31 },
  { code: 'SP04', done: 25, of: 25 },
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
  { id: 'jul:0', label: 'July 2026 sub-timeline · QA platform open for assessors', desc: 'Open · closes 11 Jul', first: true },
  { id: 'annual:2', label: 'Annual report 2026 · QA platform open for lead assessor', desc: 'Opens 20 Apr', first: false },
  { id: 'sep:0', label: 'September pilot · QA platform open for assessors', desc: 'Opens 01 Sep', first: true },
];

/** Submitted results available to load, and how many of them are already in QA. */
export const LOAD_SUBMITTED = 1200;
export const LOAD_ALREADY_IN_QA = 86;

// ---------- Download comments ----------

export interface CommentsByProgram {
  readonly code: string;
  readonly name: string;
  readonly results: number;
  readonly comments: number;
}

export const COMMENTS_BY_PROGRAM: readonly CommentsByProgram[] = [
  { code: 'SP02', name: 'Rice Agrifood Systems', results: 214, comments: 41 },
  { code: 'SP04', name: 'Climate Action', results: 96, comments: 7 },
  { code: 'SP05', name: 'Multifunctional Landscapes', results: 147, comments: 28 },
  { code: 'SP07', name: 'Genetic Innovation', results: 132, comments: 12 },
  { code: 'SP09', name: 'Sustainable Animal and Aquatic Foods', results: 188, comments: 63 },
  { code: 'SP11', name: 'Policy Innovations', results: 121, comments: 19 },
  { code: 'SP01', name: 'Breeding for Tomorrow', results: 108, comments: 0 },
  { code: 'SP12', name: 'Scaling for Impact', results: 108, comments: 0 },
];

/** What the comments file can include, with the share of comments each kind represents. */
export const COMMENT_KINDS: readonly (readonly [kind: string, weight: number])[] = [
  ['Assessor comments', 0.6],
  ['Reporting tool updates', 0.3],
  ['Highlighted fields', 0.1],
];

/** Programs whose comments are already published to them (Settings → Publication). */
export const PUBLISHED_PROGRAMS: Readonly<Record<string, boolean>> = {
  SP02: true, SP05: true, SP09: false, SP11: false, SP07: false, SP04: true,
};
