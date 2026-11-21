// Sample data for the result history drawer (P2-3915, Traceability). Design only: every result shows this same
// story with its own code. TODO(api): read the history of the result (comment events, status changes, the loads and
// their field snapshots) once the back exposes it; P2-3912 already stores who deleted a comment and when.

/** The QA steps, in the order a timeline uses them. Named, never numbered on screen (a timeline may skip some). */
export type HistoryStepKey = 'assessors' | 'programs' | 'lead' | 'tpb' | 'ppu';

export interface HistoryStep {
  readonly key: HistoryStepKey;
  readonly name: string;
  /** "01 – 19 Jul 2026". */
  readonly dates: string;
}

export interface HistoryActor {
  readonly name: string;
  /** Platform nickname; null for what the platform does by itself. */
  readonly nickname: string | null;
  readonly role: string;
}

export type HistoryKind =
  | 'load'
  | 'status'
  | 'comment'
  | 'withdrawn'
  | 'validation'
  | 'undo'
  | 'program-accepted'
  | 'program-rejected'
  | 'clarification-request'
  | 'clarification-answer'
  | 'deleted'
  | 'lead-agree'
  | 'lead-escalate'
  | 'tpb-agreed'
  | 'tpb-changes'
  | 'ppu-done';

/** The three filters of the Activity tab. */
export type HistoryGroup = 'comments' | 'decisions' | 'status';

export interface HistoryEntry {
  readonly id: string;
  readonly kind: HistoryKind;
  readonly step: HistoryStepKey;
  readonly actor: HistoryActor;
  /** ISO date for `<time datetime>`. */
  readonly at: string;
  /** "02 Jul 2026, 09:10". */
  readonly when: string;
  readonly field?: string;
  /** The comment, answer, note or decision text. */
  readonly text?: string;
  /** The field value the comment referred to, when it was written. */
  readonly valueThen?: string;
  /** Status change. */
  readonly from?: string;
  readonly to?: string;
  /** Load: timeline and step. */
  readonly load?: string;
  /** A comment a lead assessor deleted: it stays in the history, marked. */
  readonly deleted?: { readonly by: HistoryActor; readonly when: string; readonly at: string };
}

export interface LoadField {
  readonly label: string;
  readonly step1: string;
  readonly step3: string;
}

export interface ResultLoads {
  readonly step1: { readonly when: string; readonly at: string };
  readonly step3: { readonly when: string; readonly at: string };
  readonly fields: readonly LoadField[];
}

export const HISTORY_STEPS: readonly HistoryStep[] = [
  { key: 'assessors', name: 'Assessors', dates: '01 – 19 Jul 2026' },
  { key: 'programs', name: 'Programs correct', dates: '20 – 23 Jul 2026' },
  { key: 'lead', name: 'Lead assessor', dates: '24 – 28 Jul 2026' },
  { key: 'tpb', name: 'Third-party broker', dates: '29 Jul – 04 Aug 2026' },
  { key: 'ppu', name: 'PPU', dates: 'From 05 Aug 2026' },
];

export const HISTORY_GROUP: Readonly<Record<HistoryKind, HistoryGroup>> = {
  load: 'status',
  status: 'status',
  comment: 'comments',
  withdrawn: 'comments',
  deleted: 'comments',
  'program-accepted': 'comments',
  'program-rejected': 'comments',
  'clarification-request': 'comments',
  'clarification-answer': 'comments',
  validation: 'decisions',
  undo: 'decisions',
  'lead-agree': 'decisions',
  'lead-escalate': 'decisions',
  'tpb-agreed': 'decisions',
  'tpb-changes': 'decisions',
  'ppu-done': 'decisions',
};

const PLATFORM: HistoryActor = { name: 'QA platform', nickname: null, role: 'Automatic' };
const ADMIN: HistoryActor = { name: 'Sofía Méndez', nickname: 'smendez', role: 'QA admin' };
const CHEN: HistoryActor = { name: 'M. Chen', nickname: 'mchen', role: 'Assessor' };
const SILVA: HistoryActor = { name: 'R. Silva', nickname: 'rsilva', role: 'Assessor' };
const PROGRAM: HistoryActor = { name: 'Ana Ortiz', nickname: 'aortiz', role: 'SP02 program' };
const LEAD: HistoryActor = { name: 'Lucía Pérez', nickname: 'lperez', role: 'Lead assessor' };
const TPB: HistoryActor = { name: 'Daniel Okoro', nickname: 'dokoro', role: 'Third-party broker' };
const PPU: HistoryActor = { name: 'Grace Wanjiru', nickname: 'gwanjiru', role: 'PPU' };

/** Oldest first. */
export const RESULT_HISTORY: readonly HistoryEntry[] = [
  // Assessors
  { id: 'e1', kind: 'load', step: 'assessors', actor: ADMIN, at: '2026-07-01T08:00', when: '01 Jul 2026, 08:00', load: 'Annual report 2026 · Assessors' },
  { id: 'e2', kind: 'status', step: 'assessors', actor: CHEN, at: '2026-07-02T09:02', when: '02 Jul 2026, 09:02', from: 'Pending', to: 'In review' },
  { id: 'e3', kind: 'validation', step: 'assessors', actor: CHEN, at: '2026-07-02T09:10', when: '02 Jul 2026, 09:10', field: 'Title' },
  {
    id: 'e4',
    kind: 'comment',
    step: 'assessors',
    actor: CHEN,
    at: '2026-07-02T09:24',
    when: '02 Jul 2026, 09:24',
    field: 'Description',
    text: 'Say how many farmers used the sensor and where.',
    valueThen: 'A low-cost soil moisture sensor was tested with farmers across three rice systems.',
  },
  {
    id: 'e5',
    kind: 'comment',
    step: 'assessors',
    actor: CHEN,
    at: '2026-07-02T09:31',
    when: '02 Jul 2026, 09:31',
    field: 'Theory of change contribution',
    text: 'Map the contribution to an Intermediate Outcome, not only to the output.',
    valueThen: 'Output 2.1 · Sensor prototypes validated',
    deleted: { by: LEAD, when: '25 Jul 2026, 10:02', at: '2026-07-25T10:02' },
  },
  { id: 'e6', kind: 'validation', step: 'assessors', actor: CHEN, at: '2026-07-02T09:40', when: '02 Jul 2026, 09:40', field: 'Partners' },
  { id: 'e7', kind: 'undo', step: 'assessors', actor: CHEN, at: '2026-07-02T09:44', when: '02 Jul 2026, 09:44', field: 'Partners' },
  {
    id: 'e8',
    kind: 'comment',
    step: 'assessors',
    actor: CHEN,
    at: '2026-07-02T09:46',
    when: '02 Jul 2026, 09:46',
    field: 'Partners',
    text: 'IRRI is listed twice.',
    valueThen: 'IRRI (lead) · IRRI (funder) · PhilRice',
  },
  {
    id: 'e9',
    kind: 'comment',
    step: 'assessors',
    actor: SILVA,
    at: '2026-07-03T14:05',
    when: '03 Jul 2026, 14:05',
    field: 'Geographic focus',
    text: 'Add Viet Nam, the third rice system is there.',
    valueThen: 'Philippines · Bangladesh',
  },
  { id: 'e10', kind: 'withdrawn', step: 'assessors', actor: SILVA, at: '2026-07-03T14:20', when: '03 Jul 2026, 14:20', field: 'Geographic focus', text: 'Add Viet Nam, the third rice system is there.' },
  {
    id: 'e11',
    kind: 'comment',
    step: 'assessors',
    actor: SILVA,
    at: '2026-07-03T14:28',
    when: '03 Jul 2026, 14:28',
    field: 'Link',
    text: 'The link opens a restricted handle. Use an open one.',
    valueThen: 'hdl.handle.net/10568/141277',
  },
  { id: 'e12', kind: 'status', step: 'assessors', actor: PLATFORM, at: '2026-07-19T23:59', when: '19 Jul 2026, 23:59', from: 'In review', to: 'Returned to program' },

  // Programs correct
  { id: 'e13', kind: 'program-accepted', step: 'programs', actor: PROGRAM, at: '2026-07-21T10:12', when: '21 Jul 2026, 10:12', field: 'Description', text: 'Added: 1,240 farmers in three provinces.' },
  { id: 'e14', kind: 'clarification-request', step: 'programs', actor: PROGRAM, at: '2026-07-21T10:20', when: '21 Jul 2026, 10:20', field: 'Link', text: 'Which link do you mean? The result has two evidence links.' },
  { id: 'e15', kind: 'clarification-answer', step: 'programs', actor: SILVA, at: '2026-07-21T15:48', when: '21 Jul 2026, 15:48', field: 'Link', text: 'The second one, the handle 10568/141277.' },
  { id: 'e16', kind: 'program-rejected', step: 'programs', actor: PROGRAM, at: '2026-07-22T09:05', when: '22 Jul 2026, 09:05', field: 'Partners', text: 'IRRI is there once as lead and once as funder. Both are right.' },
  { id: 'e17', kind: 'status', step: 'programs', actor: PLATFORM, at: '2026-07-23T23:59', when: '23 Jul 2026, 23:59', from: 'Returned to program', to: 'Pending lead assessor review' },

  // Lead assessor
  { id: 'e18', kind: 'load', step: 'lead', actor: PLATFORM, at: '2026-07-24T00:05', when: '24 Jul 2026, 00:05', load: 'Annual report 2026 · Lead assessor' },
  { id: 'e19', kind: 'deleted', step: 'lead', actor: LEAD, at: '2026-07-25T10:02', when: '25 Jul 2026, 10:02', field: 'Theory of change contribution', text: "M. Chen's comment" },
  { id: 'e20', kind: 'lead-agree', step: 'lead', actor: LEAD, at: '2026-07-25T10:15', when: '25 Jul 2026, 10:15', field: 'Partners', text: 'Both roles match the partner list.' },
  { id: 'e21', kind: 'lead-escalate', step: 'lead', actor: LEAD, at: '2026-07-25T10:22', when: '25 Jul 2026, 10:22', field: 'Link', text: 'The handle is still restricted after the program answered.' },
  { id: 'e22', kind: 'status', step: 'lead', actor: LEAD, at: '2026-07-25T10:30', when: '25 Jul 2026, 10:30', from: 'Pending lead assessor review', to: 'Pending for TPB review' },

  // Third-party broker
  { id: 'e23', kind: 'tpb-changes', step: 'tpb', actor: TPB, at: '2026-07-30T16:40', when: '30 Jul 2026, 16:40', field: 'Link', text: 'Replace it with the open CGSpace link of the same item.' },
  { id: 'e24', kind: 'status', step: 'tpb', actor: TPB, at: '2026-07-30T16:41', when: '30 Jul 2026, 16:41', from: 'Pending for TPB review', to: 'Changes for the PPU' },

  // PPU
  { id: 'e25', kind: 'ppu-done', step: 'ppu', actor: PPU, at: '2026-08-06T11:03', when: '06 Aug 2026, 11:03', field: 'Link', text: 'Changed in the Reporting Tool.' },
  { id: 'e26', kind: 'status', step: 'ppu', actor: PLATFORM, at: '2026-08-06T11:03', when: '06 Aug 2026, 11:03', from: 'Changes for the PPU', to: 'Quality assessed' },
];

/** What the result looked like when it was loaded in step 1 and again in step 3. */
export const RESULT_LOADS: ResultLoads = {
  step1: { when: '01 Jul 2026, 08:00', at: '2026-07-01T08:00' },
  step3: { when: '24 Jul 2026, 00:05', at: '2026-07-24T00:05' },
  fields: [
    { label: 'Title', step1: 'Low-cost soil moisture sensor validated across three rice systems', step3: 'Low-cost soil moisture sensor validated across three rice systems' },
    {
      label: 'Description',
      step1: 'A low-cost soil moisture sensor was tested with farmers across three rice systems.',
      step3: 'A low-cost soil moisture sensor was tested with 1,240 farmers in three provinces across three rice systems.',
    },
    { label: 'Innovation readiness level', step1: '5 · Validated in a controlled setting', step3: '6 · Validated in a real setting' },
    { label: 'Partners', step1: 'IRRI (lead) · IRRI (funder) · PhilRice', step3: 'IRRI (lead) · IRRI (funder) · PhilRice' },
    { label: 'Geographic focus', step1: 'Philippines · Bangladesh', step3: 'Philippines · Bangladesh · Viet Nam' },
    { label: 'Theory of change contribution', step1: 'Output 2.1 · Sensor prototypes validated', step3: 'Output 2.1 · Sensor prototypes validated' },
    { label: 'Link', step1: 'hdl.handle.net/10568/141277', step3: 'hdl.handle.net/10568/141277' },
    { label: 'Contributing centers', step1: 'IRRI · IWMI', step3: 'IRRI · IWMI' },
  ],
};
