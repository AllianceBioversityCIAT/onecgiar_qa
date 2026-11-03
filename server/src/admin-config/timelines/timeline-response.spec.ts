import { describe, expect, it } from 'vitest';
import type { Timeline } from '../../database/drizzle/schema/timelines.js';
import type { TimelineStep } from '../../database/drizzle/schema/timeline-steps.js';
import type { RomeMinute } from '../rome-date.js';
import { toTimelineResponse } from './timeline-response.js';
import type { TimelineBundle } from './timelines.store.js';

// Expected values are literals from timeline-step-times FR-1 (a valid moment is
// returned exactly), FR-9 (read returns both forms) and FR-10 (read carries the
// QA zone). None is computed by the mapper.

const timeline = {
  id: 4,
  cycleId: 3,
  name: 'July 2026',
  kind: 'official',
  allPrograms: false,
  allResultTypes: false,
  createdAt: new Date('2026-10-20T08:00:00Z'),
  version: 1,
} as unknown as Timeline;

function step(
  position: number,
  opensAt: string,
  closesAt: string,
): TimelineStep {
  return {
    id: position,
    timelineId: 4,
    position,
    name: `Step ${position}`,
    audience: position === 1 ? 'assessors' : 'programs',
    opensAt: opensAt as RomeMinute,
    closesAt: closesAt as RomeMinute,
    round: 1,
    requiresLoad: position === 1,
  } as unknown as TimelineStep;
}

const bundle: TimelineBundle = {
  timeline,
  steps: [
    step(2, '2026-11-10T00:00', '2026-11-13T23:59'),
    step(1, '2026-11-02T09:30', '2026-11-06T17:45'),
  ],
  programIds: [2],
  resultTypeKeys: ['INNOVATION_DEV'],
};

describe('toTimelineResponse: moments and zone (FR-1, FR-9, FR-10)', () => {
  const answer = toTimelineResponse(
    bundle,
    '2026-10-27T10:00' as RomeMinute,
    {},
    false,
  );

  it('returns each stored moment exactly, as opensAt and closesAt', () => {
    expect(
      answer.steps.map((s) => [s.position, s.opensAt, s.closesAt]),
    ).toEqual([
      [1, '2026-11-02T09:30', '2026-11-06T17:45'],
      [2, '2026-11-10T00:00', '2026-11-13T23:59'],
    ]);
  });

  it('keeps opensOn and closesOn as the day part of the moment', () => {
    expect(answer.steps.map((s) => [s.opensOn, s.closesOn])).toEqual([
      ['2026-11-02', '2026-11-06'],
      ['2026-11-10', '2026-11-13'],
    ]);
  });

  it('carries the QA time zone on the timeline', () => {
    expect(answer.timeZone).toBe('Europe/Rome');
  });
});
