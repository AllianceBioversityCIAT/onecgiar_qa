// Pure rules for the version a timeline uses and for the publish preview's
// receive / keep split (design 7.1, FR-9, FR-7, DD-5, DD-8, NFR-4). No I/O and
// no clock: `now` is always a parameter (P-13, NFR-4). Every date is a Europe/Rome
// calendar day as a `YYYY-MM-DD` string from `rome-date.ts`, compared as strings;
// no `Date` is ever built from a step date, and the process zone (`TZ`) never
// changes an answer.

import { compareDates, todayInRome } from '../rome-date.js';

/**
 * What the module needs of a timeline (fed by `listTimelineStarts`, design 7.3):
 * step 1's `opensOn` and the last step's `closesOn`, both `null` when the
 * timeline has no steps, and its scope.
 */
export interface TimelineStart {
  id: number;
  opensOn: string | null;
  closesOn: string | null;
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
 * A timeline has started at 00:00 Rome on its step 1's `opensOn`, even while it
 * is on hold (S-3). A hold depends on a load, never on dates, so it does not
 * move the start. A timeline with no steps has not started.
 */
function hasStarted(opensOn: string | null, today: string): opensOn is string {
  return opensOn !== null && compareDates(opensOn, today) <= 0;
}

/**
 * Finished: today in Rome is after the last step's `closesOn`, the same date
 * rule `viewTimeline` uses for status `finished` (`timelines/timeline-view.ts`,
 * `compareDates(today, lastClose) > 0` for a timeline whose step 1 has opened).
 * The view's load hold is not part of this input (design 7.3 reads dates and
 * scope only): a timeline is finished here on dates alone.
 */
function isFinished(
  opensOn: string | null,
  closesOn: string | null,
  today: string,
): boolean {
  return (
    hasStarted(opensOn, today) &&
    closesOn !== null &&
    compareDates(today, closesOn) > 0
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
 * of its publish instant is before `opensOn` (S-3, S-5): one published on the
 * opening day, at any hour, does not reach the timeline. A started timeline
 * resolves to the latest counting version and keeps it (S-13), or to `'none'`
 * when no version counts. A timeline that has not started resolves to the
 * latest version, provisional (S-4).
 */
export function versionFor(
  timeline: Pick<TimelineStart, 'opensOn'>,
  versions: readonly PublishedVersion[],
  now: Date,
): VersionResolution {
  const { opensOn } = timeline;
  if (!hasStarted(opensOn, todayInRome(now))) {
    const newest = latest(versions);
    return newest === undefined
      ? 'none'
      : { number: newest.number, provisional: true };
  }
  const counting = latest(
    versions.filter(
      (candidate) =>
        compareDates(todayInRome(candidate.publishedAt), opensOn) < 0,
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
  const today = todayInRome(now);
  const result: ReceiveAndKeep = { receive: [], keep: [] };
  for (const timeline of timelines) {
    const covers =
      changedTypes.length > 0 &&
      (timeline.allResultTypes ||
        timeline.resultTypeKeys.some((key) => changedTypes.includes(key)));
    if (!covers) continue;
    if (!hasStarted(timeline.opensOn, today)) {
      result.receive.push(timeline.id);
    } else if (!isFinished(timeline.opensOn, timeline.closesOn, today)) {
      result.keep.push({
        timelineId: timeline.id,
        version: versionFor(timeline, versions, now),
      });
    }
  }
  return result;
}
