// @akili-spec assessment/step-1-assessment
import { describe, expect, it } from 'vitest';
import { nowInRome, type RomeMinute } from '../admin-config/rome-date.js';
import type { TimelineViewStep } from '../admin-config/timelines/timeline-view.js';
import {
  audienceStepState,
  currentStepPosition,
  currentStepPositionsOf,
  enabledReviewerRows,
  findRoleStep,
  isRoleStepOpen,
  isWithdrawWindowOpen,
  ROLE_STEPS,
  roleStepState,
} from './role-steps.js';

// Expected values are literals from design 7.1's table and from FR-2's scenario
// *Step 1 not yet open, then closed*: step 1 opens 2026-11-12T09:00 Rome and
// closes 2026-11-20T17:30 Rome. Rome is UTC+1 on those days, so 09:00 Rome is
// 08:00 UTC. Instants go through `nowInRome`, the helper the services use.

const minute = (value: string) => value as RomeMinute;

const steps: TimelineViewStep[] = [
  {
    position: 1,
    audience: 'assessors',
    opensAt: minute('2026-11-12T09:00'),
    closesAt: minute('2026-11-20T17:30'),
  },
  {
    position: 2,
    audience: 'programs',
    opensAt: minute('2026-11-23T09:00'),
    closesAt: minute('2026-11-27T17:30'),
  },
];

const assessor = findRoleStep('ASSESSOR')!;
const timing = (utc: string, hasLoad = true) => ({
  steps,
  now: nowInRome(new Date(utc)),
  hasLoad,
});

describe('role-step table (design 7.1)', () => {
  it('declares the five rows as the design lists them', () => {
    expect(
      ROLE_STEPS.map((row) => [
        row.role,
        row.permission,
        row.audience,
        row.round,
        row.enabled,
        row.access,
      ]),
    ).toEqual([
      ['ASSESSOR', 'ASSESSOR_ACCESS', 'assessors', 1, true, 'write'],
      ['LEAD_ASSESSOR', 'LEAD_ACCESS', 'lead_assessors', 2, true, 'write'],
      ['TPB', 'TPB_ACCESS', 'tpb', 2, false, 'write'],
      ['PPU', 'PPU_ACCESS', 'ppu', 2, false, 'write'],
      ['ADMIN', 'ADMIN_ACCESS', null, null, true, 'read'],
    ]);
  });

  // FR-1 / FR-16: the Lead row is the only one this spec enables; TPB and PPU stay designed only.
  it('enables ASSESSOR and LEAD_ASSESSOR as writers, and leaves TPB and PPU disabled', () => {
    expect(enabledReviewerRows().map((row) => row.role)).toEqual([
      'ASSESSOR',
      'LEAD_ASSESSOR',
    ]);
    expect(findRoleStep('TPB')!.enabled).toBe(false);
    expect(findRoleStep('PPU')!.enabled).toBe(false);
  });

  it('has no row for a role with no worklist (PROGRAM, GUEST)', () => {
    expect(findRoleStep('PROGRAM')).toBeUndefined();
    expect(findRoleStep('GUEST')).toBeUndefined();
  });
});

describe('step open at the clock minute (FR-2)', () => {
  it.each<[string, string, boolean]>([
    ['opensAt -1 minute (08:59)', '2026-11-12T07:59:00Z', false],
    ['opensAt exactly (09:00:00)', '2026-11-12T08:00:00Z', true],
    ['opensAt +0:59 (09:00:59)', '2026-11-12T08:00:59Z', true],
    ['closesAt :59 (17:30:59)', '2026-11-20T16:30:59Z', true],
    ['closesAt +1 minute (17:31:00)', '2026-11-20T16:31:00Z', false],
  ])('%s -> open: %s', (_name, utc, open) => {
    expect(isRoleStepOpen(assessor, timing(utc))).toBe(open);
  });

  it('reports which side of the window a closed answer is on', () => {
    expect(roleStepState(assessor, timing('2026-11-12T07:59:00Z'))).toEqual({
      position: 1,
      state: 'upcoming',
    });
    expect(roleStepState(assessor, timing('2026-11-20T16:31:00Z'))).toEqual({
      position: 1,
      state: 'closed',
    });
  });

  it('is on hold while the timeline has no load, even inside the window (DD-2)', () => {
    const inside = '2026-11-15T10:00:00Z';
    expect(isRoleStepOpen(assessor, timing(inside, true))).toBe(true);
    expect(isRoleStepOpen(assessor, timing(inside, false))).toBe(false);
    // The hold wins after every closing minute too.
    expect(
      roleStepState(assessor, timing('2026-12-30T10:00:00Z', false)),
    ).toEqual({
      position: 1,
      state: 'upcoming',
    });
  });

  it('never opens a role whose audience has no step in the timeline', () => {
    const lead = findRoleStep('LEAD_ASSESSOR')!;
    expect(roleStepState(lead, timing('2026-11-15T10:00:00Z'))).toBeNull();
    expect(isRoleStepOpen(lead, timing('2026-11-15T10:00:00Z'))).toBe(false);
  });

  // FR-1: the Lead writes only while its own step (3) is in progress, on the same minute rule.
  it('opens the Lead on its own step window (step 3, 24 Nov 09:00 to 27 Nov 17:30 Rome)', () => {
    const lead = findRoleStep('LEAD_ASSESSOR')!;
    const withLead = (utc: string) => ({
      ...timing(utc),
      steps: [
        ...steps,
        {
          position: 3,
          audience: 'lead_assessors' as const,
          opensAt: minute('2026-11-24T09:00'),
          closesAt: minute('2026-11-27T17:30'),
        },
      ],
    });
    expect(roleStepState(lead, withLead('2026-11-24T07:59:00Z'))).toEqual({
      position: 3,
      state: 'upcoming',
    });
    expect(roleStepState(lead, withLead('2026-11-25T10:00:00Z'))).toEqual({
      position: 3,
      state: 'in_progress',
    });
    expect(roleStepState(lead, withLead('2026-11-27T16:31:00Z'))).toEqual({
      position: 3,
      state: 'closed',
    });
  });

  it('gives ADMIN no step: it never writes through its row', () => {
    const admin = findRoleStep('ADMIN')!;
    expect(roleStepState(admin, timing('2026-11-15T10:00:00Z'))).toBeNull();
  });

  it('finds the step of another audience, for the clarification predicate', () => {
    expect(audienceStepState('programs', timing('2026-11-24T10:00:00Z'))).toBe(
      'in_progress',
    );
    expect(audienceStepState('programs', timing('2026-11-15T10:00:00Z'))).toBe(
      'upcoming',
    );
    expect(audienceStepState('tpb', timing('2026-11-15T10:00:00Z'))).toBeNull();
  });
});

// OQ-8 (FR-13): a withdraw is allowed while step 1 (assessors) OR step 2
// (programs) is open, on the same minute rule as FR-2. The expected values are
// written out from the two windows above (Rome is UTC+1: 09:00 is 08:00 UTC).
describe('withdraw window (OQ-8, FR-13)', () => {
  it.each<[string, string, boolean]>([
    ['before step 1 (08:59 on 12 Nov)', '2026-11-12T07:59:00Z', false],
    ['step 1 opens (09:00 on 12 Nov)', '2026-11-12T08:00:00Z', true],
    ['inside step 1', '2026-11-15T10:00:00Z', true],
    [
      'step 1 closing minute (17:30:59 on 20 Nov)',
      '2026-11-20T16:30:59Z',
      true,
    ],
    ['between the steps (17:31 on 20 Nov)', '2026-11-20T16:31:00Z', false],
    ['the day before step 2', '2026-11-22T10:00:00Z', false],
    ['step 2 opens (09:00 on 23 Nov)', '2026-11-23T08:00:00Z', true],
    [
      'step 2 closing minute (17:30:59 on 27 Nov)',
      '2026-11-27T16:30:59Z',
      true,
    ],
    ['after step 2 (17:31 on 27 Nov)', '2026-11-27T16:31:00Z', false],
  ])('%s -> open: %s', (_name, utc, open) => {
    expect(isWithdrawWindowOpen(timing(utc))).toBe(open);
  });

  it('is closed while the timeline has no load, even inside a window (DD-2)', () => {
    expect(isWithdrawWindowOpen(timing('2026-11-15T10:00:00Z', false))).toBe(
      false,
    );
    expect(isWithdrawWindowOpen(timing('2026-11-24T10:00:00Z', false))).toBe(
      false,
    );
  });

  // Round 2 (FR-9): the lead_assessors step also opens the window, for a round-2 comment only.
  it('opens during the lead_assessors step for a round-2 comment, never for round 1', () => {
    const steps = [
      ...timing('2026-12-10T10:00:00Z').steps,
      {
        position: 3,
        name: 'Step 3',
        audience: 'lead_assessors' as const,
        opensAt: '2026-12-01T00:00' as never,
        closesAt: '2026-12-31T23:59' as never,
      },
    ];
    const at = {
      steps,
      now: nowInRome(new Date('2026-12-10T10:00:00Z')),
      hasLoad: true,
    };
    expect(isWithdrawWindowOpen(at, 2)).toBe(true);
    expect(isWithdrawWindowOpen(at, 1)).toBe(false);
    expect(isWithdrawWindowOpen(at)).toBe(false);
  });

  it('is closed when the timeline has neither step', () => {
    expect(
      isWithdrawWindowOpen({
        steps: [],
        now: nowInRome(new Date('2026-11-15T10:00:00Z')),
        hasLoad: true,
      }),
    ).toBe(false);
  });
});

// DD-3: the current step of a membership. Round 1 reads the assessors step; round 2 the latest
// existing assessment among steps 3 to 5, else step 3. Literals written out from the design.
describe('current step (DD-3)', () => {
  const five: TimelineViewStep[] = [
    {
      position: 1,
      audience: 'assessors',
      opensAt: minute('2026-11-12T09:00'),
      closesAt: minute('2026-11-20T17:30'),
    },
    {
      position: 2,
      audience: 'programs',
      opensAt: minute('2026-11-23T09:00'),
      closesAt: minute('2026-11-27T17:30'),
    },
    {
      position: 3,
      audience: 'lead_assessors',
      opensAt: minute('2026-11-28T09:00'),
      closesAt: minute('2026-11-30T17:30'),
    },
    {
      position: 4,
      audience: 'tpb',
      opensAt: minute('2026-12-01T09:00'),
      closesAt: minute('2026-12-02T17:30'),
    },
    {
      position: 5,
      audience: 'ppu',
      opensAt: minute('2026-12-03T09:00'),
      closesAt: minute('2026-12-04T17:30'),
    },
  ];

  it('finds the assessors step and the round-2 steps in position order', () => {
    expect(currentStepPositionsOf(five)).toEqual({
      assessmentStepPosition: 1,
      roundTwoStepPositions: [3, 4, 5],
    });
    expect(currentStepPositionsOf(steps)).toEqual({
      assessmentStepPosition: 1,
      roundTwoStepPositions: [],
    });
  });

  it.each<[string, number, number[], number | null]>([
    ['round 1 reads the assessors step whatever exists', 1, [3], 1],
    ['round 2 with no assessment reads step 3', 2, [], 3],
    ['round 2 with a step-3 assessment reads step 3', 2, [3], 3],
    ['round 2 with steps 3 and 4 reads the latest, step 4', 2, [3, 4], 4],
    ['round 2 ignores an assessment outside steps 3 to 5', 2, [1, 2], 3],
  ])('%s', (_name, round, existing, expected) => {
    expect(
      currentStepPosition(currentStepPositionsOf(five), round, existing),
    ).toBe(expected);
  });

  it('is null when the timeline has no step of the round', () => {
    expect(
      currentStepPosition(currentStepPositionsOf(steps), 2, []),
    ).toBeNull();
  });
});
