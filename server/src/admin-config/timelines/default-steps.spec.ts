import { describe, expect, it } from 'vitest';
import { DEFAULT_STEPS } from './default-steps.js';

// The FR-4 table, written out literally.
describe('DEFAULT_STEPS (FR-4)', () => {
  it('is the five default steps, in order', () => {
    expect(DEFAULT_STEPS).toEqual([
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
    ]);
  });
});
