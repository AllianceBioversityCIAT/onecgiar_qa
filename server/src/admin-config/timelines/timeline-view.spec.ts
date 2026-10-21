import { describe, expect, it } from 'vitest';
import type { RoleCode } from '../../users/permissions.js';
import {
  viewTimeline,
  type TimelineView,
  type TimelineViewStep,
} from './timeline-view.js';

// Expected values are literals from the FR-12 and FR-13 scenarios (S-1: a step
// is open from 00:00 of `opensOn` to 23:59:59 of `closesOn`, Rome days). Step 1
// closes 6 Nov and step 2 opens 9 Nov, so 7 and 8 Nov are the gap. Every date
// row sits exactly on its boundary.

const steps: TimelineViewStep[] = [
  {
    position: 1,
    audience: 'assessors',
    opensOn: '2026-10-26',
    closesOn: '2026-11-06',
  },
  {
    position: 2,
    audience: 'programs',
    opensOn: '2026-11-09',
    closesOn: '2026-11-20',
  },
];

function at(today: string): TimelineView {
  return viewTimeline({ steps, assignedRoles: [], today });
}

describe('viewTimeline status (FR-12)', () => {
  it.each([
    ['2026-10-25', 'scheduled'],
    ['2026-10-26', 'live'],
    ['2026-11-07', 'live'],
    ['2026-11-20', 'live'],
    ['2026-11-21', 'finished'],
  ])('on %s the status is %s', (today, status) => {
    expect(at(today).status).toBe(status);
  });
});

describe('viewTimeline current and next step (FR-12)', () => {
  it.each([
    ['2026-10-25', null, 1],
    ['2026-10-26', 1, 2],
    ['2026-11-06', 1, 2],
    ['2026-11-07', null, 2],
    ['2026-11-08', null, 2],
    ['2026-11-09', 2, null],
    ['2026-11-20', 2, null],
    ['2026-11-21', null, null],
  ])(
    'on %s the current step is %s and the next is %s',
    (today, current, next) => {
      const view = at(today);
      expect([view.currentStep, view.nextStep]).toEqual([current, next]);
    },
  );

  it('works only from its arguments (frozen inputs, same answer twice)', () => {
    const frozen = Object.freeze({
      steps: Object.freeze(steps.map((s) => Object.freeze({ ...s }))),
      assignedRoles: Object.freeze(['ASSESSOR'] as RoleCode[]),
      today: '2026-11-06',
    });
    const first = viewTimeline(frozen);
    expect(viewTimeline(frozen)).toEqual(first);
    expect(first.currentStep).toBe(1);
  });
});

describe('viewTimeline readiness (FR-13)', () => {
  const fullSteps: TimelineViewStep[] = [
    {
      position: 1,
      audience: 'assessors',
      opensOn: '2026-10-26',
      closesOn: '2026-11-06',
    },
    {
      position: 2,
      audience: 'programs',
      opensOn: '2026-11-09',
      closesOn: '2026-11-13',
    },
    {
      position: 3,
      audience: 'lead_assessors',
      opensOn: '2026-11-16',
      closesOn: '2026-11-20',
    },
    {
      position: 4,
      audience: 'tpb',
      opensOn: '2026-11-23',
      closesOn: '2026-11-27',
    },
    {
      position: 5,
      audience: 'ppu',
      opensOn: '2026-11-30',
      closesOn: '2026-12-04',
    },
  ];

  it('lists the missing assessor and no Science Programs item', () => {
    expect(at('2026-10-20').readiness).toEqual([
      'NO_RESULTS_LOADED',
      'NO_ASSESSOR_ASSIGNED',
    ]);
  });

  it('lists only NO_RESULTS_LOADED when all four roles are assigned', () => {
    const view = viewTimeline({
      steps: fullSteps,
      assignedRoles: ['ASSESSOR', 'LEAD_ASSESSOR', 'TPB', 'PPU'],
      today: '2026-10-20',
    });
    expect(view.readiness).toEqual(['NO_RESULTS_LOADED']);
  });

  it('lists one item per missing role, in step order', () => {
    const view = viewTimeline({
      steps: fullSteps,
      assignedRoles: [],
      today: '2026-10-20',
    });
    expect(view.readiness).toEqual([
      'NO_RESULTS_LOADED',
      'NO_ASSESSOR_ASSIGNED',
      'NO_LEAD_ASSESSOR_ASSIGNED',
      'NO_TPB_ASSIGNED',
      'NO_PPU_ASSIGNED',
    ]);
  });

  it('adds nothing for an assigned role no step needs', () => {
    const view = viewTimeline({
      steps,
      assignedRoles: ['ASSESSOR', 'TPB'],
      today: '2026-10-20',
    });
    expect(view.readiness).toEqual(['NO_RESULTS_LOADED']);
  });
});
