import { describe, expect, it } from 'vitest';
import type { RomeMinute } from '../admin-config/rome-date.js';
import { snapshotSortSuffix } from '../database/dynamodb/entities/result-snapshot.entity.js';
import type { TimelineResultEndReason } from '../database/drizzle/schema/timeline-results.js';
import {
  EMPTY_SUMMARY,
  canonicalJson,
  changedFields,
  effectiveLoadStatus,
  entryRound,
  isResubmitted,
  membershipEnds,
  mergeSummary,
  skipVerdict,
  SNAPSHOT_SK_PREFIX,
  snapshotKeyOf,
  stepInForce,
  syncWindow,
  timelineHasLoad,
  titleOf,
  type CycleMembership,
  type LoadSummary,
  type RoundStep,
} from './load-rules.js';

// Every expected value is a literal taken from the timeline-sync FR-1, FR-2,
// FR-4, FR-8, FR-9 scenarios and design 7.4; none is computed by the rules.
const m = (value: string) => value as RomeMinute;

describe('syncWindow (FR-1)', () => {
  const lastCloses = m('2026-12-03T23:59');
  it.each([
    ['active', '2026-11-01T09:00', 'open'],
    ['active', '2026-11-20T17:30', 'open'],
    ['active', '2026-12-03T23:58', 'open'],
    ['active', '2026-12-03T23:59', 'open'],
    ['active', '2026-12-04T00:00', 'LOADS_WINDOW_CLOSED'],
    ['closed', '2026-11-10T09:00', 'CYCLES_CLOSED'],
    ['closed', '2026-12-04T00:00', 'CYCLES_CLOSED'],
    ['draft', '2026-12-03T23:59', 'open'],
  ] as const)('%s cycle at %s -> %s', (cycle, now, expected) => {
    expect(syncWindow(cycle, lastCloses, m(now))).toBe(expected);
  });
});

describe('stepInForce and entryRound (FR-2, DD-1)', () => {
  const step = (
    position: number,
    opensAt: string,
    round: number,
  ): RoundStep => ({ position, opensAt: m(opensAt), round });
  const opens = [
    '2026-11-02T09:00',
    '2026-11-09T09:00',
    '2026-11-16T09:00',
    '2026-11-23T09:00',
    '2026-11-30T09:00',
  ];
  const shape = (rounds: number[]): RoundStep[] =>
    rounds.map((round, i) => step(i + 1, opens[i]!, round));

  // Every shape is read at the same four minutes per step (FR-2 Boundaries):
  // one minute before the step opens, its opening minute, its closing minute
  // and the gap minute after it closes. The 5-step shapes open at 11-02T09:00,
  // 11-09T09:00, 11-16T09:00, 11-23T09:00, 11-30T09:00 and close at
  // 11-06T17:00, 11-13T17:00, 11-20T17:00, 11-27T17:00, 12-03T23:59; the
  // one-step timeline opens at 11-02T09:00 and closes at 11-06T17:00. The step
  // in force is the last one opened, so a close or a gap keeps the step that
  // closed. Each row is [now, position, round], written by hand per FR-2.
  const defaultRows: Array<[string, number, number]> = [
    // Step 1: before any step opens, step 1 is in force (round 1).
    ['2026-11-02T08:59', 1, 1],
    ['2026-11-02T09:00', 1, 1],
    ['2026-11-06T17:00', 1, 1],
    ['2026-11-06T17:01', 1, 1],
    // Step 2 (round 1)
    ['2026-11-09T08:59', 1, 1],
    ['2026-11-09T09:00', 2, 1],
    ['2026-11-13T17:00', 2, 1],
    ['2026-11-13T17:01', 2, 1],
    // Step 3 (round 2)
    ['2026-11-16T08:59', 2, 1],
    ['2026-11-16T09:00', 3, 2],
    ['2026-11-20T17:00', 3, 2],
    ['2026-11-20T17:01', 3, 2],
    // Step 4 (round 2)
    ['2026-11-23T08:59', 3, 2],
    ['2026-11-23T09:00', 4, 2],
    ['2026-11-27T17:00', 4, 2],
    ['2026-11-27T17:01', 4, 2],
    // Step 5 (round 2)
    ['2026-11-30T08:59', 4, 2],
    ['2026-11-30T09:00', 5, 2],
    ['2026-12-03T23:59', 5, 2],
    ['2026-12-04T00:00', 5, 2],
  ];
  // Same minutes; the admin set rounds 1,1,1,2,2 (FR-2 "Round set by the
  // admin"): steps 1-3 are round 1, steps 4-5 are round 2.
  const adminRows: Array<[string, number, number]> = [
    // Step 1
    ['2026-11-02T08:59', 1, 1],
    ['2026-11-02T09:00', 1, 1],
    ['2026-11-06T17:00', 1, 1],
    ['2026-11-06T17:01', 1, 1],
    // Step 2
    ['2026-11-09T08:59', 1, 1],
    ['2026-11-09T09:00', 2, 1],
    ['2026-11-13T17:00', 2, 1],
    ['2026-11-13T17:01', 2, 1],
    // Step 3: still round 1 here, where the default timeline turns to round 2.
    ['2026-11-16T08:59', 2, 1],
    ['2026-11-16T09:00', 3, 1],
    ['2026-11-20T17:00', 3, 1],
    ['2026-11-20T17:01', 3, 1],
    // Step 4: round 2 starts here.
    ['2026-11-23T08:59', 3, 1],
    ['2026-11-23T09:00', 4, 2],
    ['2026-11-27T17:00', 4, 2],
    ['2026-11-27T17:01', 4, 2],
    // Step 5
    ['2026-11-30T08:59', 4, 2],
    ['2026-11-30T09:00', 5, 2],
    ['2026-12-03T23:59', 5, 2],
    ['2026-12-04T00:00', 5, 2],
  ];
  const oneStepRows: Array<[string, number, number]> = [
    ['2026-11-02T08:59', 1, 1],
    ['2026-11-02T09:00', 1, 1],
    ['2026-11-06T17:00', 1, 1],
    ['2026-11-06T17:01', 1, 1],
  ];
  const shapes: Array<[string, RoundStep[], Array<[string, number, number]>]> =
    [
      ['default 1,1,2,2,2', shape([1, 1, 2, 2, 2]), defaultRows],
      ['admin 1,1,1,2,2', shape([1, 1, 1, 2, 2]), adminRows],
      ['one step', shape([1]), oneStepRows],
    ];

  describe.each(shapes)('timeline %s', (_name, steps, rows) => {
    it.each(rows)('now %s -> step %i, round %i', (now, position, round) => {
      expect(stepInForce(steps, m(now)).position).toBe(position);
      expect(entryRound(steps, m(now))).toBe(round);
    });
  });

  it('reads every shape at the same boundary minutes', () => {
    const minutes = (rows: Array<[string, number, number]>) =>
      rows.map(([now]) => now);
    expect(minutes(adminRows)).toEqual(minutes(defaultRows));
    expect(minutes(oneStepRows)).toEqual(minutes(defaultRows).slice(0, 4));
  });

  it('returns the very step object of the timeline', () => {
    const steps = shape([1, 1, 2, 2, 2]);
    expect(stepInForce(steps, m('2026-11-16T09:00'))).toBe(steps[2]);
  });

  it('throws on a stored round of 3 in the step in force', () => {
    const steps = shape([1, 1, 2, 2, 3]);
    expect(() => entryRound(steps, m('2026-11-30T09:00'))).toThrow();
    expect(entryRound(steps, m('2026-11-27T17:00'))).toBe(2);
  });

  it('throws on a stored round of 0', () => {
    expect(() => entryRound(shape([0]), m('2026-11-02T09:00'))).toThrow();
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

describe('isResubmitted (FR-4, DD-8)', () => {
  const returnedAt = new Date('2026-11-05T10:00:00Z');
  it.each([
    ['equal second', '2026-11-05T10:00:00Z', false],
    ['one second later', '2026-11-05T10:00:01Z', true],
    ['one second earlier', '2026-11-05T09:59:59Z', false],
    ['null', null, false],
    ['sub-second later in the same second', '2026-11-05T10:00:00.900Z', false],
    ['next second at .000', '2026-11-05T10:00:01.000Z', true],
    ['same instant, other offset', '2026-11-05T11:00:00+01:00', false],
    ['one second later, other offset', '2026-11-05T11:00:01+01:00', true],
    ['not a date', 'not-a-date', false],
  ])('submitted_at %s -> %s', (_name, submittedAt, expected) => {
    expect(isResubmitted(submittedAt, returnedAt)).toBe(expected);
  });

  it('floors ended_at too: .999 of the previous second is not later than the next .000', () => {
    expect(
      isResubmitted(
        '2026-11-05T10:00:01.000Z',
        new Date('2026-11-05T10:00:00.999Z'),
      ),
    ).toBe(true);
    expect(
      isResubmitted(
        '2026-11-05T10:00:00.100Z',
        new Date('2026-11-05T10:00:00.999Z'),
      ),
    ).toBe(false);
  });
});

describe('skipVerdict v2 (FR-4, DD-3, DD-6, DD-11)', () => {
  const now = m('2026-11-10T09:00');
  const T = 1;
  const U = 2;
  const open = m('2026-11-20T17:30');
  const closed = m('2026-11-09T17:30');
  const returnedAt = new Date('2026-11-05T10:00:00Z');
  const later = '2026-11-05T10:00:01Z';
  const same = '2026-11-05T10:00:00Z';
  const earlier = '2026-11-05T09:59:59Z';

  const row = (
    id: number,
    timelineId: number,
    entryRound: number,
    lastStepClosesAt: RomeMinute,
    endReason: TimelineResultEndReason | null,
  ): CycleMembership => ({
    id,
    timelineId,
    entryRound,
    endedAt: endReason === null ? null : returnedAt,
    endReason,
    lastStepClosesAt,
  });
  const active = (id: number, t: number, round: number, c: RomeMinute) =>
    row(id, t, round, c, null);
  const returned = (id: number, t: number, round: number, c: RomeMinute) =>
    row(id, t, round, c, 'returned');
  const qaed = (id: number, t: number, round: number, c: RomeMinute) =>
    row(id, t, round, c, 'released_qaed');
  const notQaed = (id: number, t: number, round: number, c: RomeMinute) =>
    row(id, t, round, c, 'released_not_qaed');
  const timelineClosed = (
    id: number,
    t: number,
    round: number,
    c: RomeMinute,
  ) => row(id, t, round, c, 'timeline_closed');

  const aOpen = returned(4, U, 1, open);
  const aClosed = returned(4, U, 1, closed);
  const hereReturned = returned(7, T, 1, open);

  type Verdict = ReturnType<typeof skipVerdict>;
  const rows: Array<
    [string, 1 | 2, string | null, CycleMembership[], boolean, Verdict]
  > = [
    // Round 1
    ['r1 no memberships', 1, null, [], false, { kind: 'new', previous: null }],
    [
      'r1 parallel scope, no membership of this code anywhere',
      1,
      later,
      [],
      false,
      { kind: 'new', previous: null },
    ],
    [
      'r1 active in U, U still open',
      1,
      null,
      [active(3, U, 1, open)],
      false,
      { reason: 'ACTIVE_IN_OTHER_TIMELINE', timelineId: 2 },
    ],
    [
      'r1 active in U closing this minute',
      1,
      null,
      [active(3, U, 1, now)],
      false,
      { reason: 'ACTIVE_IN_OTHER_TIMELINE', timelineId: 2 },
    ],
    [
      'r1 active in U, U closed yesterday',
      1,
      null,
      [active(3, U, 1, closed)],
      false,
      { kind: 'new', previous: active(3, U, 1, closed) },
    ],
    [
      'r1 S-6 returned in U, U open, not resubmitted',
      1,
      same,
      [aOpen],
      false,
      { reason: 'ACTIVE_IN_OTHER_TIMELINE', timelineId: 2 },
    ],
    [
      'r1 S-6 returned in U, U open, resubmitted',
      1,
      later,
      [aOpen],
      false,
      { reason: 'ACTIVE_IN_OTHER_TIMELINE', timelineId: 2 },
    ],
    [
      'r1 S-6 returned in U, U closed, resubmitted: B takes it as new',
      1,
      later,
      [aClosed],
      false,
      { kind: 'new', previous: aClosed },
    ],
    [
      'r1 returned in U closing this minute still blocks',
      1,
      later,
      [returned(4, U, 1, now)],
      false,
      { reason: 'ACTIVE_IN_OTHER_TIMELINE', timelineId: 2 },
    ],
    [
      'r1 released_qaed in U, U open: does not block',
      1,
      null,
      [qaed(3, U, 1, open)],
      false,
      { kind: 'new', previous: qaed(3, U, 1, open) },
    ],
    [
      'r1 timeline_closed in U, U open: does not block',
      1,
      null,
      [timelineClosed(3, U, 1, open)],
      false,
      { kind: 'new', previous: timelineClosed(3, U, 1, open) },
    ],
    [
      'r1 active in T',
      1,
      null,
      [active(3, T, 1, open)],
      false,
      { reason: 'ALREADY_IN_THIS_TIMELINE' },
    ],
    [
      'r1 returned in T during step 2, resubmitted: skipped here',
      1,
      later,
      [hereReturned],
      false,
      { reason: 'ALREADY_IN_THIS_TIMELINE' },
    ],
    [
      'r1 ended timeline_closed in T',
      1,
      null,
      [timelineClosed(3, T, 1, closed)],
      false,
      { reason: 'ALREADY_IN_THIS_TIMELINE' },
    ],
    [
      'r1 duplicate only',
      1,
      null,
      [],
      true,
      { reason: 'DUPLICATE_RESULT_CODE' },
    ],
    [
      'r1 duplicate and active in U',
      1,
      null,
      [active(3, U, 1, open)],
      true,
      { reason: 'ACTIVE_IN_OTHER_TIMELINE', timelineId: 2 },
    ],
    [
      'r1 duplicate and in T',
      1,
      null,
      [timelineClosed(3, T, 1, closed)],
      true,
      { reason: 'ALREADY_IN_THIS_TIMELINE' },
    ],
    [
      'r1 duplicate and U closed',
      1,
      null,
      [active(3, U, 1, closed)],
      true,
      { reason: 'DUPLICATE_RESULT_CODE' },
    ],
    [
      'r1 other timeline open wins over this timeline',
      1,
      null,
      [active(3, U, 1, open), timelineClosed(5, T, 1, closed)],
      false,
      { reason: 'ACTIVE_IN_OTHER_TIMELINE', timelineId: 2 },
    ],
    // Round 2
    [
      'r2 new result, held nowhere',
      2,
      later,
      [],
      false,
      { kind: 'new', previous: null },
    ],
    [
      'r2 returned here, submitted one second later: re-submitted',
      2,
      later,
      [hereReturned],
      false,
      { kind: 'resubmitted', previous: hereReturned },
    ],
    [
      'r2 returned here, same second',
      2,
      same,
      [hereReturned],
      false,
      { reason: 'RETURNED_NOT_RESUBMITTED' },
    ],
    [
      'r2 returned here, earlier',
      2,
      earlier,
      [hereReturned],
      false,
      { reason: 'RETURNED_NOT_RESUBMITTED' },
    ],
    [
      'r2 returned here, submitted_at null',
      2,
      null,
      [hereReturned],
      false,
      { reason: 'RETURNED_NOT_RESUBMITTED' },
    ],
    [
      'r2 returned here, not resubmitted, listed twice',
      2,
      same,
      [hereReturned],
      true,
      { reason: 'RETURNED_NOT_RESUBMITTED' },
    ],
    [
      'r2 returned here, resubmitted, listed twice',
      2,
      later,
      [hereReturned],
      true,
      { reason: 'DUPLICATE_RESULT_CODE' },
    ],
    [
      'r2 round-1 released_qaed here',
      2,
      later,
      [qaed(7, T, 1, open)],
      false,
      { reason: 'ALREADY_IN_THIS_TIMELINE' },
    ],
    [
      'r2 round-1 released_not_qaed here',
      2,
      later,
      [notQaed(7, T, 1, open)],
      false,
      { reason: 'ALREADY_IN_THIS_TIMELINE' },
    ],
    [
      'r2 round-1 timeline_closed here',
      2,
      later,
      [timelineClosed(7, T, 1, closed)],
      false,
      { reason: 'ALREADY_IN_THIS_TIMELINE' },
    ],
    [
      'r2 round-1 still active here',
      2,
      later,
      [active(7, T, 1, open)],
      false,
      { reason: 'ALREADY_IN_THIS_TIMELINE' },
    ],
    [
      'r2 round-2 membership already here (active)',
      2,
      later,
      [hereReturned, active(8, T, 2, open)],
      false,
      { reason: 'ALREADY_IN_THIS_TIMELINE' },
    ],
    [
      'r2 round-2 membership already here (ended)',
      2,
      later,
      [hereReturned, timelineClosed(8, T, 2, closed)],
      false,
      { reason: 'ALREADY_IN_THIS_TIMELINE' },
    ],
    [
      'r2 returned here and held by U open: U wins',
      2,
      later,
      [hereReturned, active(9, U, 1, open)],
      false,
      { reason: 'ACTIVE_IN_OTHER_TIMELINE', timelineId: 2 },
    ],
    [
      'r2 new here, U closed: new, compared with the U row',
      2,
      later,
      [qaed(3, U, 1, closed)],
      false,
      { kind: 'new', previous: qaed(3, U, 1, closed) },
    ],
    [
      'previous is the highest id, whatever the order given',
      2,
      later,
      [timelineClosed(9, U, 1, closed), qaed(5, U, 1, closed)],
      false,
      { kind: 'new', previous: timelineClosed(9, U, 1, closed) },
    ],
  ];

  it.each(rows)(
    '%s',
    (_name, round, submittedAt, memberships, duplicated, expected) => {
      expect(
        skipVerdict({
          round,
          timelineId: T,
          now,
          submittedAt,
          memberships,
          duplicated,
        }),
      ).toEqual(expected);
    },
  );
});

describe('canonicalJson (FR-8)', () => {
  it('sorts keys at every depth and keeps array order', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(
      '{"a":[2,{"c":2,"d":1}],"b":1}',
    );
  });
  it('writes scalars and null as JSON', () => {
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson('x')).toBe('"x"');
    expect(canonicalJson([true, 3])).toBe('[true,3]');
  });
  it('is the same for equal values in another key order', () => {
    expect(canonicalJson({ x: { p: 1, q: 2 }, y: 1 })).toBe(
      canonicalJson({ y: 1, x: { q: 2, p: 1 } }),
    );
  });
});

describe('changedFields (FR-8)', () => {
  it.each([
    [
      'reordered keys at every depth',
      { a: 1, b: { x: 1, y: 2 } },
      { b: { y: 2, x: 1 }, a: 1 },
      [],
    ],
    [
      'one changed value',
      { title: 'A', description: 'd' },
      { title: 'B', description: 'd' },
      ['title'],
    ],
    [
      'a key only in the current values',
      { title: 'A' },
      { title: 'A', extra: 'x' },
      ['extra'],
    ],
    [
      'a key only in the previous values',
      { title: 'A', gone: 'x' },
      { title: 'A' },
      ['gone'],
    ],
    ['a null value against a missing key', { a: null }, {}, ['a']],
    [
      'a nested change is reported under its top-level key',
      { meta: { a: 1, b: { c: 2 } }, t: 1 },
      { meta: { a: 1, b: { c: 3 } }, t: 1 },
      ['meta'],
    ],
    ['array order counts', { list: [1, 2] }, { list: [2, 1] }, ['list']],
    [
      'the result is sorted',
      { z: 1, a: 1, m: 1 },
      { z: 2, a: 2, m: 1 },
      ['a', 'z'],
    ],
    ['both empty', {}, {}, []],
  ])('%s', (_name, previous, current, expected) => {
    expect(changedFields(previous, current)).toEqual(expected);
  });
});

describe('mergeSummary (design 5.3, 7.4)', () => {
  const a: LoadSummary = {
    ...EMPTY_SUMMARY,
    loaded: 2,
    loadedNew: 2,
    byProgram: { SP01: 2 },
    byType: { policy_change: 2 },
    skipped: { ALREADY_IN_THIS_TIMELINE: 1 },
    otherTimelines: { '7': { name: 'U', count: 1 } },
  };
  const b: LoadSummary = {
    ...EMPTY_SUMMARY,
    loaded: 3,
    loadedNew: 1,
    loadedResubmitted: 2,
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
    ...EMPTY_SUMMARY,
    loaded: 1,
    loadedResubmitted: 1,
    byProgram: { SP02: 1 },
    byType: { knowledge_product: 1 },
    kpGroups: { review: 1 },
    skipped: { RETURNED_NOT_RESUBMITTED: 2 },
    otherTimelines: { '9': { name: 'V', count: 4 } },
  };
  const expectedAll: LoadSummary = {
    loaded: 6,
    loadedNew: 3,
    loadedResubmitted: 3,
    round: 1,
    byProgram: { SP01: 3, SP02: 3 },
    byType: { policy_change: 2, knowledge_product: 4 },
    kpGroups: { review: 3, auto_checked: 1 },
    skipped: {
      ALREADY_IN_THIS_TIMELINE: 1,
      DUPLICATE_RESULT_CODE: 1,
      RETURNED_NOT_RESUBMITTED: 2,
    },
    otherTimelines: {
      '7': { name: 'U', count: 3 },
      '9': { name: 'V', count: 5 },
    },
    returnedNotResubmitted: { total: 0, byProgram: {}, byType: {} },
  };

  it('has the documented empty shape', () => {
    expect(EMPTY_SUMMARY).toEqual({
      loaded: 0,
      loadedNew: 0,
      loadedResubmitted: 0,
      round: 1,
      byProgram: {},
      byType: {},
      kpGroups: {},
      skipped: {},
      otherTimelines: {},
      returnedNotResubmitted: { total: 0, byProgram: {}, byType: {} },
    });
  });

  it('sums two lots key by key', () => {
    expect(mergeSummary(a, b)).toEqual({
      loaded: 5,
      loadedNew: 3,
      loadedResubmitted: 2,
      round: 1,
      byProgram: { SP01: 3, SP02: 2 },
      byType: { policy_change: 2, knowledge_product: 3 },
      kpGroups: { review: 2, auto_checked: 1 },
      skipped: { ALREADY_IN_THIS_TIMELINE: 1, DUPLICATE_RESULT_CODE: 1 },
      otherTimelines: {
        '7': { name: 'U', count: 3 },
        '9': { name: 'V', count: 1 },
      },
      returnedNotResubmitted: { total: 0, byProgram: {}, byType: {} },
    });
  });

  it('is associative on three lots', () => {
    expect(mergeSummary(mergeSummary(a, b), c)).toEqual(expectedAll);
    expect(mergeSummary(a, mergeSummary(b, c))).toEqual(expectedAll);
  });

  it('keeps loaded = loadedNew + loadedResubmitted after a merge', () => {
    const merged = mergeSummary(mergeSummary(a, b), c);
    expect(merged.loaded).toBe(merged.loadedNew + merged.loadedResubmitted);
  });

  it('does not sum returnedNotResubmitted: the left value is kept', () => {
    const left: LoadSummary = {
      ...a,
      returnedNotResubmitted: {
        total: 2,
        byProgram: { SP01: 2 },
        byType: { policy_change: 2 },
      },
    };
    const right: LoadSummary = {
      ...b,
      returnedNotResubmitted: {
        total: 5,
        byProgram: { SP09: 5 },
        byType: { other: 5 },
      },
    };
    expect(mergeSummary(left, right).returnedNotResubmitted).toEqual({
      total: 2,
      byProgram: { SP01: 2 },
      byType: { policy_change: 2 },
    });
  });

  it('throws on a round mismatch and keeps the round otherwise', () => {
    expect(() =>
      mergeSummary({ ...a, round: 1 }, { ...b, round: 2 }),
    ).toThrow();
    expect(mergeSummary({ ...a, round: 2 }, { ...b, round: 2 }).round).toBe(2);
  });

  it('does not change its inputs', () => {
    const left = structuredClone(a);
    const right = structuredClone(b);
    mergeSummary(left, right);
    expect(left).toEqual(a);
    expect(right).toEqual(b);
  });

  describe('property: any grouping and order gives the same result', () => {
    // A seeded generator (mulberry32): the repo has no property-test library.
    const seeded = (seed: number) => () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const PROGRAMS = ['SP01', 'SP02', 'SP03'];
    const TYPES = ['policy_change', 'knowledge_product', 'innovation_dev'];
    const REASONS = [
      'ALREADY_IN_THIS_TIMELINE',
      'RETURNED_NOT_RESUBMITTED',
      'DUPLICATE_RESULT_CODE',
    ];
    const TIMELINES: Record<string, string> = { '7': 'U', '9': 'V', '11': 'W' };

    const lot = (rand: () => number, round: 1 | 2): LoadSummary => {
      const int = (max: number) => Math.floor(rand() * (max + 1));
      const counts = (keys: string[]) =>
        Object.fromEntries(
          keys.filter(() => rand() < 0.6).map((key) => [key, 1 + int(4)]),
        );
      const loadedNew = int(5);
      const loadedResubmitted = int(5);
      return {
        loaded: loadedNew + loadedResubmitted,
        loadedNew,
        loadedResubmitted,
        round,
        byProgram: counts(PROGRAMS),
        byType: counts(TYPES),
        kpGroups: counts(['review', 'auto_checked']),
        skipped: counts(REASONS),
        otherTimelines: Object.fromEntries(
          Object.entries(TIMELINES)
            .filter(() => rand() < 0.5)
            .map(([id, name]) => [id, { name, count: 1 + int(3) }]),
        ),
        returnedNotResubmitted: { total: 0, byProgram: {}, byType: {} },
      };
    };

    // The expected value is built with plain loops over the lots, not by merging.
    const reference = (lots: LoadSummary[]): LoadSummary => {
      const sums = (pick: (l: LoadSummary) => Record<string, number>) => {
        const out: Record<string, number> = {};
        for (const l of lots)
          for (const [k, v] of Object.entries(pick(l)))
            out[k] = (out[k] ?? 0) + v;
        return out;
      };
      const others: LoadSummary['otherTimelines'] = {};
      for (const l of lots)
        for (const [id, e] of Object.entries(l.otherTimelines)) {
          others[id] = {
            name: e.name,
            count: (others[id]?.count ?? 0) + e.count,
          };
        }
      return {
        loaded: lots.reduce((s, l) => s + l.loaded, 0),
        loadedNew: lots.reduce((s, l) => s + l.loadedNew, 0),
        loadedResubmitted: lots.reduce((s, l) => s + l.loadedResubmitted, 0),
        round: lots[0]!.round,
        byProgram: sums((l) => l.byProgram),
        byType: sums((l) => l.byType),
        kpGroups: sums((l) => l.kpGroups),
        skipped: sums((l) => l.skipped),
        otherTimelines: others,
        returnedNotResubmitted: { total: 0, byProgram: {}, byType: {} },
      };
    };

    const shuffle = <T>(rand: () => number, items: T[]): T[] => {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [out[i], out[j]] = [out[j]!, out[i]!];
      }
      return out;
    };
    // A random binary tree over the items in the given order.
    const fold = (rand: () => number, items: LoadSummary[]): LoadSummary => {
      if (items.length === 1) return items[0]!;
      const cut = 1 + Math.floor(rand() * (items.length - 1));
      return mergeSummary(
        fold(rand, items.slice(0, cut)),
        fold(rand, items.slice(cut)),
      );
    };

    it('300 random sets of lots, each in a random order and grouping', () => {
      const rand = seeded(20261106);
      for (let run = 0; run < 300; run++) {
        const round = rand() < 0.5 ? 1 : 2;
        const lots = Array.from({ length: 2 + Math.floor(rand() * 7) }, () =>
          lot(rand, round),
        );
        const expected = reference(lots);
        for (let tries = 0; tries < 3; tries++) {
          const merged = fold(rand, shuffle(rand, lots));
          expect(merged).toEqual(expected);
          expect(merged.loaded).toBe(
            merged.loadedNew + merged.loadedResubmitted,
          );
        }
      }
    });

    it('every order and every bracketing of four lots', () => {
      const rand = seeded(7);
      const lots = Array.from({ length: 4 }, () => lot(rand, 2));
      const expected = reference(lots);
      const permutations = <T>(items: T[]): T[][] =>
        items.length <= 1
          ? [items]
          : items.flatMap((item, i) =>
              permutations([...items.slice(0, i), ...items.slice(i + 1)]).map(
                (rest) => [item, ...rest],
              ),
            );
      const bracketings = ([w, x, y, z]: LoadSummary[]): LoadSummary[] => [
        mergeSummary(mergeSummary(mergeSummary(w!, x!), y!), z!),
        mergeSummary(mergeSummary(w!, mergeSummary(x!, y!)), z!),
        mergeSummary(mergeSummary(w!, x!), mergeSummary(y!, z!)),
        mergeSummary(w!, mergeSummary(mergeSummary(x!, y!), z!)),
        mergeSummary(w!, mergeSummary(x!, mergeSummary(y!, z!))),
      ];
      const orders = permutations(lots);
      expect(orders).toHaveLength(24);
      for (const order of orders)
        for (const merged of bracketings(order))
          expect(merged).toEqual(expected);
    });
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

describe('snapshotKeyOf (DD-7, KZ-ingestion--timeline-sync-1)', () => {
  // The key is built by the real writer's `snapshotSortSuffix`, the way
  // `LoadRunner` stores it in `timeline_results.snapshot_sk`; no literal is typed.
  const parts = { phaseYear: 2026, cycleId: 1, timelineId: 11, loadId: 7 };

  it('strips SNAP# and returns exactly the suffix the snapshot store is keyed by', () => {
    const suffix = snapshotSortSuffix(parts);
    expect(snapshotKeyOf(`${SNAPSHOT_SK_PREFIX}${suffix}`)).toBe(suffix);
    expect(snapshotKeyOf(`SNAP#${suffix}`)).toBe(suffix);
  });

  it('leaves a key that is already a suffix as it is', () => {
    const suffix = snapshotSortSuffix(parts);
    expect(snapshotKeyOf(suffix)).toBe(suffix);
  });

  it('strips only the leading prefix', () => {
    expect(snapshotKeyOf('SNAP#SNAP#1')).toBe('SNAP#1');
  });
});

describe('titleOf (FR-24, design 7.8)', () => {
  const emoji = '\u{1F600}';

  it('returns the string general.title as it is up to 1,000 characters', () => {
    expect(titleOf({ 'general.title': 'A title' })).toBe('A title');
    expect(titleOf({ 'general.title': 'a'.repeat(1000) })).toBe(
      'a'.repeat(1000),
    );
    expect(titleOf({ 'general.title': '' })).toBe('');
  });

  it('cuts a longer title at 1,000 code points', () => {
    const cut = titleOf({ 'general.title': 'a'.repeat(1001) });

    expect(cut).toBe('a'.repeat(1000));
  });

  it('never splits an emoji at the cut: a pair of UTF-16 units counts as one character', () => {
    // 999 letters + one emoji + one more letter: the 1,000th character is the whole emoji.
    const atBoundary = titleOf({
      'general.title': `${'a'.repeat(999)}${emoji}b`,
    });
    // 1,001 emoji: exactly 1,000 whole emoji remain, never a lone half.
    const allEmoji = titleOf({ 'general.title': emoji.repeat(1001) });

    expect(atBoundary).toBe(`${'a'.repeat(999)}${emoji}`);
    expect(allEmoji).toBe(emoji.repeat(1000));
    expect(Array.from(allEmoji ?? '')).toHaveLength(1000);
    // 1,000 emoji are 2,000 UTF-16 units but only 1,000 characters: kept whole.
    expect(titleOf({ 'general.title': emoji.repeat(1000) })).toBe(
      emoji.repeat(1000),
    );
  });

  it.each([
    ['a number', 42],
    ['an object', { text: 'x' }],
    ['an array', ['x']],
    ['null', null],
    ['a boolean', true],
    ['undefined', undefined],
  ])('is null when general.title is %s', (_label, value) => {
    expect(titleOf({ 'general.title': value })).toBeNull();
  });

  it('is null when general.title is absent', () => {
    expect(titleOf({})).toBeNull();
    expect(titleOf({ 'general.description': 'x' })).toBeNull();
  });
});
