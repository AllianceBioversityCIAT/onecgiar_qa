/** The steps a new timeline proposes (FR-4, S-2, S-3). Pure data. */
export type StepAudience =
  'assessors' | 'programs' | 'lead_assessors' | 'tpb' | 'ppu';

export interface DefaultStep {
  position: number;
  name: string;
  audience: StepAudience;
  round: number;
  requiresLoad: boolean;
}

export const DEFAULT_STEPS: readonly DefaultStep[] = [
  {
    position: 1,
    name: 'QA Platform open for assessors',
    audience: 'assessors',
    round: 1,
    requiresLoad: true,
  },
  {
    position: 2,
    name: 'QA open for Science Programs',
    audience: 'programs',
    round: 1,
    requiresLoad: false,
  },
  {
    position: 3,
    name: 'QA open for Lead Assessors',
    audience: 'lead_assessors',
    round: 2,
    requiresLoad: true,
  },
  {
    position: 4,
    name: 'Third-Party Broker review',
    audience: 'tpb',
    round: 2,
    requiresLoad: false,
  },
  {
    position: 5,
    name: 'PPU review',
    audience: 'ppu',
    round: 2,
    requiresLoad: false,
  },
];
