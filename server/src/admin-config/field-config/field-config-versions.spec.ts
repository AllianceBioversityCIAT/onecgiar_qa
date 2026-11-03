import { describe, expect, it } from 'vitest';
import { dayEnd, dayStart, type RomeMinute } from '../rome-date.js';
import {
  receiveAndKeep,
  versionFor,
  type PublishedVersion,
  type TimelineStart,
} from './field-config-versions.js';

// Expected values are literals from the FR-9 and FR-7 scenarios (S-3, S-4,
// S-5, S-13, DD-5, DD-8). A version counts for a timeline when the Rome
// minute of its publish instant is before step 1's `opensAt`; the timeline has
// started once the Rome minute reaches `opensAt`. Fixtures below that name a
// day mean the whole day: it opens at 00:00 and closes at 23:59 (S-6). Rome is UTC+1 in
// winter (CET) and UTC+2 in summer (CEST); the 2026 changes are 29 Mar
// (02:00 CET -> 03:00 CEST at 01:00Z) and 25 Oct (03:00 CEST -> 02:00 CET at
// 01:00Z). Every boundary row is an instant that crosses midnight in Rome, so
// the UTC date of the same instant differs from its Rome date on purpose.

const version = (number: number, iso: string): PublishedVersion => ({
  number,
  publishedAt: new Date(iso),
});

/** A timeline whose step 1 opens at 00:00 of `opensOn` and whose last step closes at 23:59 (S-6). */
const timeline = (
  id: number,
  opensOn: string | null,
  overrides: Partial<TimelineStart> = {},
): TimelineStart => ({
  id,
  opensAt: opensOn === null ? null : dayStart(opensOn),
  closesAt: opensOn === null ? null : dayEnd('2026-12-31'),
  allResultTypes: true,
  resultTypeKeys: [],
  ...overrides,
});

/** A far-later "now": every boundary row below is judged as started. */
const LATER = new Date('2026-12-01T12:00:00Z');

describe('versionFor: scenarios (FR-9)', () => {
  it('published before any timeline starts: both resolve to version 1, provisionally', () => {
    const versions = [version(1, '2026-10-30T12:00:00Z')];
    const now = new Date('2026-10-31T12:00:00Z');
    expect(
      versionFor({ opensAt: dayStart('2026-11-01') }, versions, now),
    ).toEqual({
      number: 1,
      provisional: true,
    });
    expect(
      versionFor({ opensAt: dayStart('2026-11-10') }, versions, now),
    ).toEqual({
      number: 1,
      provisional: true,
    });
  });

  it('published while A runs: A keeps version 1 (S-13), B moves to version 2', () => {
    const versions = [
      version(1, '2026-10-30T12:00:00Z'),
      version(2, '2026-11-05T12:00:00Z'),
    ];
    const now = new Date('2026-11-06T12:00:00Z');
    expect(
      versionFor({ opensAt: dayStart('2026-11-01') }, versions, now),
    ).toEqual({
      number: 1,
      provisional: false,
    });
    expect(
      versionFor({ opensAt: dayStart('2026-11-10') }, versions, now),
    ).toEqual({
      number: 2,
      provisional: true,
    });
  });

  it('A keeps version 1 until it finishes, whatever is published later (S-13)', () => {
    const versions = [
      version(1, '2026-10-30T12:00:00Z'),
      version(2, '2026-11-05T12:00:00Z'),
    ];
    expect(
      versionFor(
        { opensAt: dayStart('2026-11-01') },
        versions,
        new Date('2027-03-01T00:00:00Z'),
      ),
    ).toEqual({ number: 1, provisional: false });
  });

  it('published on the opening day at 09:00 Rome: B resolves to the version before it (S-5)', () => {
    const versions = [
      version(1, '2026-10-30T12:00:00Z'),
      version(2, '2026-11-05T12:00:00Z'),
      version(3, '2026-11-10T08:00:00Z'),
    ];
    const now = new Date('2026-11-10T12:00:00Z');
    expect(
      versionFor({ opensAt: dayStart('2026-11-10') }, versions, now),
    ).toEqual({
      number: 2,
      provisional: false,
    });
  });

  it('not started: the latest version, provisional (S-4), even if published after other starts', () => {
    const versions = [
      version(1, '2026-10-30T12:00:00Z'),
      version(2, '2026-11-05T12:00:00Z'),
    ];
    expect(
      versionFor(
        { opensAt: dayStart('2026-11-20') },
        versions,
        new Date('2026-11-06T12:00:00Z'),
      ),
    ).toEqual({ number: 2, provisional: true });
  });

  it('not started with no version published: none', () => {
    expect(
      versionFor(
        { opensAt: dayStart('2026-11-20') },
        [],
        new Date('2026-11-06T12:00:00Z'),
      ),
    ).toBe('none');
  });

  it('started with no version before its start: none, never a later version', () => {
    const versions = [version(1, '2026-11-02T12:00:00Z')];
    expect(
      versionFor(
        { opensAt: dayStart('2026-11-01') },
        versions,
        new Date('2026-11-03T12:00:00Z'),
      ),
    ).toBe('none');
  });

  it('started with no version at all: none', () => {
    expect(
      versionFor(
        { opensAt: dayStart('2026-11-01') },
        [],
        new Date('2026-11-03T12:00:00Z'),
      ),
    ).toBe('none');
  });

  it('on hold (step 1 date passed, waiting for a load) counts as started (S-3)', () => {
    // The hold only depends on a load, which this module never sees: the start
    // reads step 1's `opensAt` alone.
    const versions = [
      version(1, '2026-10-30T12:00:00Z'),
      version(2, '2026-11-05T12:00:00Z'),
    ];
    expect(
      versionFor(
        { opensAt: dayStart('2026-11-01') },
        versions,
        new Date('2026-11-20T12:00:00Z'),
      ),
    ).toEqual({ number: 1, provisional: false });
  });

  it('a timeline with no steps has not started: the latest version, provisional', () => {
    const versions = [
      version(1, '2026-10-30T12:00:00Z'),
      version(2, '2026-11-05T12:00:00Z'),
    ];
    expect(versionFor({ opensAt: null }, versions, LATER)).toEqual({
      number: 2,
      provisional: true,
    });
  });

  it('versions given in any order resolve by version number', () => {
    const versions = [
      version(2, '2026-10-31T12:00:00Z'),
      version(1, '2026-10-30T12:00:00Z'),
    ];
    expect(
      versionFor({ opensAt: dayStart('2026-11-10') }, versions, LATER),
    ).toEqual({
      number: 2,
      provisional: false,
    });
  });
});

describe('versionFor: which versions count, at midnight Rome (DD-5)', () => {
  // Versions 1 (30 Oct) and 2 (the instant under test). `counted` is the
  // version the timeline resolves to: 2 when the instant's Rome day is before
  // `opensAt`, else 1.
  it.each([
    // Winter: opening day 10 Nov, midnight Rome = 23:00Z on 9 Nov.
    [
      '23:59:59 Rome the day before (winter)',
      '2026-11-10',
      '2026-11-09T22:59:59Z',
      2,
    ],
    [
      '00:00:00 Rome on the opening day (winter)',
      '2026-11-10',
      '2026-11-09T23:00:00Z',
      1,
    ],
    [
      '00:30 Rome on the opening day, 23:30Z the day before (winter)',
      '2026-11-10',
      '2026-11-09T23:30:00Z',
      1,
    ],
    [
      '09:00 Rome on the opening day (winter)',
      '2026-11-10',
      '2026-11-10T08:00:00Z',
      1,
    ],
    [
      '23:59 Rome on the opening day (winter)',
      '2026-11-10',
      '2026-11-10T22:59:00Z',
      1,
    ],
    [
      '00:00 Rome the day after the opening day (winter)',
      '2026-11-10',
      '2026-11-10T23:00:00Z',
      1,
    ],
    // Summer: opening day 1 Jul, midnight Rome = 22:00Z on 30 Jun.
    [
      '23:59:59 Rome the day before (summer)',
      '2026-07-01',
      '2026-06-30T21:59:59Z',
      2,
    ],
    [
      '00:00:00 Rome on the opening day (summer)',
      '2026-07-01',
      '2026-06-30T22:00:00Z',
      1,
    ],
    [
      '00:30 Rome on the opening day, 22:30Z the day before (summer)',
      '2026-07-01',
      '2026-06-30T22:30:00Z',
      1,
    ],
    // Spring change, 29 Mar 2026. Midnight Rome opening 29 Mar = 23:00Z 28 Mar
    // (CET); midnight Rome opening 30 Mar = 22:00Z 29 Mar (CEST).
    [
      'spring: 23:59:59 Rome on 28 Mar, opens 29 Mar',
      '2026-03-29',
      '2026-03-28T22:59:59Z',
      2,
    ],
    [
      'spring: 00:00 Rome on 29 Mar, opens 29 Mar',
      '2026-03-29',
      '2026-03-28T23:00:00Z',
      1,
    ],
    [
      'spring: 23:59:59 Rome on 29 Mar (23-hour day), opens 30 Mar',
      '2026-03-30',
      '2026-03-29T21:59:59Z',
      2,
    ],
    [
      'spring: 00:00 Rome on 30 Mar, opens 30 Mar',
      '2026-03-30',
      '2026-03-29T22:00:00Z',
      1,
    ],
    [
      'spring: 22:30Z on 29 Mar is 00:30 Rome on 30 Mar, opens 30 Mar',
      '2026-03-30',
      '2026-03-29T22:30:00Z',
      1,
    ],
    // Autumn change, 25 Oct 2026. Midnight Rome opening 25 Oct = 22:00Z 24 Oct
    // (CEST); midnight Rome opening 26 Oct = 23:00Z 25 Oct (CET).
    [
      'autumn: 23:59:59 Rome on 24 Oct, opens 25 Oct',
      '2026-10-25',
      '2026-10-24T21:59:59Z',
      2,
    ],
    [
      'autumn: 00:00 Rome on 25 Oct, opens 25 Oct',
      '2026-10-25',
      '2026-10-24T22:00:00Z',
      1,
    ],
    [
      'autumn: 02:30 Rome (CEST, first pass) on 25 Oct, opens 26 Oct',
      '2026-10-26',
      '2026-10-25T00:30:00Z',
      2,
    ],
    [
      'autumn: 02:30 Rome (CET, second pass) on 25 Oct, opens 26 Oct',
      '2026-10-26',
      '2026-10-25T01:30:00Z',
      2,
    ],
    [
      'autumn: 23:59:59 Rome on 25 Oct (25-hour day), opens 26 Oct',
      '2026-10-26',
      '2026-10-25T22:59:59Z',
      2,
    ],
    [
      'autumn: 00:00 Rome on 26 Oct, opens 26 Oct',
      '2026-10-26',
      '2026-10-25T23:00:00Z',
      1,
    ],
    [
      'autumn: 00:30 Rome on 26 Oct, 23:30Z on 25 Oct, opens 26 Oct',
      '2026-10-26',
      '2026-10-25T23:30:00Z',
      1,
    ],
  ])('%s', (_label, opensOn, publishedAt, counted) => {
    const versions = [
      version(1, '2026-02-01T12:00:00Z'),
      version(2, publishedAt),
    ];
    expect(versionFor({ opensAt: dayStart(opensOn) }, versions, LATER)).toEqual(
      {
        number: counted,
        provisional: false,
      },
    );
  });
});

describe('versionFor: when a timeline starts, at midnight Rome (S-3)', () => {
  // Versions: 1 published long before. `started` is whether `now` has reached
  // 00:00 Rome on `opensAt`; a started timeline is never provisional.
  it.each([
    [
      '23:59:59 Rome the day before (winter)',
      '2026-11-10',
      '2026-11-09T22:59:59Z',
      false,
    ],
    [
      '00:00:00 Rome on the opening day (winter)',
      '2026-11-10',
      '2026-11-09T23:00:00Z',
      true,
    ],
    [
      '00:30 Rome on the opening day, 23:30Z the day before (winter)',
      '2026-11-10',
      '2026-11-09T23:30:00Z',
      true,
    ],
    [
      '23:59:59 Rome the day before (summer)',
      '2026-07-01',
      '2026-06-30T21:59:59Z',
      false,
    ],
    [
      '00:00:00 Rome on the opening day (summer)',
      '2026-07-01',
      '2026-06-30T22:00:00Z',
      true,
    ],
    [
      'spring: 23:59:59 Rome on 29 Mar, opens 30 Mar',
      '2026-03-30',
      '2026-03-29T21:59:59Z',
      false,
    ],
    [
      'spring: 00:00 Rome on 30 Mar, opens 30 Mar',
      '2026-03-30',
      '2026-03-29T22:00:00Z',
      true,
    ],
    [
      'spring: 23:00Z on 28 Mar is 00:00 Rome on 29 Mar, opens 29 Mar',
      '2026-03-29',
      '2026-03-28T23:00:00Z',
      true,
    ],
    [
      'spring: 22:59:59Z on 28 Mar is 23:59:59 Rome on 28 Mar, opens 29 Mar',
      '2026-03-29',
      '2026-03-28T22:59:59Z',
      false,
    ],
    [
      'autumn: 23:59:59 Rome on 25 Oct, opens 26 Oct',
      '2026-10-26',
      '2026-10-25T22:59:59Z',
      false,
    ],
    [
      'autumn: 00:00 Rome on 26 Oct, opens 26 Oct',
      '2026-10-26',
      '2026-10-25T23:00:00Z',
      true,
    ],
    [
      'autumn: 21:59:59Z on 24 Oct is 23:59:59 Rome on 24 Oct, opens 25 Oct',
      '2026-10-25',
      '2026-10-24T21:59:59Z',
      false,
    ],
    [
      'autumn: 22:00Z on 24 Oct is 00:00 Rome on 25 Oct, opens 25 Oct',
      '2026-10-25',
      '2026-10-24T22:00:00Z',
      true,
    ],
  ])('%s', (_label, opensOn, nowIso, started) => {
    const versions = [version(1, '2026-02-01T12:00:00Z')];
    expect(
      versionFor({ opensAt: dayStart(opensOn) }, versions, new Date(nowIso)),
    ).toEqual({
      number: 1,
      provisional: !started,
    });
  });
});

describe('receiveAndKeep (FR-7, DD-8)', () => {
  const versions = [
    version(1, '2026-10-30T12:00:00Z'),
    version(2, '2026-11-05T12:00:00Z'),
  ];
  const now = new Date('2026-11-06T12:00:00Z');

  it('lists the started timeline under keep with its version, the not started one under receive, and the other-type one under neither', () => {
    const a = timeline(1, '2026-11-01', {
      closesAt: dayEnd('2026-11-20'),
      allResultTypes: false,
      resultTypeKeys: ['policy_change'],
    });
    const b = timeline(2, '2026-11-10', {
      allResultTypes: false,
      resultTypeKeys: ['policy_change'],
    });
    const c = timeline(3, '2026-11-10', {
      allResultTypes: false,
      resultTypeKeys: ['knowledge_product'],
    });
    expect(receiveAndKeep([a, b, c], versions, ['policy_change'], now)).toEqual(
      {
        receive: [2],
        keep: [{ timelineId: 1, version: { number: 1, provisional: false } }],
      },
    );
  });

  it('a timeline for all result types covers any changed type; a scope row of an unchanged type does not', () => {
    const all = timeline(1, '2026-11-10', { allResultTypes: true });
    const scoped = timeline(2, '2026-11-10', {
      allResultTypes: false,
      resultTypeKeys: ['knowledge_product', 'innovation_use'],
    });
    expect(
      receiveAndKeep([all, scoped], versions, ['policy_change'], now),
    ).toEqual({ receive: [1], keep: [] });
    expect(
      receiveAndKeep([all, scoped], versions, ['innovation_use'], now),
    ).toEqual({ receive: [1, 2], keep: [] });
  });

  it('with no changed type nothing is covered, even by an all-types timeline', () => {
    const all = timeline(1, '2026-11-10', { allResultTypes: true });
    expect(receiveAndKeep([all], versions, [], now)).toEqual({
      receive: [],
      keep: [],
    });
  });

  it('a timeline with no steps has not started: it receives', () => {
    expect(
      receiveAndKeep([timeline(1, null)], versions, ['policy_change'], now),
    ).toEqual({ receive: [1], keep: [] });
  });

  it('a finished timeline is in neither list', () => {
    const finished = timeline(1, '2026-10-01', {
      closesAt: dayEnd('2026-10-20'),
    });
    expect(
      receiveAndKeep([finished], versions, ['policy_change'], now),
    ).toEqual({ receive: [], keep: [] });
  });

  it('a started timeline with no version before its start is kept with "none"', () => {
    const early = timeline(1, '2026-10-01', { closesAt: dayEnd('2026-12-01') });
    expect(
      receiveAndKeep(
        [early],
        [version(1, '2026-10-30T12:00:00Z')],
        ['policy_change'],
        now,
      ),
    ).toEqual({ receive: [], keep: [{ timelineId: 1, version: 'none' }] });
  });

  it('keeps the input order inside each list', () => {
    const t = (id: number, opensOn: string) =>
      timeline(id, opensOn, { closesAt: dayEnd('2026-12-31') });
    expect(
      receiveAndKeep(
        [
          t(5, '2026-11-20'),
          t(3, '2026-11-01'),
          t(9, '2026-11-15'),
          t(2, '2026-11-02'),
        ],
        versions,
        ['policy_change'],
        now,
      ),
    ).toEqual({
      receive: [5, 9],
      keep: [
        { timelineId: 3, version: { number: 1, provisional: false } },
        { timelineId: 2, version: { number: 1, provisional: false } },
      ],
    });
  });

  describe('the last closing day, at midnight Rome (a step is open to 23:59:59 of closesAt)', () => {
    // closesAt 6 Nov (winter): still running through 23:59:59 Rome = 22:59:59Z;
    // finished from 00:00 Rome on 7 Nov = 23:00Z.
    it.each([
      [
        '22:30Z on the closing day is 23:30 Rome: not finished',
        '2026-11-06T22:30:00Z',
        true,
      ],
      [
        '22:59:59Z is 23:59:59 Rome: not finished',
        '2026-11-06T22:59:59Z',
        true,
      ],
      [
        '23:00:00Z is 00:00 Rome the next day: finished',
        '2026-11-06T23:00:00Z',
        false,
      ],
      [
        '23:30Z is 00:30 Rome the next day: finished',
        '2026-11-06T23:30:00Z',
        false,
      ],
    ])('%s', (_label, nowIso, kept) => {
      const t = timeline(1, '2026-11-01', { closesAt: dayEnd('2026-11-06') });
      const result = receiveAndKeep(
        [t],
        [version(1, '2026-10-30T12:00:00Z')],
        ['policy_change'],
        new Date(nowIso),
      );
      expect(result.keep.map((k) => k.timelineId)).toEqual(kept ? [1] : []);
      expect(result.receive).toEqual([]);
    });

    it('summer: finished from 22:00Z on the closing day', () => {
      const t = timeline(1, '2026-07-01', { closesAt: dayEnd('2026-07-10') });
      const v = [version(1, '2026-06-01T12:00:00Z')];
      expect(
        receiveAndKeep(
          [t],
          v,
          ['policy_change'],
          new Date('2026-07-10T21:59:59Z'),
        ).keep,
      ).toHaveLength(1);
      expect(
        receiveAndKeep(
          [t],
          v,
          ['policy_change'],
          new Date('2026-07-10T22:00:00Z'),
        ).keep,
      ).toHaveLength(0);
    });
  });

  describe('the start, at midnight Rome (receive turns into keep)', () => {
    it.each([
      [
        '22:59:59Z on 9 Nov is 23:59:59 Rome: receives',
        '2026-11-09T22:59:59Z',
        [1],
        [],
      ],
      [
        '23:00:00Z on 9 Nov is 00:00 Rome on 10 Nov: keeps',
        '2026-11-09T23:00:00Z',
        [],
        [1],
      ],
      [
        '23:30Z on 9 Nov is 00:30 Rome on 10 Nov: keeps',
        '2026-11-09T23:30:00Z',
        [],
        [1],
      ],
    ])('%s', (_label, nowIso, receive, keep) => {
      const t = timeline(1, '2026-11-10');
      const result = receiveAndKeep(
        [t],
        [version(1, '2026-10-30T12:00:00Z')],
        ['policy_change'],
        new Date(nowIso),
      );
      expect(result.receive).toEqual(receive);
      expect(result.keep.map((k) => k.timelineId)).toEqual(keep);
    });
  });
});

// --- timeline-step-times FR-8: versions use the opening minute -----------------
// Rome is UTC+1 on 10 Nov 2026: 08:00 Rome is 07:00Z, 09:00 is 08:00Z and 14:00
// is 13:00Z. Expected values are the scenario literals.

describe('versionFor: the opening moment, to the minute (FR-8)', () => {
  const opensAtTwo = '2026-11-10T14:00' as RomeMinute;
  const opensAtEight = '2026-11-10T08:00' as RomeMinute;

  it('published the same morning: A (opens 14:00) resolves to version 3, B (opened 08:00) keeps version 2', () => {
    const versions = [
      version(1, '2026-10-30T12:00:00Z'),
      version(2, '2026-11-05T12:00:00Z'),
      version(3, '2026-11-10T08:00:00Z'),
    ];
    // Just after the publish (09:05 Rome): A has not started, so it takes the
    // latest version, provisionally; B started at 08:00 and keeps version 2.
    const afterPublish = new Date('2026-11-10T08:05:00Z');
    expect(versionFor({ opensAt: opensAtTwo }, versions, afterPublish)).toEqual(
      {
        number: 3,
        provisional: true,
      },
    );
    expect(
      versionFor({ opensAt: opensAtEight }, versions, afterPublish),
    ).toEqual({ number: 2, provisional: false });
    // Once A has started (15:00 Rome) it keeps version 3: the publish (09:00)
    // is before its opening minute (14:00), though on the same day.
    const afterStart = new Date('2026-11-10T14:00:00Z');
    expect(versionFor({ opensAt: opensAtTwo }, versions, afterStart)).toEqual({
      number: 3,
      provisional: false,
    });
    expect(versionFor({ opensAt: opensAtEight }, versions, afterStart)).toEqual(
      { number: 2, provisional: false },
    );
  });

  it('published in the opening minute (14:00:10): A keeps version 2, the publish instant is not before the start', () => {
    const versions = [
      version(1, '2026-10-30T12:00:00Z'),
      version(2, '2026-11-05T12:00:00Z'),
      version(3, '2026-11-10T13:00:10Z'),
    ];
    const now = new Date('2026-11-10T14:00:00Z');
    expect(versionFor({ opensAt: opensAtTwo }, versions, now)).toEqual({
      number: 2,
      provisional: false,
    });
  });

  it('published one minute before the opening minute (13:59:59) still counts', () => {
    const versions = [
      version(1, '2026-10-30T12:00:00Z'),
      version(3, '2026-11-10T12:59:59Z'),
    ];
    const now = new Date('2026-11-10T14:00:00Z');
    expect(versionFor({ opensAt: opensAtTwo }, versions, now)).toEqual({
      number: 3,
      provisional: false,
    });
  });
});

describe('receiveAndKeep: finish after the last closing minute (FR-8)', () => {
  const closing = timeline(1, '2026-11-02', {
    closesAt: '2026-11-12T17:30' as RomeMinute,
  });
  const versions = [version(1, '2026-10-30T12:00:00Z')];

  it.each([
    [
      '17:30:59 on 12 Nov is not after 17:30: keeps',
      '2026-11-12T16:30:59Z',
      [1],
    ],
    ['17:31:00 on 12 Nov is after 17:30: finished', '2026-11-12T16:31:00Z', []],
  ])('%s', (_label, nowIso, kept) => {
    const result = receiveAndKeep(
      [closing],
      versions,
      ['policy_change'],
      new Date(nowIso),
    );
    expect(result.keep.map((k) => k.timelineId)).toEqual(kept);
  });
});
