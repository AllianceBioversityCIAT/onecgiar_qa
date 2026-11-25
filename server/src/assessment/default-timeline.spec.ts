import { describe, expect, it } from 'vitest';
import {
  pickDefaultTimeline,
  type DefaultTimelineCandidate,
} from './default-timeline.js';

const t = (
  id: number,
  kind: string,
  state: 'closed' | 'in_progress' | 'upcoming' | null,
  opensAt = '2026-11-01T00:00',
): DefaultTimelineCandidate => ({
  id,
  kind,
  step: state === null ? null : { state, opensAt },
});

describe('pickDefaultTimeline', () => {
  it('skips a closed official timeline for one in progress', () => {
    expect(
      pickDefaultTimeline([
        t(27, 'official', 'closed'),
        t(34, 'additional', 'in_progress'),
      ]),
    ).toBe(34);
  });

  it('prefers the official timeline among those in progress', () => {
    expect(
      pickDefaultTimeline([
        t(34, 'additional', 'in_progress'),
        t(40, 'official', 'in_progress'),
      ]),
    ).toBe(40);
  });

  it('keeps the list order among additional timelines in progress', () => {
    expect(
      pickDefaultTimeline([
        t(34, 'additional', 'in_progress'),
        t(35, 'additional', 'in_progress'),
      ]),
    ).toBe(34);
  });

  it('with none in progress, takes the step that opens soonest', () => {
    expect(
      pickDefaultTimeline([
        t(27, 'official', 'closed'),
        t(36, 'additional', 'upcoming', '2026-12-05T00:00'),
        t(35, 'additional', 'upcoming', '2026-12-01T00:00'),
      ]),
    ).toBe(35);
  });

  it('with nothing open or upcoming, falls back to the official one, else the first', () => {
    expect(
      pickDefaultTimeline([
        t(28, 'additional', 'closed'),
        t(27, 'official', 'closed'),
      ]),
    ).toBe(27);
    expect(
      pickDefaultTimeline([
        t(28, 'additional', null),
        t(29, 'additional', 'closed'),
      ]),
    ).toBe(28);
  });

  it('is null for an empty list', () => {
    expect(pickDefaultTimeline([])).toBeNull();
  });
});
