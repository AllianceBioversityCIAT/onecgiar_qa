/** The closed set of update types a notification can have (requirements FR-3). */
export const NOTIFICATION_TYPES = [
  'Stage',
  'Program response',
  'Escalation',
  'Third-party broker',
  'PPU',
  'Quality assessed',
  'Waiting',
  'At risk',
  'Load',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Day group of the panel and the page, newest first. */
export type DayGroup = 'today' | 'yesterday' | 'earlier';

/** Where the action of a notification goes: a result's review page, or the Results list with filters. */
export interface NotificationTarget {
  /** `/results` (a filtered list) or `/results/<code>` (one result). */
  readonly path: string;
  readonly queryParams?: Readonly<Record<string, string>>;
}

/** State of the notifications source. */
export type NotificationsLoadState = 'loading' | 'ready' | 'error';

/**
 * One update shown to the QA Admin. The sentence a row shows is `subject` in bold, a space, then `text`.
 * TODO(api): the server returns this same shape; `total`, `delta` and `target` are computed there.
 */
export interface Notification {
  readonly id: string;
  readonly type: NotificationType;
  /** Bold start of the sentence. */
  readonly subject: string;
  /** Rest of the sentence (without a leading space). */
  readonly text: string;
  /** A `TIMELINES` id, or `all`: the update is about every timeline and shows only under "All timelines". */
  readonly timelineId: string;
  readonly day: DayGroup;
  /** Display time ("10:42"), or the date for `earlier`. */
  readonly time: string;
  /** Initial read state; the store keeps the live one. */
  readonly unread: boolean;
  readonly target: NotificationTarget;
  /** The number the sentence compares with its target: what Results shows there. `null` when the target shows no list. */
  readonly total: number | null;
  /** Change since yesterday ("18 since yesterday"). Authored: never compared with a target. */
  readonly delta: number | null;
  readonly action: 'View result' | 'View results';
}
