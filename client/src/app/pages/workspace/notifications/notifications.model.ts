/**
 * The closed set of notification types: only what María Julia asked for (meeting, 2026-10-27; Juanpa, 2026-10-29).
 * - "Step complete": the assessors, the lead assessor or the third-party broker finished a batch.
 * - "Slow program": a science program has not started, or goes too slowly, replying.
 * Both need her action, so every notification carries a button. At risk, Escalation, Program response and Load were
 * dropped and are kept as ideas in `docs/ideas.md`.
 */
export const NOTIFICATION_TYPES = ['Step complete', 'Slow program'] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

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
 * TODO(api): the server returns this same shape; `sentence`, `total` and `target` are computed there.
 */
export interface Notification {
  readonly id: string;
  readonly type: NotificationType;
  /** The sentence, in parts; read as plain text it is the parts joined. */
  readonly sentence: readonly SentencePart[];
  /** Optional third line in grey ("Assessed by 2 assessors, or by 1 for…"). */
  readonly detail: string | null;
  /** A `TIMELINES` id, or `all` when the update is about every timeline. */
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
  /** Label of the main button of an `action` notification ("Open next step", "View results"); `null` for updates. */
  readonly action: 'Open next step' | 'View results' | null;
}

/** The sentence as plain text, for accessible names and tests. */
export const sentenceText = (n: Notification): string => n.sentence.map((p) => p.text).join('');
