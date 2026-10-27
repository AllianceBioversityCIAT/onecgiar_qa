// Pure rules for the version a timeline uses and for the publish preview's
// receive / keep split (design 7.1, FR-9, FR-7, DD-5, DD-8, NFR-4). No I/O and
// no clock: `now` is always a parameter (P-13, NFR-4). Every date is a Europe/Rome
// calendar day as a `YYYY-MM-DD` string from `rome-date.ts`, compared as strings;
// no `Date` is ever built from a step date, and the process zone (`TZ`) never
// changes an answer.

import { compareDates, todayInRome } from '../rome-date.js';

/**
 * What the module needs of a timeline (fed by `listTimelineStarts`, design 7.3):
 * step 1's `opensAt` and the last step's `closesAt`, both `null` when the
 * timeline has no steps, and its scope.
 */
export interface TimelineStart {
  id: number;
  opensAt: string | null;
  closesAt: string | null;
  allResultTypes: boolean;
  resultTypeKeys: readonly string[];
}

/** A published version: its number and publish instant (`published_at`). */
export interface PublishedVersion {
  number: number;
  publishedAt: Date;
}

/**
 * The version a timeline resolves to, or `'none'`: "no configuration", never a
 * fallback to defaults or to a later version (FR-9). `provisional` is true while
 * the timeline has not started, so a later publication can still change it (S-4).
 */
export type VersionResolution =
  { number: number; provisional: boolean } | 'none';

export interface KeptTimeline {
  timelineId: number;
  version: VersionResolution;
}

export interface ReceiveAndKeep {
  /** Timelines that will resolve to the new version: covered and not started. */
  receive: number[];
  /** Timelines that keep the version they started with: covered, started, not finished. */
  keep: KeptTimeline[];
}

/**
 * A timeline has started at 00:00 Rome on its step 1's `opensAt`, even while it
 * is on hold (S-3). A hold depends on a load, never on dates, so it does not
 * move the start. A timeline with no steps has not started.
 */
function hasStarted(opensAt: string | null, now: string): opensAt is string {
  return opensAt !== null && compareDates(opensAt, now) <= 0;
}

/**
 * Finished: the Rome day is after the last step's `closesAt`, the same date
 * rule `viewTimeline` uses for status `finished` (`timelines/timeline-view.ts`,
 * `compareDates(now, lastClose) > 0` for a timeline whose step 1 has opened).
 * The view's load hold is not part of this input (design 7.3 reads dates and
 * scope only): a timeline is finished here on dates alone.
 */
function isFinished(
  opensAt: string | null,
  closesAt: string | null,
  now: string,
): boolean {
  return (
    hasStarted(opensAt, now) &&
    closesAt !== null &&
    compareDates(now, closesAt) > 0
  );
}

/** The highest-numbered version of the list, or `undefined` when it is empty. */
function latest(
  versions: readonly PublishedVersion[],
): PublishedVersion | undefined {
  return versions.reduce<PublishedVersion | undefined>(
    (best, candidate) =>
      best === undefined || candidate.number > best.number ? candidate : best,
    undefined,
  );
}

/**
 * The version a timeline uses (FR-9, DD-5). A version counts when the Rome day
 * of its publish instant is before `opensAt` (S-3, S-5): one published on the
 * opening day, at any hour, does not reach the timeline. A started timeline
 * resolves to the latest counting version and keeps it (S-13), or to `'none'`
 * when no version counts. A timeline that has not started resolves to the
 * latest version, provisional (S-4).
 */
export function versionFor(
  timeline: Pick<TimelineStart, 'opensAt'>,
  versions: readonly PublishedVersion[],
  now: Date,
): VersionResolution {
  const { opensAt } = timeline;
  if (!hasStarted(opensAt, todayInRome(now))) {
    const newest = latest(versions);
    return newest === undefined
      ? 'none'
      : { number: newest.number, provisional: true };
  }
  const counting = latest(
    versions.filter(
      (candidate) =>
        compareDates(todayInRome(candidate.publishedAt), opensAt) < 0,
    ),
  );
  return counting === undefined
    ? 'none'
    : { number: counting.number, provisional: false };
}

/**
 * The preview's split of the cycle's timelines (FR-7, DD-8). A timeline covers
 * a changed type when it is for all result types or has a scope row of one; with
 * no changed type nothing is covered. Covered and not started: receive. Covered,
 * started and not finished: keep, with its resolved version. Finished timelines
 * and timelines not covering a changed type are in neither list. Input order is
 * kept in each list.
 */
export function receiveAndKeep(
  timelines: readonly TimelineStart[],
  versions: readonly PublishedVersion[],
  changedTypes: readonly string[],
  now: Date,
): ReceiveAndKeep {
  const romeNow = todayInRome(now);
  const result: ReceiveAndKeep = { receive: [], keep: [] };
  for (const timeline of timelines) {
    const covers =
      changedTypes.length > 0 &&
      (timeline.allResultTypes ||
        timeline.resultTypeKeys.some((key) => changedTypes.includes(key)));
    if (!covers) continue;
    if (!hasStarted(timeline.opensAt, romeNow)) {
      result.receive.push(timeline.id);
    } else if (!isFinished(timeline.opensAt, timeline.closesAt, romeNow)) {
      result.keep.push({
        timelineId: timeline.id,
        version: versionFor(timeline, versions, now),
      });
    }
  }
  return result;
}
