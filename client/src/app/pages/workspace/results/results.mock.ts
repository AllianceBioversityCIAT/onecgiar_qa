// Mock data for the "Results in QA" view, reproduced from the QA Platform mockup
// (`QA Platform.dc.html`: RESULTS, PROGRAMS, STATUS, TYPES, TL_TYPES_SUB, RQ_STATUS, ASSESSORS,
// DL_PROGS, PUB_INIT, timelines).
// The mockup lists 14 literal rows but its counts (chips, timelines, overview) describe 1,330
// results + 84 automatic ones. The other rows are generated here with a seeded generator so
// every count on the page comes from real rows and matches the mockup exactly.
// TODO(api): replace RESULTS / TIMELINES / DL_PROGRAMS with the results API.
// NOTE: the Review view keeps its own copy of the 14 mockup rows; a dev will unify both behind the API.

export type ResultStatus =
  | 'Pending'
  | 'In review'
  | 'Awaiting response'
  | 'Answered'
  | 'Quality assessed'
  | 'Automatic';

export type ResultType =
  | 'Knowledge product'
  | 'Innovation development'
  | 'Capacity sharing for development'
  | 'Other output'
  | 'Innovation use'
  | 'Policy change'
  | 'Other outcome';

export type QaRound = 'QA round 1' | 'QA round 2';

/** Outcome of the previous QA round: '' none, 'new' first assessment in round 2. */
export type PreviousOutcome = '' | 'new' | 'Awaiting response' | 'Answered' | 'Quality assessed';

export interface QaResult {
  readonly code: string;
  readonly title: string;
  readonly type: ResultType;
  /** Science program code, e.g. "SP02". */
  readonly program: string;
  readonly assessor: string | null;
  /** [answered, total] comments, or null when the result has none. */
  readonly comments: readonly [number, number] | null;
  readonly status: ResultStatus;
  /** Timeline name the result belongs to. */
  readonly batch: string;
  readonly round: QaRound;
  readonly r1: PreviousOutcome;
}

export interface QaTimeline {
  readonly id: string;
  readonly name: string;
  readonly kind: 'Official timeline' | 'Sub-timeline';
  readonly status: 'Live' | 'Scheduled';
  readonly step: number;
  readonly steps: number;
  readonly when: 'closes' | 'opens';
  readonly date: string;
}

export interface DownloadProgram {
  readonly code: string;
  readonly name: string;
  readonly results: number;
  readonly comments: number;
}

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

export const PROGRAM_CODES: readonly string[] = Object.keys(PROGRAMS);

export const STATUS_ORDER: readonly ResultStatus[] = [
  'Pending',
  'In review',
  'Awaiting response',
  'Answered',
  'Quality assessed',
  'Automatic',
];

/** Status pill colours (mockup STATUS map). */
export const STATUS_CLASSES: Readonly<Record<ResultStatus, string>> = {
  Pending: 'bg-(--surface-3) text-(--text-muted)',
  'In review': 'bg-(--st-indigo-bg) text-(--st-indigo-fg)',
  'Awaiting response': 'bg-(--st-editing-bg) text-(--st-editing-fg)',
  Answered: 'bg-(--st-submitted-bg) text-(--st-submitted-fg)',
  'Quality assessed': 'bg-(--st-approved-bg) text-(--st-approved-fg)',
  Automatic: 'bg-(--surface-3) text-(--text-4)',
};

/** Result type chips, in the mockup order. */
export const RESULT_TYPES: readonly ResultType[] = [
  'Knowledge product',
  'Innovation development',
  'Capacity sharing for development',
  'Other output',
  'Innovation use',
  'Policy change',
  'Other outcome',
];

export const ASSESSOR_NAMES: readonly string[] = [
  'L. Mwangi',
  'D. Okeke',
  'R. Silva',
  'A. Farooq',
  'M. Chen',
  'S. Restrepo',
  'T. Abebe',
  'N. Haddad',
];

export const QA_ROUNDS: readonly QaRound[] = ['QA round 1', 'QA round 2'];

export const ANNUAL = 'Annual report 2026';
export const JULY = 'July 2026 sub-timeline';

/** Open timelines of the page-level picker (closed ones are not listed). */
export const TIMELINES: readonly QaTimeline[] = [
  { id: 'annual', name: ANNUAL, kind: 'Official timeline', status: 'Live', step: 5, steps: 5, when: 'closes', date: '19 Jul' },
  { id: 'jul', name: JULY, kind: 'Sub-timeline', status: 'Live', step: 5, steps: 5, when: 'closes', date: '19 Jul' },
  { id: 'sep', name: 'September pilot', kind: 'Sub-timeline', status: 'Scheduled', step: 1, steps: 5, when: 'opens', date: '01 Sep' },
];

/** Timeline names of the "Timeline" filter: the open timelines, official first. */
export const BATCHES: readonly string[] = [...TIMELINES]
  .sort((a, b) => Number(a.kind !== 'Official timeline') - Number(b.kind !== 'Official timeline'))
  .map((t) => t.name);

/** Programs whose comments are already published to them (mockup PUB_INIT). */
export const PUBLISHED_PROGRAMS: readonly string[] = ['SP02', 'SP05', 'SP04'];

/** "Download comments" drawer: results and comments per program (mockup DL_PROGS). */
export const DL_PROGRAMS: readonly DownloadProgram[] = [
  { code: 'SP02', name: 'Rice Agrifood Systems', results: 214, comments: 41 },
  { code: 'SP04', name: 'Climate Action', results: 96, comments: 7 },
  { code: 'SP05', name: 'Multifunctional Landscapes', results: 147, comments: 28 },
  { code: 'SP07', name: 'Genetic Innovation', results: 132, comments: 12 },
  { code: 'SP09', name: 'Sustainable Animal and Aquatic Foods', results: 188, comments: 63 },
  { code: 'SP11', name: 'Policy Innovations', results: 121, comments: 19 },
  { code: 'SP01', name: 'Breeding for Tomorrow', results: 108, comments: 0 },
  { code: 'SP12', name: 'Scaling for Impact', results: 108, comments: 0 },
];

/** Non-automatic results per type in the official timeline (mockup TYPES). */
export const ANNUAL_TYPE_COUNTS: Readonly<Record<ResultType, number>> = {
  'Knowledge product': 342,
  'Innovation development': 261,
  'Capacity sharing for development': 198,
  'Other output': 74,
  'Innovation use': 112,
  'Policy change': 89,
  'Other outcome': 38,
};
export const ANNUAL_TOTAL = 1114;

/** Non-automatic results per type in the July sub-timeline (mockup TL_TYPES_SUB). */
const JULY_TYPE_COUNTS: Readonly<Record<ResultType, number>> = {
  'Knowledge product': 64,
  'Innovation development': 58,
  'Capacity sharing for development': 38,
  'Other output': 14,
  'Innovation use': 22,
  'Policy change': 14,
  'Other outcome': 6,
};

/** Status of the 1,330 non-automatic results (mockup RQ_STATUS). */
const STATUS_COUNTS: Readonly<Record<Exclude<ResultStatus, 'Automatic'>, number>> = {
  Pending: 148,
  'In review': 312,
  'Awaiting response': 212,
  Answered: 301,
  'Quality assessed': 357,
};

/** Knowledge products approved by the auto-check (mockup RT_AUTO_N). */
const AUTOMATIC_TOTAL = 84;

const R2_OUTCOME: Readonly<Record<string, PreviousOutcome>> = {
  'QA-2026-0841': 'Awaiting response',
  'QA-2026-0839': 'Answered',
  'QA-2026-0830': 'Awaiting response',
  'QA-2026-0818': 'Quality assessed',
  'QA-2026-0815': 'new',
};

type MockupRow = readonly [string, string, ResultType, string, string | null, readonly [number, number] | null, ResultStatus];

/** The 14 literal rows of the mockup, in its order. */
const MOCKUP_ROWS: readonly MockupRow[] = [
  ['QA-2026-0841', 'Low-cost soil moisture sensor validated across three rice systems', 'Innovation development', 'SP02', 'M. Chen', [3, 5], 'Awaiting response'],
  ['QA-2026-0839', 'Regional synthesis of climate-smart maize varieties', 'Knowledge product', 'SP04', 'S. Restrepo', [2, 2], 'Answered'],
  ['QA-2026-0836', 'National seed policy revision adopted in Malawi', 'Policy change', 'SP11', 'A. Farooq', null, 'Quality assessed'],
  ['QA-2026-0833', 'Training programme on post-harvest loss reduction', 'Capacity sharing for development', 'SP09', 'R. Silva', [1, 4], 'In review'],
  ['QA-2026-0830', 'Farmer uptake of drought-tolerant sorghum in Kenya', 'Innovation use', 'SP07', 'M. Chen', [2, 3], 'Awaiting response'],
  ['QA-2026-0827', 'Open dataset of soil carbon measurements, East Africa', 'Knowledge product', 'SP05', 'D. Okeke', null, 'In review'],
  ['QA-2026-0824', 'Participatory rangeland management guidelines', 'Other output', 'SP05', 'T. Abebe', null, 'Quality assessed'],
  ['QA-2026-0821', 'Aquaculture feed formulation trialled in Bangladesh', 'Innovation development', 'SP09', 'L. Mwangi', null, 'Pending'],
  ['QA-2026-0818', 'Gender-responsive extension curriculum rolled out', 'Capacity sharing for development', 'SP01', 'N. Haddad', [4, 4], 'Answered'],
  ['QA-2026-0815', 'Water allocation bylaw passed in Uzbekistan', 'Policy change', 'SP11', 'A. Farooq', [1, 1], 'Answered'],
  ['QA-2026-0812', 'Genomic selection pipeline documented for cassava', 'Knowledge product', 'SP07', 'S. Restrepo', null, 'In review'],
  ['QA-2026-0809', 'Digital advisory service reaching 40,000 smallholders', 'Innovation use', 'SP12', null, null, 'Pending'],
  ['QA-2026-0806', 'Policy brief on alternatives to rice straw burning', 'Knowledge product', 'SP02', null, null, 'Automatic'],
  ['QA-2026-0803', 'Groundwater level dataset for the Indo-Gangetic Plains', 'Knowledge product', 'SP04', null, null, 'Automatic'],
];

const MOCKUP_RESULTS: readonly QaResult[] = MOCKUP_ROWS.map(
  ([code, title, type, program, assessor, comments, status], i): QaResult => ({
    code,
    title,
    type,
    program,
    assessor,
    comments,
    status,
    batch: i % 3 === 1 ? ANNUAL : JULY,
    round: R2_OUTCOME[code] ? 'QA round 2' : 'QA round 1',
    r1: R2_OUTCOME[code] ?? '',
  }),
);

// ---------------------------------------------------------------------------------------------
// Deterministic generator for the rest of the dataset.

/** mulberry32: small seeded PRNG, so the dataset is identical on every load. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Exact-count pool: every key repeated `count - used` times, then shuffled. */
function pool<K extends string>(counts: Readonly<Record<K, number>>, used: readonly K[], rnd: () => number): K[] {
  const out: K[] = [];
  for (const key of Object.keys(counts) as K[]) {
    const n = counts[key] - used.filter((u) => u === key).length;
    for (let i = 0; i < n; i++) out.push(key);
  }
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const pick = <T>(list: readonly T[], rnd: () => number): T => list[Math.floor(rnd() * list.length)];

const TOPICS = [
  'soil health', 'climate-smart rice', 'drought-tolerant maize', 'post-harvest losses', 'aquaculture feeds',
  'agroforestry', 'groundwater use', 'seed systems', 'nutrition-sensitive farming', 'livestock vaccines',
  'cassava breeding', 'rangeland restoration', 'digital advisory services', 'gender-responsive extension',
  'crop insurance', 'biofortified beans', 'irrigation scheduling', 'pest surveillance', 'carbon farming',
  'market access for smallholders', 'heat-tolerant wheat', 'fodder conservation', 'fish value chains',
];
const PLACES = [
  'Kenya', 'Ethiopia', 'Malawi', 'Bangladesh', 'Vietnam', 'Colombia', 'Peru', 'Nigeria', 'Uganda', 'India',
  'Nepal', 'Uzbekistan', 'Ghana', 'Tanzania', 'the Sahel', 'East Africa', 'South Asia', 'Central America',
];
const THINGS = [
  'solar-powered irrigation pump', 'soil moisture sensor', 'heat-tolerant wheat line', 'mobile pest alert service',
  'low-emission rice variety', 'biofortified bean variety', 'fish feed formulation', 'weather index insurance product',
  'seed tracking app', 'improved cassava line', 'fodder conservation kit', 'drip irrigation kit', 'hermetic storage bag',
];

const TITLE_MAKERS: Readonly<Record<ResultType, (r: () => number) => string>> = {
  'Knowledge product': (r) =>
    `${pick(['Policy brief on', 'Open dataset of', 'Technical report on', 'Journal article on', 'Evidence synthesis on', 'Working paper on'], r)} ${pick(TOPICS, r)}, ${pick(PLACES, r)}`,
  'Innovation development': (r) => `${capitalize(pick(THINGS, r))} ${pick(['validated', 'prototyped', 'field-tested', 'piloted'], r)} in ${pick(PLACES, r)}`,
  'Capacity sharing for development': (r) =>
    `${pick(['Training programme', 'Learning series', 'Short course', 'Field school'], r)} on ${pick(TOPICS, r)} in ${pick(PLACES, r)}`,
  'Other output': (r) => `${pick(['Participatory guidelines', 'Toolkit', 'Decision support tool', 'Monitoring protocol'], r)} for ${pick(TOPICS, r)}`,
  'Innovation use': (r) => `Farmer uptake of ${pick(THINGS, r)}s in ${pick(PLACES, r)}`,
  'Policy change': (r) =>
    `${pick(['National strategy', 'Regional bylaw', 'Ministerial guideline', 'Policy revision'], r)} on ${pick(TOPICS, r)} adopted in ${pick(PLACES, r)}`,
  'Other outcome': (r) => `${pick(['Wider adoption', 'Improved coordination', 'New partnerships'], r)} around ${pick(TOPICS, r)} in ${pick(PLACES, r)}`,
};

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Who assesses each type (mockup ASSESSORS). */
const ASSESSORS_BY_TYPE: Readonly<Record<ResultType, readonly string[]>> = {
  'Knowledge product': ['D. Okeke', 'S. Restrepo'],
  'Innovation development': ['L. Mwangi', 'M. Chen'],
  'Capacity sharing for development': ['R. Silva', 'N. Haddad'],
  'Other output': ['T. Abebe'],
  'Innovation use': ['M. Chen'],
  'Policy change': ['A. Farooq'],
  'Other outcome': ['A. Farooq', 'T. Abebe'],
};

/** Results per program in the official timeline (mockup DL_PROGS). */
const ANNUAL_PROGRAM_COUNTS: Readonly<Record<string, number>> = Object.fromEntries(
  DL_PROGRAMS.map((p) => [p.code, p.results]),
);

function commentsFor(status: ResultStatus, r: () => number): readonly [number, number] | null {
  const total = 1 + Math.floor(r() * 5);
  switch (status) {
    case 'Awaiting response':
      return [Math.floor(r() * total), total];
    case 'Answered':
      return [total, total];
    case 'In review':
      return r() < 0.4 ? [Math.floor(r() * total), total] : null;
    case 'Quality assessed':
      return r() < 0.3 ? [total, total] : null;
    default:
      return null;
  }
}

function generateResults(): QaResult[] {
  const rnd = seeded(2026);
  const manual = MOCKUP_RESULTS.filter((m) => m.status !== 'Automatic');
  const inBatch = (b: string) => manual.filter((m) => m.batch === b);

  const annualTypes = pool(ANNUAL_TYPE_COUNTS, inBatch(ANNUAL).map((m) => m.type), rnd);
  const julyTypes = pool(JULY_TYPE_COUNTS, inBatch(JULY).map((m) => m.type), rnd);
  const annualPrograms = pool(ANNUAL_PROGRAM_COUNTS, inBatch(ANNUAL).map((m) => m.program), rnd);
  const statuses = pool(STATUS_COUNTS, manual.map((m) => m.status as Exclude<ResultStatus, 'Automatic'>), rnd);

  type Draft = { type: ResultType; program: string; batch: string };
  const drafts: Draft[] = [
    ...annualTypes.map((type, i) => ({ type, program: annualPrograms[i], batch: ANNUAL })),
    ...julyTypes.map((type) => ({ type, program: pick(PROGRAM_CODES, rnd), batch: JULY })),
  ];
  // Mix the two timelines so a page shows both.
  for (let i = drafts.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [drafts[i], drafts[j]] = [drafts[j], drafts[i]];
  }

  const autoCount = AUTOMATIC_TOTAL - MOCKUP_RESULTS.filter((m) => m.status === 'Automatic').length;
  const taken = new Set(MOCKUP_RESULTS.map((m) => Number(m.code.slice(-4))));
  const numbers: number[] = [];
  for (let n = 1; numbers.length < drafts.length + autoCount; n++) if (!taken.has(n)) numbers.push(n);
  numbers.reverse();
  const code = (i: number) => `QA-2026-${String(numbers[i]).padStart(4, '0')}`;

  const out: QaResult[] = drafts.map((d, i) => {
    const status = statuses[i];
    const assessor = status === 'Pending' && rnd() < 0.2 ? null : pick(ASSESSORS_BY_TYPE[d.type], rnd);
    const secondRound = status !== 'Pending' && rnd() < 0.12;
    const r1: PreviousOutcome = secondRound
      ? pick<PreviousOutcome>(['new', 'Awaiting response', 'Answered', 'Quality assessed'], rnd)
      : '';
    return {
      code: '',
      title: TITLE_MAKERS[d.type](rnd),
      type: d.type,
      program: d.program,
      assessor,
      comments: commentsFor(status, rnd),
      status,
      batch: d.batch,
      round: secondRound ? 'QA round 2' : 'QA round 1',
      r1,
    };
  });

  // Automatic knowledge products: spread through the list, all in the official timeline.
  for (let k = 0; k < autoCount; k++) {
    const auto: QaResult = {
      code: '',
      title: TITLE_MAKERS['Knowledge product'](rnd),
      type: 'Knowledge product',
      program: pick(PROGRAM_CODES, rnd),
      assessor: null,
      comments: null,
      status: 'Automatic',
      batch: ANNUAL,
      round: 'QA round 1',
      r1: '',
    };
    out.splice(Math.floor(rnd() * (out.length + 1)), 0, auto);
  }
  return out.map((r, i) => ({ ...r, code: code(i) }));
}

/** Every result in QA: the mockup's 14 rows first, then 1,400 generated ones (1,330 + 84 automatic in total). */
export const RESULTS: readonly QaResult[] = [...MOCKUP_RESULTS, ...generateResults()];
