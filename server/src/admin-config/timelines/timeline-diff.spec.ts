import { describe, expect, it } from 'vitest';
import { diffTimeline, type TimelineSnapshot } from './timeline-diff.js';

// Expected `changes` maps are literals taken from design 5 (`changes` shape) and
// FR-10 / FR-11; none is computed by the diff. Keys are `name`, `allPrograms`,
// `programIds`, `allResultTypes`, `resultTypeKeys` and
// `steps.<position>.<name|opensOn|closesOn>`; only changed fields appear.

function stored(): TimelineSnapshot {
  return {
    name: 'July 2026',
    allPrograms: false,
    programIds: [1, 2],
    allResultTypes: false,
    resultTypeKeys: ['IDEV', 'KP'],
    steps: [
      {
        position: 1,
        name: 'Assessors',
        opensAt: '2026-11-02T00:00',
        closesAt: '2026-11-06T23:59',
      },
      {
        position: 2,
        name: 'Programs',
        opensAt: '2026-11-10T00:00',
        closesAt: '2026-11-13T23:59',
      },
    ],
  };
}

describe('diffTimeline: nothing changed (FR-11)', () => {
  it('is empty for an identical state', () => {
    expect(diffTimeline(stored(), stored())).toEqual({});
  });

  it('ignores the order of a scope list and the order of the steps array', () => {
    const merged: TimelineSnapshot = {
      ...stored(),
      programIds: [2, 1],
      resultTypeKeys: ['KP', 'IDEV'],
      steps: [...stored().steps].reverse(),
    };
    expect(diffTimeline(stored(), merged)).toEqual({});
  });
});

describe('diffTimeline: only changed keys (FR-10)', () => {
  it('lists a changed name and a changed step closing date, and nothing else', () => {
    const merged: TimelineSnapshot = {
      ...stored(),
      name: 'August 2026',
      steps: [
        stored().steps[0]!,
        { ...stored().steps[1]!, closesAt: '2026-11-20T23:59' },
      ],
    };
    expect(diffTimeline(stored(), merged)).toEqual({
      name: { before: 'July 2026', after: 'August 2026' },
      'steps.2.closesOn': { before: '2026-11-13', after: '2026-11-20' },
    });
  });

  it('keys a step by its position, whatever its place in the array', () => {
    const merged: TimelineSnapshot = {
      ...stored(),
      steps: [
        { ...stored().steps[1]!, name: 'Science Programs' },
        { ...stored().steps[0]!, opensAt: '2026-11-03T00:00' },
      ],
    };
    expect(diffTimeline(stored(), merged)).toEqual({
      'steps.1.opensOn': { before: '2026-11-02', after: '2026-11-03' },
      'steps.2.name': { before: 'Programs', after: 'Science Programs' },
    });
  });

  it('judges a boundary by its moment: 23:59 over a stored 17:30 on the same day is a change, recorded under the day key', () => {
    const base = stored();
    const withTimes: TimelineSnapshot = {
      ...base,
      steps: [
        base.steps[0]!,
        { ...base.steps[1]!, closesAt: '2026-11-13T17:30' },
      ],
    };
    const merged: TimelineSnapshot = {
      ...withTimes,
      steps: [
        withTimes.steps[0]!,
        { ...withTimes.steps[1]!, closesAt: '2026-11-13T23:59' },
      ],
    };
    expect(diffTimeline(withTimes, merged)).toEqual({
      'steps.2.closesOn': { before: '2026-11-13', after: '2026-11-13' },
    });
  });

  it('shows a changed list sorted, before and after', () => {
    const merged: TimelineSnapshot = { ...stored(), programIds: [5, 1, 2] };
    expect(diffTimeline(stored(), merged)).toEqual({
      programIds: { before: [1, 2], after: [1, 2, 5] },
    });
  });

  it('shows a flag change together with the list it empties', () => {
    const merged: TimelineSnapshot = {
      ...stored(),
      allResultTypes: true,
      resultTypeKeys: [],
    };
    expect(diffTimeline(stored(), merged)).toEqual({
      allResultTypes: { before: false, after: true },
      resultTypeKeys: { before: ['IDEV', 'KP'], after: [] },
    });
  });

  it('does not change the states it is given', () => {
    const before = stored();
    const merged: TimelineSnapshot = { ...stored(), programIds: [2, 1, 5] };
    const snapshot = JSON.stringify([before, merged]);
    diffTimeline(before, merged);
    expect(JSON.stringify([before, merged])).toBe(snapshot);
  });
});
