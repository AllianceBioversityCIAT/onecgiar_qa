// Mock data for the Review page (/results/:code), copied from the "QA Platform" mockup JS
// (RESULTS, SECTIONS, FIELD_DEFS, TOC_0841, AI_MATCH_0841, QC_DEFAULT, DESC, buildReview).
// TODO(api): replace with the review endpoint (result + fields + comments + AI matches).
// NOTE: RESULTS / PROGRAMS duplicate data used by the Results view; a dev will unify them behind an API.

export type ResultStatus =
  | 'Pending'
  | 'In review'
  | 'Awaiting response'
  | 'Answered'
  | 'Quality assessed'
  | 'Automatic';

export interface ReviewResult {
  readonly code: string;
  readonly title: string;
  readonly type: string;
  readonly program: string;
  readonly assessor: string | null;
  /** [answered, total] comments left in round 1, or null. */
  readonly comments: readonly [number, number] | null;
  readonly status: ResultStatus;
}

export type SectionId = 'general' | 'toc' | 'contrib' | 'geo' | 'detail' | 'evidence';
export type FieldMode = 'core' | 'assessed' | 'view' | 'hidden';

export interface ReviewSection {
  readonly id: SectionId;
  readonly name: string;
  /** Only shown for this result type. */
  readonly only?: string;
}

export interface FieldDef {
  readonly id: string;
  readonly sec: SectionId;
  readonly label: string;
  readonly mode: FieldMode;
  readonly value: string;
  readonly tip?: string;
  /** Value before the program's update in the reporting tool (Before / Now compare). */
  readonly before?: string;
  /** Impact area score 0–2. */
  readonly score?: 0 | 1 | 2;
  readonly ia?: boolean;
}

export interface TocDef extends FieldDef {
  readonly mapping?: boolean;
  readonly n?: number;
  readonly prog?: string;
  readonly level?: string;
  readonly chip?: string;
  readonly node?: readonly [string, string];
  readonly kpi?: string;
  readonly contrib?: number;
  readonly target?: number;
}

export interface FieldComment {
  readonly who: string;
  readonly role: 'Assessor' | 'Reporting tool';
  readonly date: string;
  readonly text: string;
  readonly system?: boolean;
}

export interface FieldState {
  readonly approved: boolean;
  readonly highlighted: boolean;
  readonly comments: readonly FieldComment[];
}

export type ReviewState = Readonly<Record<string, FieldState>>;

export interface AiMatch {
  readonly verdict: 'ok' | 'mm';
  readonly text: string;
}

export interface QuickComment {
  readonly id: string;
  readonly cat: string;
  readonly text: string;
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

export const CYCLE = {
  year: 2026,
  batch: 'July 2026 sub-timeline',
  phase: 'QA platform open for assessors · closes 11 Jul 2026',
  submitted: '04 Sep 2026',
  guidanceUrl: 'https://cgiar.org/qa/assessor-guidance-2026',
  guidanceLabel: '2026 assessor guidance',
} as const;

export const INSTRUCTIONS = {
  assessor:
    'Review each field against the assessor guidance. Approve it, or leave a comment explaining what needs to change.',
  readOnly: 'Approved automatically by the knowledge product auto-check. Nothing to review.',
} as const;

/** Programs whose comments are already published to the program (mockup PUB_INIT, pubSee off). */
export const PUBLISHED_PROGRAMS: readonly string[] = ['SP02', 'SP05', 'SP04'];

const OUTCOME_TYPES = ['Innovation use', 'Policy change', 'Other outcome'];

export const RESULTS: readonly ReviewResult[] = [
  { code: 'QA-2026-0841', title: 'Low-cost soil moisture sensor validated across three rice systems', type: 'Innovation development', program: 'SP02', assessor: 'M. Chen', comments: [3, 5], status: 'Awaiting response' },
  { code: 'QA-2026-0839', title: 'Regional synthesis of climate-smart maize varieties', type: 'Knowledge product', program: 'SP04', assessor: 'S. Restrepo', comments: [2, 2], status: 'Answered' },
  { code: 'QA-2026-0836', title: 'National seed policy revision adopted in Malawi', type: 'Policy change', program: 'SP11', assessor: 'A. Farooq', comments: null, status: 'Quality assessed' },
  { code: 'QA-2026-0833', title: 'Training programme on post-harvest loss reduction', type: 'Capacity sharing for development', program: 'SP09', assessor: 'R. Silva', comments: [1, 4], status: 'In review' },
  { code: 'QA-2026-0830', title: 'Farmer uptake of drought-tolerant sorghum in Kenya', type: 'Innovation use', program: 'SP07', assessor: 'M. Chen', comments: [2, 3], status: 'Awaiting response' },
  { code: 'QA-2026-0827', title: 'Open dataset of soil carbon measurements, East Africa', type: 'Knowledge product', program: 'SP05', assessor: 'D. Okeke', comments: null, status: 'In review' },
  { code: 'QA-2026-0824', title: 'Participatory rangeland management guidelines', type: 'Other output', program: 'SP05', assessor: 'T. Abebe', comments: null, status: 'Quality assessed' },
  { code: 'QA-2026-0821', title: 'Aquaculture feed formulation trialled in Bangladesh', type: 'Innovation development', program: 'SP09', assessor: 'L. Mwangi', comments: null, status: 'Pending' },
  { code: 'QA-2026-0818', title: 'Gender-responsive extension curriculum rolled out', type: 'Capacity sharing for development', program: 'SP01', assessor: 'N. Haddad', comments: [4, 4], status: 'Answered' },
  { code: 'QA-2026-0815', title: 'Water allocation bylaw passed in Uzbekistan', type: 'Policy change', program: 'SP11', assessor: 'A. Farooq', comments: [1, 1], status: 'Answered' },
  { code: 'QA-2026-0812', title: 'Genomic selection pipeline documented for cassava', type: 'Knowledge product', program: 'SP07', assessor: 'S. Restrepo', comments: null, status: 'In review' },
  { code: 'QA-2026-0809', title: 'Digital advisory service reaching 40,000 smallholders', type: 'Innovation use', program: 'SP12', assessor: null, comments: null, status: 'Pending' },
  { code: 'QA-2026-0806', title: 'Policy brief on alternatives to rice straw burning', type: 'Knowledge product', program: 'SP02', assessor: null, comments: null, status: 'Automatic' },
  { code: 'QA-2026-0803', title: 'Groundwater level dataset for the Indo-Gangetic Plains', type: 'Knowledge product', program: 'SP04', assessor: null, comments: null, status: 'Automatic' },
];

/** Status pill colours (mockup STATUS). Full class strings so Tailwind picks them up. */
export const STATUS_CLASSES: Readonly<Record<ResultStatus, string>> = {
  Pending: 'bg-(--surface-3) text-(--text-muted)',
  'In review': 'bg-(--st-indigo-bg) text-(--st-indigo-fg)',
  'Awaiting response': 'bg-(--st-editing-bg) text-(--st-editing-fg)',
  Answered: 'bg-(--st-submitted-bg) text-(--st-submitted-fg)',
  'Quality assessed': 'bg-(--st-approved-bg) text-(--st-approved-fg)',
  Automatic: 'bg-(--surface-3) text-(--text-4)',
};

/** Assessor queue: results still to assess (mockup QUEUE_OF.Assessor). */
export const isInAssessorQueue = (r: ReviewResult): boolean => r.status === 'Pending' || r.status === 'In review';

export const SECTIONS: readonly ReviewSection[] = [
  { id: 'general', name: 'General information' },
  { id: 'toc', name: 'Theory of change' },
  { id: 'contrib', name: 'Contributors and partners' },
  { id: 'geo', name: 'Geographic location' },
  { id: 'detail', name: 'Innovation development', only: 'Innovation development' },
  { id: 'evidence', name: 'Evidence' },
];

export const sectionsFor = (r: ReviewResult): readonly ReviewSection[] =>
  SECTIONS.filter((s) => !s.only || s.only === r.type);

export const IA_TIP =
  '0 — the result does not target this impact area. 1 — the area is a significant but secondary objective. 2 — the area is a principal objective of the result. A score of 2 must be backed by evidence.';
export const IA_SCALE: readonly string[] = ['Not targeted', 'Significant', 'Principal'];
export const TOC_TIP =
  "A contribution links this result to one node of a science program's theory of change, with the KPI it reports against and how much it adds to that indicator's target. Judge the level, node and KPI together.";

export const FIELD_DEFS: readonly FieldDef[] = [
  { id: 'level', sec: 'general', label: 'Result level', mode: 'core', value: 'Output', tip: 'Check that the level matches the indicator category. Outputs are products; outcomes are changes in use or policy.' },
  { id: 'category', sec: 'general', label: 'Indicator category', mode: 'core', value: 'Innovation development', tip: 'Confirm the category fits the evidence. A wrong category is a comment, not a correction.' },
  { id: 'title', sec: 'general', label: 'Title of result', mode: 'core', value: 'Low-cost soil moisture sensor validated across three rice systems', tip: 'The title names what was produced or changed, in plain language and without acronyms.' },
  { id: 'description', sec: 'general', label: 'Description', mode: 'core', value: 'A capacitive soil moisture sensor built from locally sourced components was validated across irrigated, rainfed lowland and deepwater rice systems in Bangladesh, the Philippines and Viet Nam over two consecutive seasons and nine sites.', before: 'A capacitive soil moisture sensor built from locally sourced components was validated across irrigated, rainfed lowland and deepwater rice systems in Bangladesh, the Philippines and Viet Nam.', tip: 'Look for what, where, when and with whom. Comment on claims the evidence does not support.' },
  { id: 'submitter', sec: 'general', label: 'Submitter', mode: 'view', value: 'M. Okonkwo · Alliance Bioversity-CIAT', tip: 'Shown for context. Not assessed.' },
  { id: 'hlo', sec: 'general', label: 'HLO / Outcome', mode: 'core', value: 'Climate adaptation and mitigation', tip: 'The outcome must be one the science program committed to in its workplan.' },
  { id: 'indicator', sec: 'general', label: 'Indicator', mode: 'core', value: 'Number of innovations advanced to readiness level 5 or above', tip: 'Check the indicator against the result level and the indicator category.' },
  { id: 'iagender', sec: 'general', ia: true, label: 'Gender equality, youth and social inclusion tag', mode: 'core', score: 0, value: '0 Not targeted', tip: 'Whether the result aims to reduce inequality for women, young people and other marginalized groups in access to resources, services and decision-making.' },
  { id: 'iaclimate', sec: 'general', ia: true, label: 'Climate adaptation and mitigation tag', mode: 'core', score: 2, value: '2 Principal', tip: 'Whether the result aims to help farmers and food systems adapt to climate change, or to reduce or remove greenhouse gas emissions.' },
  { id: 'ianutrition', sec: 'general', ia: true, label: 'Nutrition, health and food security tag', mode: 'core', score: 0, value: '0 Not targeted', tip: 'Whether the result aims to improve diets, nutrition, food safety or food security, or to reduce diet-related disease.' },
  { id: 'iaenv', sec: 'general', ia: true, label: 'Environmental health and biodiversity tag', mode: 'core', score: 1, value: '1 Significant', tip: 'Whether the result aims to protect or restore soils, water, forests and biodiversity, or to reduce the environmental footprint of agriculture.' },
  { id: 'iapoverty', sec: 'general', ia: true, label: 'Poverty reduction, livelihoods and jobs tag', mode: 'core', score: 0, value: '0 Not targeted', tip: 'Whether the result aims to raise incomes, create jobs or improve the livelihoods of poor rural and urban people.' },
  { id: 'centers', sec: 'contrib', label: 'Contributing CGIAR centers', mode: 'hidden', value: 'IRRI, IWMI', tip: 'Context from the reporting tool. Not assessed.' },
  { id: 'sp', sec: 'contrib', label: 'Contributing science program / Accelerator', mode: 'core', value: 'SP02 Rice Agrifood Systems', tip: 'The contributing program must match the program that submitted the result.' },
  { id: 'partners', sec: 'contrib', label: 'Partners', mode: 'core', value: 'Bangladesh Rice Research Institute; Can Tho University; PhilRice', tip: 'Every partner listed should have a stated role in the result.' },
  { id: 'lead', sec: 'contrib', label: 'Lead center', mode: 'assessed', value: 'IRRI', tip: 'One lead center. It must also appear among the contributing centers.' },
  { id: 'focus', sec: 'geo', label: 'Geographic focus', mode: 'assessed', value: 'National', tip: 'The focus must agree with the regions and countries reported.' },
  { id: 'regions', sec: 'geo', label: 'Regions', mode: 'view', value: 'South-East Asia; South Asia', tip: 'Shown for context. Assessed through geographic focus.' },
  { id: 'countries', sec: 'geo', label: 'Countries', mode: 'view', value: 'Bangladesh, Philippines, Viet Nam', tip: 'Shown for context. Assessed through geographic focus.' },
  { id: 'typology', sec: 'detail', label: 'Innovation typology', mode: 'hidden', value: 'Technological innovation', tip: 'Context from the reporting tool. Not assessed.' },
  { id: 'developer', sec: 'detail', label: 'Innovation developer', mode: 'hidden', value: 'IRRI sensor lab', tip: 'Context from the reporting tool. Not assessed.' },
  { id: 'readiness', sec: 'detail', label: 'Innovation readiness', mode: 'core', value: 'Level 5 — Early prototype validated in controlled conditions', tip: 'Match the level to the evidence using the readiness scale in the guidance.' },
  { id: 'source', sec: 'evidence', label: 'Source of the evidence', mode: 'core', value: 'Field validation report, September 2026', tip: 'The source must be public or shared with the assessor.' },
  { id: 'link', sec: 'evidence', label: 'Link', mode: 'core', value: 'https://cgspace.cgiar.org/handle/10568/128744', tip: 'Open the link. It must resolve to the cited evidence without signing in.' },
];

const TOC_0841 = [
  { id: 'toc1', prog: 'SP02', level: 'Output', chip: 'Output', node: ['AOW02', 'Improved water productivity in rice-based systems'], kpi: 'Number of innovations advanced to readiness level 5 or above in water management', contrib: 1, target: 14 },
  { id: 'toc2', prog: 'SP02', level: 'Outcome', chip: 'Outcome', node: ['IO03', 'National partners apply CGIAR water-saving practices at scale'], kpi: 'Number of national research partners that have adopted at least one CGIAR-developed water management innovation', contrib: 3, target: 40 },
  { id: 'toc3', prog: 'SP05', level: '2030 Outcome', chip: 'Outcome', node: ['2030-04', 'Climate adaptation and mitigation'], kpi: 'Number of innovations contributing to measurable reductions in agricultural water use across target landscapes', contrib: 1, target: 22 },
] as const;

export const TOC_PROG_NAMES: Readonly<Record<string, string>> = {
  SP02: 'Rice Agrifood Systems',
  SP05: 'Multifunctional Landscapes',
};

export const tocDefsFor = (r: ReviewResult): readonly TocDef[] =>
  r.code === 'QA-2026-0841'
    ? TOC_0841.map((t, i) => ({
        ...t,
        sec: 'toc' as const,
        mode: 'core' as const,
        label: 'Contribution ' + (i + 1),
        n: i + 1,
        value: t.node[0] + ' · ' + t.node[1] + '. ' + t.kpi,
      }))
    : [
        {
          id: 'tocmap',
          sec: 'toc',
          mode: 'core',
          label: 'ToC mapping',
          mapping: true,
          value: 'Contributes to the theory of change: No. Program invested financial resources: Yes.',
        },
      ];

export const allDefsFor = (r: ReviewResult): readonly (FieldDef | TocDef)[] => [...FIELD_DEFS, ...tocDefsFor(r)];

/** AI matches (only QA-2026-0841 has them in the mockup). */
export const AI_MATCHES: Readonly<Record<string, Readonly<Record<string, AiMatch>>>> = {
  'QA-2026-0841': {
    title: { verdict: 'ok', text: 'The title names the innovation, the validation and the systems covered. It matches the description and the selected indicator.' },
    description: { verdict: 'mm', text: 'The description reports validation across three rice systems but does not state the number of seasons or sites. The evidence attached mentions two seasons and nine sites.' },
    readiness: { verdict: 'mm', text: 'Level 5 requires validation in a relevant environment. The evidence describes controlled field conditions, which is usually reported as level 4.' },
    source: { verdict: 'ok', text: 'The report is dated within the reporting period and refers to the systems named in the result.' },
    iaclimate: { verdict: 'mm', text: 'The score is 2, which requires the area to be a principal objective. The description and the evidence report water management outcomes without quantifying any adaptation or mitigation effect.' },
    iaenv: { verdict: 'mm', text: 'The score is 1, but neither the description nor the evidence mentions biodiversity or environmental health outcomes.' },
    iagender: { verdict: 'ok', text: 'The score is 0 and nothing in the result claims a gender, youth or inclusion objective.' },
    ianutrition: { verdict: 'ok', text: 'The score is 0 and the result does not claim nutrition or food security outcomes.' },
    iapoverty: { verdict: 'ok', text: 'The score is 0 and the result does not claim livelihood or employment outcomes.' },
    toc3: { verdict: 'mm', text: 'This contribution is mapped to a 2030 Outcome, but the evidence covers a single season in one country. An Intermediate Outcome may be the better fit.' },
  },
};

export const QUICK_COMMENTS: readonly QuickComment[] = [
  ...(
    [
      ['Evidence', 'The evidence provided does not support the claim made in this field. Please attach a source that shows the result described.'],
      ['Evidence', 'The link points to a landing page rather than to the specific document.'],
      ['Evidence', 'Evidence is dated outside the reporting period.'],
      ['Clarity', 'This description reports an activity rather than a result. Please rewrite it to state what changed.'],
      ['Clarity', 'Please add the number of sites and seasons covered.'],
      ['Clarity', 'Acronyms are used without being defined on first mention.'],
      ['Alignment', 'The result does not appear to match the selected indicator. Please confirm the mapping.'],
      ['Alignment', 'The readiness level reported is not supported by the evidence attached.'],
      ['Completeness', 'This field is empty and is required for assessment.'],
      ['Completeness', 'Partners are listed but their role in the result is not described.'],
    ] as const
  ).map(([cat, text], i) => ({ id: 'qa' + i, cat, text })),
  ...[
    'The correction addresses the previous comment. No further action needed.',
    'The correction is partial. The point about evidence remains open.',
    'No change was made to this field since the previous assessment.',
  ].map((text, i) => ({ id: 'qf' + i, cat: 'Follow-up', text })),
];

const DESC: Readonly<Record<string, string>> = {
  'QA-2026-0839': 'A regional synthesis of climate-smart maize variety performance across twelve trial sites in Kenya, Ethiopia and Tanzania, covering yield stability, drought tolerance and farmer preference rankings for the 2024 and 2025 seasons.',
  'QA-2026-0836': 'The Government of Malawi adopted a revised national seed policy that recognises quality-declared seed and opens certification to community seed banks, following two years of evidence briefs and stakeholder consultations.',
  'QA-2026-0833': 'A training programme on post-harvest handling, drying and hermetic storage delivered to 1,240 extension workers and traders in Ghana and Nigeria, with follow-up visits measuring practice change after six months.',
  'QA-2026-0830': 'Smallholder farmers in eastern Kenya adopted drought-tolerant sorghum varieties on 18,000 hectares through seed company partnerships and county extension, with adoption measured by a household survey of 900 farms.',
  'QA-2026-0827': 'An open dataset of 6,400 georeferenced soil organic carbon measurements from Ethiopia, Kenya and Rwanda, harmonised to a common protocol and published with metadata and code in CGSpace.',
  'QA-2026-0824': 'Guidelines for participatory rangeland management, developed with pastoralist associations in Ethiopia and Kenya and tested in four communities, describing how to map, negotiate and monitor grazing plans.',
  'QA-2026-0821': 'A low-cost aquaculture feed formulated from local by-products was trialled with 60 tilapia farmers in Bangladesh, reducing feed costs by about a fifth while maintaining growth rates over one production cycle.',
  'QA-2026-0818': 'A gender-responsive extension curriculum was rolled out to 300 extension agents in Uganda and Tanzania, covering joint household decision-making and women-friendly training formats.',
  'QA-2026-0815': 'A district council in Uzbekistan passed a bylaw allocating irrigation water by crop demand and canal position, informed by CGIAR water-accounting studies and pilot allocation trials.',
  'QA-2026-0812': 'A documented genomic selection pipeline for cassava breeding programmes, including genotyping protocols, prediction models and decision rules, published as an open protocol with training material.',
  'QA-2026-0809': 'A digital advisory service delivering weather-based planting and input advice by SMS and voice now reaches 40,000 smallholders in Senegal and Mali, with usage tracked through platform analytics.',
  'QA-2026-0806': 'A policy brief comparing alternatives to rice straw burning in Punjab, with costs, emission reductions and adoption barriers for mulching, baling and in-situ decomposition.',
  'QA-2026-0803': 'A groundwater level dataset for the Indo-Gangetic Plains combining 2,100 monitoring wells from 2000 to 2025, quality-controlled and published with an interactive map.',
};

/** Value of a field for a given result (mockup fieldValue). */
export function fieldValue(d: FieldDef, r: ReviewResult): string {
  if (r.code === 'QA-2026-0841') return d.value;
  if (d.id === 'title') return r.title;
  if (d.id === 'category') return r.type;
  if (d.id === 'level') return OUTCOME_TYPES.includes(r.type) ? 'Outcome' : 'Output';
  if (d.id === 'sp') return r.program + ' ' + PROGRAMS[r.program];
  if (d.id === 'description') return DESC[r.code] ?? d.value;
  return d.value;
}

const EMPTY: FieldState = { approved: false, highlighted: false, comments: [] };

/** Initial review state of a result: approvals and comment threads (mockup buildReview). */
export function buildReview(r: ReviewResult): ReviewState {
  const sections = sectionsFor(r);
  const defs = allDefsFor(r).filter((d) => sections.some((s) => s.id === d.sec));
  const st: Record<string, FieldState> = {};
  defs.forEach((d) => (st[d.id] = EMPTY));
  const set = (id: string, patch: Partial<FieldState>) => (st[id] = { ...st[id], ...patch });
  const A = r.assessor ?? 'M. Chen';
  const c = (who: string, date: string, text: string): FieldComment => ({ who, role: 'Assessor', date, text });
  const sync = (date: string, text: string): FieldComment => ({
    who: 'Updated in the reporting tool',
    role: 'Reporting tool',
    date,
    text,
    system: true,
  });

  if (r.code === 'QA-2026-0841') {
    ['level', 'category', 'hlo', 'sp', 'source', 'toc2'].forEach((id) => set(id, { approved: true }));
    set('title', { comments: [c(A, '08 Jul 2026', 'Name the three rice systems in the title, or drop the number.')] });
    set('description', {
      comments: [
        c('M. Chen', '08 Jul 2026', 'The description reports validation across three systems but does not say how many seasons or sites. Please add both.'),
        sync('09 Jul 2026', 'Description changed'),
      ],
    });
    set('partners', {
      comments: [c(A, '08 Jul 2026', 'Add the role of each partner in the validation.'), sync('10 Jul 2026', 'Partners changed')],
    });
    set('readiness', {
      highlighted: true,
      comments: [c(A, '09 Jul 2026', 'Level 5 needs validation outside controlled conditions. The field trials suggest level 6 may apply. Please check.')],
    });
    set('link', { comments: [c(A, '09 Jul 2026', 'The handle opens a restricted item. Please share an open link.')] });
    set('toc3', {
      comments: [
        c('M. Chen', '08 Jul 2026', 'This contribution is mapped to a 2030 Outcome, but the evidence only covers a single season in one country. Please confirm whether the mapping should be to an Intermediate Outcome instead.'),
      ],
    });
    return st;
  }

  const act = defs.filter((d) => d.mode === 'core' || d.mode === 'assessed').map((d) => d.id);
  if (r.status === 'Pending') return st;
  if (r.status === 'Quality assessed' || r.status === 'Automatic') {
    act.forEach((id) => set(id, { approved: true }));
    return st;
  }
  const [answered, total] = r.comments ?? [0, 0];
  act.slice(0, total).forEach((id, i) => {
    const comments: FieldComment[] = [
      c(A, '08 Jul 2026', 'Please explain how this value was established and point to the supporting evidence.'),
    ];
    if (i < answered) {
      const dd = defs.find((x) => x.id === id);
      comments.push(sync('10 Jul 2026', (dd ? dd.label : 'Field') + ' changed'));
    }
    set(id, { comments });
  });
  const rest = act.slice(total);
  const keepOpen =
    r.status === 'In review'
      ? Math.ceil(rest.length / 2)
      : r.status === 'Awaiting response'
        ? Math.min(2, rest.length)
        : r.status === 'Answered'
          ? Math.min(4, rest.length)
          : 0;
  rest.slice(0, rest.length - keepOpen).forEach((id) => set(id, { approved: true }));
  return st;
}
