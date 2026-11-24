import { describe, expect, it } from 'vitest';
import type { RoleCode } from '../../users/permissions.js';
import { dayEnd, dayStart, nowInRome } from '../rome-date.js';
import {
  viewTimeline,
  type TimelineStepState,
  type TimelineView,
  type TimelineViewStep,
} from './timeline-view.js';

// Expected values are literals from the FR-12 and FR-13 scenarios (S-1: a step
// is open from 00:00 of `opensAt` to 23:59:59 of `closesAt`, Rome days). Step 1
// closes 6 Nov and step 2 opens 9 Nov, so 7 and 8 Nov are the gap. Every date
// row sits exactly on its boundary.
//
// timeline-edit FR-2 and FR-6 add the hold: step 1's day has arrived and the
// timeline has no load. Every fixture states `hasLoad` on purpose (DD-8): the
// FR-12 rows below are loaded, so they still read `live` and `finished`; the
// rows after them leave the load out, which is what exercises the hold.

const steps: TimelineViewStep[] = [
  {
    position: 1,
    audience: 'assessors',
    opensAt: dayStart('2026-10-26'),
    closesAt: dayEnd('2026-11-06'),
  },
  {
    position: 2,
    audience: 'programs',
    opensAt: dayStart('2026-11-09'),
    closesAt: dayEnd('2026-11-20'),
  },
];

/** A timeline with a load by default: the FR-12 behavior (timeline-edit FR-6 "Load present"). */
function at(today: string, hasLoad = true): TimelineView {
  return viewTimeline({
    steps,
    assignedRoles: [],
    now: dayStart(today),
    hasLoad,
  });
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
      now: dayStart('2026-11-06'),
      hasLoad: true,
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
      opensAt: dayStart('2026-10-26'),
      closesAt: dayEnd('2026-11-06'),
    },
    {
      position: 2,
      audience: 'programs',
      opensAt: dayStart('2026-11-09'),
      closesAt: dayEnd('2026-11-13'),
    },
    {
      position: 3,
      audience: 'lead_assessors',
      opensAt: dayStart('2026-11-16'),
      closesAt: dayEnd('2026-11-20'),
    },
    {
      position: 4,
      audience: 'tpb',
      opensAt: dayStart('2026-11-23'),
      closesAt: dayEnd('2026-11-27'),
    },
    {
      position: 5,
      audience: 'ppu',
      opensAt: dayStart('2026-11-30'),
      closesAt: dayEnd('2026-12-04'),
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
      now: dayStart('2026-10-20'),
      hasLoad: true,
    });
    expect(view.readiness).toEqual(['NO_RESULTS_LOADED']);
  });

  it('lists one item per missing role, in step order', () => {
    const view = viewTimeline({
      steps: fullSteps,
      assignedRoles: [],
      now: dayStart('2026-10-20'),
      hasLoad: true,
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
      now: dayStart('2026-10-20'),
      hasLoad: true,
    });
    expect(view.readiness).toEqual(['NO_RESULTS_LOADED']);
  });
});

// --- timeline-edit: the hold, the step state and the load seam -----------------

type Position =
  | 'before step 1'
  | 'step 1 opening day'
  | 'inside step 1'
  | 'step 1 closing day'
  | 'gap'
  | 'step 2 opening day'
  | 'last closing day'
  | 'after the last step';

/** Each date position of `steps`, exactly on its boundary. */
const DAY: Record<Position, string> = {
  'before step 1': '2026-10-25',
  'step 1 opening day': '2026-10-26',
  'inside step 1': '2026-10-30',
  'step 1 closing day': '2026-11-06',
  gap: '2026-11-07',
  'step 2 opening day': '2026-11-09',
  'last closing day': '2026-11-20',
  'after the last step': '2026-11-21',
};

describe('viewTimeline status: every status x hold x date position (FR-6)', () => {
  // [position, status with a load, status without a load]
  it.each<[Position, string, string]>([
    ['before step 1', 'scheduled', 'scheduled'],
    ['step 1 opening day', 'live', 'waiting_for_load'],
    ['inside step 1', 'live', 'waiting_for_load'],
    ['step 1 closing day', 'live', 'waiting_for_load'],
    ['gap', 'live', 'waiting_for_load'],
    ['step 2 opening day', 'live', 'waiting_for_load'],
    ['last closing day', 'live', 'waiting_for_load'],
    ['after the last step', 'finished', 'waiting_for_load'],
  ])(
    '%s: %s with a load, %s without one',
    (position, withLoad, withoutLoad) => {
      expect(at(DAY[position], true).status).toBe(withLoad);
      expect(at(DAY[position], false).status).toBe(withoutLoad);
    },
  );

  it('step 1 date arrives without a load: waiting for load, no current step, next step 1, and not live', () => {
    // GIVEN step 1 opens on 26 Oct and no load exists, read on 26 Oct
    const view = at('2026-10-26', false);
    expect(view.status).toBe('waiting_for_load');
    expect(view.status).not.toBe('live');
    expect(view.currentStep).toBeNull();
    expect(view.nextStep).toBe(1);
  });

  it('all dates passed while on hold: still waiting for load, not finished', () => {
    const view = at('2027-03-01', false);
    expect(view.status).toBe('waiting_for_load');
    expect(view.status).not.toBe('finished');
  });

  it('a load present gives the FR-12 status, current step and step states', () => {
    const view = at('2026-11-09', true);
    expect(view.status).toBe('live');
    expect(view.currentStep).toBe(2);
    expect(view.nextStep).toBeNull();
    expect(view.stepStates).toEqual({ 1: 'closed', 2: 'in_progress' });
  });

  it('the hold ends when step 1 is moved after today: scheduled again', () => {
    // GIVEN the timeline was on hold on 26 Oct, an ADMIN moves step 1 to 2 Nov
    const moved: TimelineViewStep[] = [
      {
        ...steps[0],
        opensAt: dayStart('2026-11-02'),
        closesAt: dayEnd('2026-11-06'),
      },
      steps[1],
    ];
    const view = viewTimeline({
      steps: moved,
      assignedRoles: [],
      now: dayStart('2026-10-26'),
      hasLoad: false,
    });
    expect(view.status).toBe('scheduled');
    expect(view.currentStep).toBeNull();
    expect(view.nextStep).toBe(1);
    expect(view.stepStates).toEqual({ 1: 'upcoming', 2: 'upcoming' });
  });

  it('a timeline without steps is scheduled, has no hold and no step state', () => {
    const view = viewTimeline({
      steps: [],
      assignedRoles: [],
      now: dayStart('2026-10-26'),
      hasLoad: false,
    });
    expect([view.status, view.currentStep, view.nextStep]).toEqual([
      'scheduled',
      null,
      null,
    ]);
    expect(view.stepStates).toEqual({});
  });
});

describe('viewTimeline during a hold: no current step, next step 1 (FR-6)', () => {
  it.each<Position>([
    'step 1 opening day',
    'inside step 1',
    'step 1 closing day',
    'gap',
    'step 2 opening day',
    'last closing day',
    'after the last step',
  ])('%s', (position) => {
    const view = at(DAY[position], false);
    expect([view.status, view.currentStep, view.nextStep]).toEqual([
      'waiting_for_load',
      null,
      1,
    ]);
  });
});

describe('viewTimeline step state at its boundaries (FR-2)', () => {
  // [day, state of step 1, state of step 2]. Step 1 is 26 Oct-6 Nov, step 2 is 9-20 Nov.
  it.each<[string, TimelineStepState, TimelineStepState]>([
    ['2026-10-25', 'upcoming', 'upcoming'],
    ['2026-10-26', 'in_progress', 'upcoming'],
    ['2026-11-06', 'in_progress', 'upcoming'],
    ['2026-11-07', 'closed', 'upcoming'],
    ['2026-11-08', 'closed', 'upcoming'],
    ['2026-11-09', 'closed', 'in_progress'],
    ['2026-11-20', 'closed', 'in_progress'],
    ['2026-11-21', 'closed', 'closed'],
  ])('with a load on %s: step 1 %s, step 2 %s', (day, first, second) => {
    expect(at(day, true).stepStates).toEqual({ 1: first, 2: second });
  });

  it.each([
    '2026-10-25',
    '2026-10-26',
    '2026-11-06',
    '2026-11-07',
    '2026-11-09',
    '2026-11-20',
    '2026-11-21',
  ])(
    'without a load on %s every step is upcoming (the hold), or the timeline is still scheduled',
    (day) => {
      expect(at(day, false).stepStates).toEqual({
        1: 'upcoming',
        2: 'upcoming',
      });
    },
  );

  it('on hold: step 1 opened on 2 Nov, step 2 opens on 10 Nov, today is 12 Nov: every step upcoming, step 2 not in progress', () => {
    const view = viewTimeline({
      steps: [
        {
          position: 1,
          audience: 'assessors',
          opensAt: dayStart('2026-11-02'),
          closesAt: dayEnd('2026-11-06'),
        },
        {
          position: 2,
          audience: 'programs',
          opensAt: dayStart('2026-11-10'),
          closesAt: dayEnd('2026-11-20'),
        },
      ],
      assignedRoles: [],
      now: dayStart('2026-11-12'),
      hasLoad: false,
    });
    expect(view.stepStates).toEqual({ 1: 'upcoming', 2: 'upcoming' });
    expect(view.stepStates[2]).not.toBe('in_progress');
  });

  it('keeps each step under its own position, whatever the order of the input', () => {
    const view = viewTimeline({
      steps: [steps[1], steps[0]],
      assignedRoles: [],
      now: dayStart('2026-11-09'),
      hasLoad: true,
    });
    expect(view.stepStates).toEqual({ 1: 'closed', 2: 'in_progress' });
  });
});

describe('viewTimeline over Rome instants (NFR-4: midnight and both daylight-saving changes)', () => {
  /** The view at an instant, as the service reads it: the Rome minute from the clock. */
  function atInstant(
    instant: string,
    stepsOf: TimelineViewStep[],
    hasLoad: boolean,
  ): TimelineView {
    return viewTimeline({
      steps: stepsOf,
      assignedRoles: [],
      now: nowInRome(new Date(instant)),
      hasLoad,
    });
  }

  const one = (opensOn: string, closesOn: string): TimelineViewStep[] => [
    {
      position: 1,
      audience: 'assessors',
      opensAt: dayStart(opensOn),
      closesAt: dayEnd(closesOn),
    },
  ];

  describe('midnight boundary (FR-2): step 1 closes on 6 Nov, Rome is UTC+1', () => {
    // 23:59 Rome on 6 Nov = 22:59Z; 00:00 Rome on 7 Nov = 23:00Z
    const closing = one('2026-10-26', '2026-11-06');

    it('with a load: in progress at 23:59 on 6 Nov, closed at 00:00 on 7 Nov', () => {
      expect(
        atInstant('2026-11-06T22:59:00Z', closing, true).stepStates[1],
      ).toBe('in_progress');
      expect(
        atInstant('2026-11-06T23:00:00Z', closing, true).stepStates[1],
      ).toBe('closed');
    });

    it('without a load: upcoming and waiting for load at both instants', () => {
      for (const instant of ['2026-11-06T22:59:00Z', '2026-11-06T23:00:00Z']) {
        const view = atInstant(instant, closing, false);
        expect(view.stepStates[1]).toBe('upcoming');
        expect(view.status).toBe('waiting_for_load');
      }
    });
  });

  describe('midnight before step 1 (FR-6): step 1 opens on 2 Nov', () => {
    // 23:59 Rome on 1 Nov = 22:59Z; 00:00 Rome on 2 Nov = 23:00Z
    const opening = one('2026-11-02', '2026-11-06');

    it('with a load: scheduled at 23:59 on 1 Nov, live at 00:00 on 2 Nov', () => {
      expect(atInstant('2026-11-01T22:59:00Z', opening, true).status).toBe(
        'scheduled',
      );
      const after = atInstant('2026-11-01T23:00:00Z', opening, true);
      expect([after.status, after.currentStep]).toEqual(['live', 1]);
    });

    it('without a load: scheduled at 23:59 on 1 Nov, waiting for load at 00:00 on 2 Nov', () => {
      const before = atInstant('2026-11-01T22:59:00Z', opening, false);
      expect([before.status, before.nextStep]).toEqual(['scheduled', 1]);
      const after = atInstant('2026-11-01T23:00:00Z', opening, false);
      expect([after.status, after.currentStep, after.nextStep]).toEqual([
        'waiting_for_load',
        null,
        1,
      ]);
    });
  });

  describe('autumn change: Rome leaves summer time at 03:00 on 25 Oct 2026', () => {
    // 24 Oct 23:59 Rome = 21:59Z (UTC+2); 00:00 on 25 Oct = 22:00Z;
    // 23:30 on 25 Oct = 22:30Z (UTC+1); 00:00 on 26 Oct = 23:00Z.
    const closes = one('2026-10-19', '2026-10-25');
    const opens = one('2026-10-25', '2026-10-30');

    it('a step that closes on 25 Oct is still open at 23:30 Rome on 25 Oct, closed at 00:00 on 26 Oct', () => {
      expect(
        atInstant('2026-10-25T22:30:00Z', closes, true).stepStates[1],
      ).toBe('in_progress');
      expect(
        atInstant('2026-10-25T23:00:00Z', closes, true).stepStates[1],
      ).toBe('closed');
    });

    it('a step that opens on 25 Oct is upcoming at 23:59 on 24 Oct, open at 00:00 on 25 Oct', () => {
      expect(atInstant('2026-10-24T21:59:00Z', opens, true).stepStates[1]).toBe(
        'upcoming',
      );
      expect(atInstant('2026-10-24T22:00:00Z', opens, true).stepStates[1]).toBe(
        'in_progress',
      );
    });

    it('without a load the hold starts at 00:00 Rome on 25 Oct, not an hour earlier or later', () => {
      expect(atInstant('2026-10-24T21:59:00Z', opens, false).status).toBe(
        'scheduled',
      );
      expect(atInstant('2026-10-24T22:00:00Z', opens, false).status).toBe(
        'waiting_for_load',
      );
    });
  });

  describe('spring change: Rome enters summer time at 02:00 on 29 Mar 2026', () => {
    // 28 Mar 23:59 Rome = 22:59Z (UTC+1); 00:00 on 29 Mar = 23:00Z;
    // 23:59 on 29 Mar = 21:59Z (UTC+2); 00:00 on 30 Mar = 22:00Z.
    const closes = one('2026-03-23', '2026-03-29');
    const opens = one('2026-03-29', '2026-04-03');

    it('a step that closes on 29 Mar is open at 23:59 Rome, closed at 00:00 on 30 Mar', () => {
      expect(
        atInstant('2026-03-29T21:59:00Z', closes, true).stepStates[1],
      ).toBe('in_progress');
      expect(
        atInstant('2026-03-29T22:00:00Z', closes, true).stepStates[1],
      ).toBe('closed');
    });

    it('a step that opens on 29 Mar is upcoming at 23:59 on 28 Mar, open at 00:00 on 29 Mar', () => {
      expect(atInstant('2026-03-28T22:59:00Z', opens, true).stepStates[1]).toBe(
        'upcoming',
      );
      expect(atInstant('2026-03-28T23:00:00Z', opens, true).stepStates[1]).toBe(
        'in_progress',
      );
    });

    it('without a load the hold starts at 00:00 Rome on 29 Mar', () => {
      expect(atInstant('2026-03-28T22:59:00Z', opens, false).status).toBe(
        'scheduled',
      );
      expect(atInstant('2026-03-28T23:00:00Z', opens, false).status).toBe(
        'waiting_for_load',
      );
    });
  });
});

describe('viewTimeline readiness does not depend on the hold (FR-6, FR-14)', () => {
  it('lists the same items with and without a load', () => {
    expect(at('2026-11-07', false).readiness).toEqual(
      at('2026-11-07', true).readiness,
    );
  });
});

// --- timeline-step-times: minutes (FR-2, FR-4, FR-7) ---------------------------
// Rome is UTC+1 on 10-12 Nov 2026, so 14:00 Rome is 13:00Z. Every row sits on
// its boundary; expected values are literals from the scenarios.

describe('viewTimeline over Rome minutes (timeline-step-times)', () => {
  const minute = (instant: string) => nowInRome(new Date(instant));
  const stepOf = (opensAt: string, closesAt: string): TimelineViewStep[] => [
    {
      position: 1,
      audience: 'assessors',
      opensAt: opensAt as TimelineViewStep['opensAt'],
      closesAt: closesAt as TimelineViewStep['closesAt'],
    },
  ];
  const viewAt = (
    instant: string,
    stepsOf: TimelineViewStep[],
    hasLoad: boolean,
  ): TimelineView =>
    viewTimeline({
      steps: stepsOf,
      assignedRoles: [],
      now: minute(instant),
      hasLoad,
    });

  describe('FR-2: boundaries of a step that runs 10 Nov 14:00 to 12 Nov 17:30', () => {
    const window = stepOf('2026-11-10T14:00', '2026-11-12T17:30');

    it.each<[string, string, TimelineStepState]>([
      ['13:59:59 on 10 Nov', '2026-11-10T12:59:59Z', 'upcoming'],
      ['14:00:00 on 10 Nov', '2026-11-10T13:00:00Z', 'in_progress'],
      ['17:30:59 on 12 Nov', '2026-11-12T16:30:59Z', 'in_progress'],
      ['17:31:00 on 12 Nov', '2026-11-12T16:31:00Z', 'closed'],
    ])('at %s the state is %s', (_label, instant, state) => {
      expect(viewAt(instant, window, true).stepStates[1]).toBe(state);
    });
  });

  describe('FR-2: a whole-day window is open exactly on 2-6 Nov', () => {
    const wholeDays = stepOf('2026-11-02T00:00', '2026-11-06T23:59');

    it.each<[string, string, TimelineStepState]>([
      ['23:59 on 1 Nov', '2026-11-01T22:59:00Z', 'upcoming'],
      ['00:00 on 2 Nov', '2026-11-01T23:00:00Z', 'in_progress'],
      ['23:59:59 on 6 Nov', '2026-11-06T22:59:59Z', 'in_progress'],
      ['00:00 on 7 Nov', '2026-11-06T23:00:00Z', 'closed'],
    ])('at %s the state is %s', (_label, instant, state) => {
      expect(viewAt(instant, wholeDays, true).stepStates[1]).toBe(state);
    });
  });

  describe('FR-4: a step that spans the autumn change (24 Oct 09:00 to 26 Oct 09:00)', () => {
    const spanning = stepOf('2026-10-24T09:00', '2026-10-26T09:00');

    it('is in progress at 02:30 Rome on 25 Oct, in both occurrences of that hour', () => {
      // 02:30 CEST (UTC+2) = 00:30Z, then 02:30 CET (UTC+1) = 01:30Z
      for (const instant of ['2026-10-25T00:30:00Z', '2026-10-25T01:30:00Z']) {
        expect(viewAt(instant, spanning, true).stepStates[1]).toBe(
          'in_progress',
        );
      }
    });
  });

  describe('FR-7: the hold starts at the opening hour', () => {
    const opensAtTwo = stepOf('2026-11-10T14:00', '2026-11-12T17:30');

    it('is scheduled at 13:59 and waiting for load at 14:00 on 10 Nov', () => {
      expect(viewAt('2026-11-10T12:59:00Z', opensAtTwo, false).status).toBe(
        'scheduled',
      );
      expect(viewAt('2026-11-10T13:00:00Z', opensAtTwo, false).status).toBe(
        'waiting_for_load',
      );
    });

    it('is not waiting for load at 00:00 that day', () => {
      // 00:00 Rome on 10 Nov = 23:00Z on 9 Nov
      const view = viewAt('2026-11-09T23:00:00Z', opensAtTwo, false);
      expect(view.status).toBe('scheduled');
      expect(view.status).not.toBe('waiting_for_load');
    });
  });

  describe('FR-7: between two steps on the same day', () => {
    const sameDay: TimelineViewStep[] = [
      ...stepOf('2026-11-10T08:00', '2026-11-10T12:00'),
      {
        position: 2,
        audience: 'programs',
        opensAt: '2026-11-10T14:00' as TimelineViewStep['opensAt'],
        closesAt: '2026-11-10T18:00' as TimelineViewStep['closesAt'],
      },
    ];

    it('has no current step and step 2 next at 13:00', () => {
      // 13:00 Rome = 12:00Z
      const view = viewAt('2026-11-10T12:00:00Z', sameDay, true);
      expect([view.currentStep, view.nextStep]).toEqual([null, 2]);
    });
  });
});
