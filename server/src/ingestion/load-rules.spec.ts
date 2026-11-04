import { describe, expect, it } from 'vitest';
import type { RomeMinute } from '../admin-config/rome-date.js';
import {
  effectiveLoadStatus,
  loadWindow,
  membershipEnds,
  mergeSummary,
  skipVerdict,
  timelineHasLoad,
  type CycleMembership,
  type LoadSummary,
} from './load-rules.js';

// Every expected value is a literal taken from the FR-2, FR-4, FR-9 and FR-11
// scenarios and design 7.4; none is computed by the rules.
const m = (value: string) => value as RomeMinute;

describe('loadWindow (FR-2)', () => {
  const closesAt = m('2026-11-20T17:30');
  it.each([
    ['active', '2026-11-10T09:00', 'open'],
    ['active', '2026-11-20T17:29', 'open'],
    ['active', '2026-11-20T17:30', 'open'],
    ['active', '2026-11-20T17:31', 'LOADS_WINDOW_CLOSED'],
    ['closed', '2026-11-10T09:00', 'CYCLES_CLOSED'],
    ['closed', '2026-11-20T17:31', 'CYCLES_CLOSED'],
    ['draft', '2026-11-20T17:30', 'open'],
  ] as const)('%s cycle at %s -> %s', (cycle, now, expected) => {
    expect(loadWindow(cycle, closesAt, m(now))).toBe(expected);
  });
});

describe('effectiveLoadStatus (FR-9)', () => {
  const now = new Date('2026-11-10T10:00:00Z');
  it.each([
    ['running', '2026-11-10T09:55:01Z', 'running', null],
    ['running', '2026-11-10T09:55:00Z', 'running', null],
    ['running', '2026-11-10T09:54:59Z', 'failed', 'ABANDONED'],
    ['running', '2026-11-10T09:54:00Z', 'failed', 'ABANDONED'],
    ['completed', '2026-11-10T09:00:00Z', 'completed', null],
    ['failed', '2026-11-10T09:00:00Z', 'failed', null],
  ] as const)('%s with heartbeat %s -> %s / %s', (status, beat, s, reason) => {
    expect(effectiveLoadStatus(status, new Date(beat), now)).toEqual({
      status: s,
      failureReason: reason,
    });
  });
});

describe('membershipEnds (DD-5)', () => {
  it.each([
    ['2026-11-09T09:00', '2026-11-10T09:00', true],
    ['2026-11-10T08:59', '2026-11-10T09:00', true],
    ['2026-11-10T09:00', '2026-11-10T09:00', false],
    ['2026-11-10T09:01', '2026-11-10T09:00', false],
  ])('last step closes %s, now %s -> ends %s', (closes, now, expected) => {
    expect(membershipEnds(m(closes), m(now))).toBe(expected);
  });
});

describe('skipVerdict (FR-4, DD-11)', () => {
  const now = m('2026-11-10T09:00');
  const T = 1;
  const U = 2;
  const open = m('2026-11-20T17:30');
  const closed = m('2026-11-09T17:30');
  const active = (
    timelineId: number,
    lastStepClosesAt: RomeMinute,
  ): CycleMembership => ({
    timelineId,
    endedAt: null,
    lastStepClosesAt,
  });
  const ended = (
    timelineId: number,
    lastStepClosesAt: RomeMinute,
  ): CycleMembership => ({
    timelineId,
    endedAt: new Date('2026-11-01T00:00:00Z'),
    lastStepClosesAt,
  });

  const rows: Array<
    [string, CycleMembership[], boolean, ReturnType<typeof skipVerdict>]
  > = [
    ['no memberships', [], false, null],
    [
      'active in U, U still open',
      [active(U, open)],
      false,
      { reason: 'ACTIVE_IN_OTHER_TIMELINE', timelineId: 2 },
    ],
    ['active in U, U closed yesterday', [active(U, closed)], false, null],
    [
      'active in U closing this minute',
      [active(U, now)],
      false,
      { reason: 'ACTIVE_IN_OTHER_TIMELINE', timelineId: 2 },
    ],
    ['ended in U', [ended(U, open)], false, null],
    [
      'active in T',
      [active(T, open)],
      false,
      { reason: 'ALREADY_IN_THIS_TIMELINE' },
    ],
    [
      'ended in T',
      [ended(T, closed)],
      false,
      { reason: 'ALREADY_IN_THIS_TIMELINE' },
    ],
    ['duplicate only', [], true, { reason: 'DUPLICATE_RESULT_CODE' }],
    [
      'duplicate and active in U',
      [active(U, open)],
      true,
      { reason: 'ACTIVE_IN_OTHER_TIMELINE', timelineId: 2 },
    ],
    [
      'duplicate and in T',
      [ended(T, closed)],
      true,
      { reason: 'ALREADY_IN_THIS_TIMELINE' },
    ],
    [
      'duplicate and U closed',
      [active(U, closed)],
      true,
      { reason: 'DUPLICATE_RESULT_CODE' },
    ],
    [
      'active in U open and ended in T',
      [active(U, open), ended(T, closed)],
      false,
      { reason: 'ACTIVE_IN_OTHER_TIMELINE', timelineId: 2 },
    ],
    [
      'U closed and ended in T',
      [active(U, closed), ended(T, closed)],
      false,
      { reason: 'ALREADY_IN_THIS_TIMELINE' },
    ],
  ];
  it.each(rows)('%s', (_name, memberships, duplicated, expected) => {
    expect(
      skipVerdict({ timelineId: T, now, memberships, duplicated }),
    ).toEqual(expected);
  });
});

describe('mergeSummary (design 7.4)', () => {
  const a: LoadSummary = {
    loaded: 2,
    byProgram: { SP01: 2 },
    byType: { policy_change: 2 },
    kpGroups: {},
    skipped: { ALREADY_IN_THIS_TIMELINE: 1 },
    otherTimelines: { '7': { name: 'U', count: 1 } },
  };
  const b: LoadSummary = {
    loaded: 3,
    byProgram: { SP01: 1, SP02: 2 },
    byType: { knowledge_product: 3 },
    kpGroups: { review: 2, auto_checked: 1 },
    skipped: { DUPLICATE_RESULT_CODE: 1 },
    otherTimelines: {
      '7': { name: 'U', count: 2 },
      '9': { name: 'V', count: 1 },
    },
  };
  const c: LoadSummary = {
    loaded: 1,
    byProgram: { SP02: 1 },
    byType: { knowledge_product: 1 },
    kpGroups: { review: 1 },
    skipped: { ALREADY_IN_THIS_TIMELINE: 2 },
    otherTimelines: { '9': { name: 'V', count: 4 } },
  };
  const expectedAll: LoadSummary = {
    loaded: 6,
    byProgram: { SP01: 3, SP02: 3 },
    byType: { policy_change: 2, knowledge_product: 4 },
    kpGroups: { review: 3, auto_checked: 1 },
    skipped: { ALREADY_IN_THIS_TIMELINE: 3, DUPLICATE_RESULT_CODE: 1 },
    otherTimelines: {
      '7': { name: 'U', count: 3 },
      '9': { name: 'V', count: 5 },
    },
  };

  it('sums two lots key by key', () => {
    expect(mergeSummary(a, b)).toEqual({
      loaded: 5,
      byProgram: { SP01: 3, SP02: 2 },
      byType: { policy_change: 2, knowledge_product: 3 },
      kpGroups: { review: 2, auto_checked: 1 },
      skipped: { ALREADY_IN_THIS_TIMELINE: 1, DUPLICATE_RESULT_CODE: 1 },
      otherTimelines: {
        '7': { name: 'U', count: 3 },
        '9': { name: 'V', count: 1 },
      },
    });
  });
  it('is associative', () => {
    expect(mergeSummary(mergeSummary(a, b), c)).toEqual(expectedAll);
    expect(mergeSummary(a, mergeSummary(b, c))).toEqual(expectedAll);
  });
});

describe('timelineHasLoad (FR-11, S-6)', () => {
  it.each([
    [0, 0, false, false],
    [0, 1, false, true],
    [3, 0, false, true],
    [0, 0, true, true],
  ])(
    'members %i, completed %i, running alive %s -> %s',
    (memberships, completedLoads, runningLoadAlive, expected) => {
      expect(
        timelineHasLoad({ memberships, completedLoads, runningLoadAlive }),
      ).toBe(expected);
    },
  );
});
