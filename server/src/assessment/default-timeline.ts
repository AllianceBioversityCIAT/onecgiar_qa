import type { TimelineStepState } from '../admin-config/timelines/timeline-view.js';

export interface DefaultTimelineCandidate {
  id: number;
  kind: string;
  /** The caller's step on the timeline; `null` when it has none. */
  step: { state: TimelineStepState; opensAt: string } | null;
}

/**
 * The timeline a picker opens first. A finished official timeline must not
 * win over one the caller can work on now, so, in the caller's list order:
 * 1. a timeline whose step is in progress, the official one first;
 * 2. else the one whose step opens soonest;
 * 3. else the official one;
 * 4. else the first one. `null` for an empty list.
 */
export function pickDefaultTimeline(
  candidates: readonly DefaultTimelineCandidate[],
): number | null {
  const official = (list: readonly DefaultTimelineCandidate[]) =>
    list.find((c) => c.kind === 'official') ?? list[0];

  const open = candidates.filter((c) => c.step?.state === 'in_progress');
  if (open.length > 0) return official(open).id;

  const upcoming = candidates
    .filter((c) => c.step?.state === 'upcoming')
    .sort((a, b) =>
      a.step!.opensAt < b.step!.opensAt
        ? -1
        : a.step!.opensAt > b.step!.opensAt
          ? 1
          : 0,
    );
  if (upcoming.length > 0) return upcoming[0].id;

  return official(candidates)?.id ?? null;
}
