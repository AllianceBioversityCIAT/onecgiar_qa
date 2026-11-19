// Mock data for the Overview of the reviewing roles (assessor, lead assessor, TPB, PPU), Juanpa 2026-11-11.
// The QA admin keeps the full dashboard; each other role sees what needs them, by when, and a few figures of its own.
// TODO(api): every count here comes from the user's assignments and the review data (P2 stories for steps 3–5 are not
// built yet: Juanda, 2026-11-11).

/** Who the Overview is for. The admin is the default (María Julia's dashboard). */
export type OverviewRole = 'admin' | 'assessor' | 'lead' | 'tpb' | 'ppu';

export const OVERVIEW_ROLES: readonly { readonly value: OverviewRole; readonly label: string }[] = [
  { value: 'admin', label: 'QA admin' },
  { value: 'assessor', label: 'Assessor' },
  { value: 'lead', label: 'Lead assessor' },
  { value: 'tpb', label: 'Third-party broker' },
  { value: 'ppu', label: 'PPU' },
];

/** The signed-in assessor of the preview (one of the Results mock's assessors). */
export const ME_ASSESSOR = 'M. Chen';

/** What happened to the assessor's comments in the programs' step. */
export const MY_COMMENT_OUTCOMES = { accepted: 41, rejected: 9, waiting: 14 } as const;

/** Fields where the assessor left the most comments in this cycle (Ángel, 2026-11-17: "Most discussed fields"). */
export const MY_TOP_FIELDS: readonly { readonly label: string; readonly n: number }[] = [
  { label: 'Innovation readiness', n: 12 },
  { label: 'Theory of change contribution', n: 10 },
  { label: 'Partners', n: 8 },
  { label: 'Geographic focus', n: 7 },
  { label: 'Description', n: 6 },
];

/**
 * Lead assessor: every commented field is theirs to look at; they mark as highlight the ones they see fit, rejected or
 * not (Santi via Yeck, 2026-11-12). The step opens after the programs answer (29 Jul in the mock): nothing is marked yet.
 */
export const LEAD_QUEUE: { readonly commented: number; readonly rejected: number; readonly highlighted: number } = {
  commented: 64,
  rejected: 23,
  highlighted: 0,
};

export const LEAD_BY_PROGRAM: readonly { readonly code: string; readonly n: number }[] = [
  { code: 'SP09', n: 6 },
  { code: 'SP02', n: 5 },
  { code: 'SP05', n: 4 },
  { code: 'SP11', n: 3 },
  { code: 'SP07', n: 3 },
  { code: 'SP04', n: 2 },
];

/** Fields whose comments the programs reject most: where the guidance may not be clear. */
export const LEAD_TOP_FIELDS: readonly { readonly label: string; readonly n: number }[] = [
  { label: 'Innovation readiness', n: 7 },
  { label: 'Theory of change contribution', n: 5 },
  { label: 'Partners', n: 4 },
  { label: 'Geographic focus', n: 4 },
  { label: 'Link', n: 3 },
];

/** Third-party broker: highlighted fields, decided or not. */
export const TPB_QUEUE: { readonly toDecide: number; readonly agreed: number; readonly changes: number } = { toDecide: 5, agreed: 9, changes: 6 };

export interface QueueItem {
  readonly code: string;
  readonly title: string;
  readonly program: string;
  readonly field: string;
  /** Lead's instruction (TPB) or what the TPB asked to change (PPU). */
  readonly note: string;
  /**
   * PPU only: whether the program already changed the field in the Reporting Tool. QA tells, but only the PPU closes the
   * case with "Mark when done" (Ángel, 2026-11-17). TODO(api): the Reporting → QA sync of the corrected field.
   */
  readonly reporting?: 'updated' | 'not-updated';
}

export const TPB_NEXT: readonly QueueItem[] = [
  { code: 'QA-2026-0841', title: 'Low-cost soil moisture sensor validated across three rice systems', program: 'SP02', field: 'Innovation readiness', note: 'Check the trial protocol in the evidence and decide whether level 5 holds.' },
  { code: 'QA-2026-0836', title: 'National seed policy revision adopted in Malawi', program: 'SP11', field: 'Geographic focus', note: 'The program says the policy is national; the evidence names two districts.' },
  { code: 'QA-2026-0830', title: 'Farmer uptake of drought-tolerant sorghum in Kenya', program: 'SP07', field: 'Partners', note: 'Decide whether the seed company counts as a partner of the result.' },
];

/**
 * PPU: the TPB's "Required changes" so far (the PPU step opens after the TPB's, 24 Jul in the mock), none done yet.
 * The ones the program already updated in the Reporting Tool come first: they only need "Mark when done".
 */
export const PPU_QUEUE: readonly QueueItem[] = [
  { code: 'QA-2026-0824', title: 'Participatory rangeland management guidelines', program: 'SP05', field: 'Link', note: 'Replace the restricted handle with an open link.', reporting: 'updated' },
  { code: 'QA-2026-0833', title: 'Training programme on post-harvest loss reduction', program: 'SP09', field: 'Description', note: 'Add the number of people trained and where.', reporting: 'updated' },
  { code: 'QA-2026-0841', title: 'Low-cost soil moisture sensor validated across three rice systems', program: 'SP02', field: 'Theory of change contribution 3', note: 'Map the contribution to an Intermediate Outcome.', reporting: 'not-updated' },
  { code: 'QA-2026-0836', title: 'National seed policy revision adopted in Malawi', program: 'SP11', field: 'Geographic focus', note: 'Change the scope from national to the two districts the evidence names.', reporting: 'not-updated' },
  { code: 'QA-2026-0818', title: 'Gender-responsive extension curriculum rolled out', program: 'SP01', field: 'Partners', note: 'Remove the partner the evidence does not mention.', reporting: 'not-updated' },
  { code: 'QA-2026-0812', title: 'Genomic selection pipeline documented for cassava', program: 'SP07', field: 'Link', note: 'Point the link to the published version, not the draft.', reporting: 'not-updated' },
];

/** How many of the PPU's next changes the Overview lists. */
export const PPU_NEXT_SHOWN = 3;
