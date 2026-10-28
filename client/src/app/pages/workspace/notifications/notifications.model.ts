/** The closed set of notification types: first the ones that need the QA Admin's action, then the updates. */
export const NOTIFICATION_TYPES = [
  'Step complete',
  'Slow program',
  'At risk',
  'Stage',
  'Program response',
  'Escalation',
  'Quality assessed',
  'Load',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** The page's tabs split notifications in two: the ones with buttons, and the updates that only open their target. */
export type NotificationCategory = 'action' | 'info';

export const NOTIFICATION_CATEGORY: Readonly<Record<NotificationType, NotificationCategory>> = {
  'Step complete': 'action',
  'Slow program': 'action',
  'At risk': 'action',
  Stage: 'info',
  'Program response': 'info',
  Escalation: 'info',
  'Quality assessed': 'info',
  Load: 'info',
};

/** Day group of the page, newest first. */
export type DayGroup = 'today' | 'yesterday' | 'earlier';

/** Where a notification goes: the Cycle page, a result's review page, or the Results list with filters. */
export interface NotificationTarget {
  /** `/cycle`, `/results` (a filtered list) or `/results/<code>` (one result). */
  readonly path: string;
  readonly queryParams?: Readonly<Record<string, string>>;
}

/** State of the notifications source. */
export type NotificationsLoadState = 'loading' | 'ready' | 'error';

/** One piece of a sentence; `strong` pieces are its subjects (codes, programs, steps, timelines, counts). */
export interface SentencePart {
  readonly text: string;
  readonly strong?: boolean;
}

/**
 * One notification for the QA Admin.
 * TODO(api): the server returns this same shape; `sentence`, `total`, `delta` and `target` are computed there.
 */
export interface Notification {
  readonly id: string;
  readonly type: NotificationType;
  /** The sentence, in parts; read as plain text it is the parts joined. */
  readonly sentence: readonly SentencePart[];
  /** Optional third line in grey ("Assessed by 2 assessors, or by 1 for…"). */
  readonly detail: string | null;
  /** A `TIMELINES` id, or `all`: the update is about every timeline and shows only under "All timelines". */
  readonly timelineId: string;
  /** Science program the notification is about, or `null` when it is about every program. */
  readonly program: string | null;
  /** Short step name the meta line shows instead of the timeline name ("Programs correct"); `null` shows the timeline. */
  readonly step: string | null;
  readonly day: DayGroup;
  /** Relative time ("2 hours ago", "Yesterday", "3 days ago"). */
  readonly when: string;
  /** Initial read state; the store keeps the live one. */
  readonly unread: boolean;
  readonly target: NotificationTarget;
  /** The number the sentence compares with what Results shows for it. `null` when it opens one result. */
  readonly total: number | null;
  /** Change since yesterday ("18 since yesterday"). Authored: never compared with a target. */
  readonly delta: number | null;
  /** Label of the main button of an `action` notification ("Open next step", "View results"); `null` for updates. */
  readonly action: 'Open next step' | 'View results' | null;
}

/** The sentence as plain text, for search and accessible names. */
export const sentenceText = (n: Notification): string => n.sentence.map((p) => p.text).join('');
