import { Component, computed, input, output } from '@angular/core';
import { QaButtonImports } from '../../../ui';
import { NotificationRow, ROW_BOX, ROW_META } from './notification-row';
import type { DayGroup, Notification, NotificationsLoadState } from './notifications.model';

const DAYS: readonly { readonly key: DayGroup; readonly label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'earlier', label: 'Earlier' },
];

/** Loading shows this many placeholder rows. */
const PLACEHOLDERS: readonly number[] = [0, 1, 2, 3];

/** A typical row wraps its sentence onto two lines; the placeholder holds two sentence line boxes, with these bar widths. */
const SENTENCE_LINES: readonly string[] = ['w-11/12', 'w-1/2'];

/** What the list says when it has nothing to show, and the way out (if any). */
export interface NotificationsEmpty {
  readonly title: string;
  readonly action: string | null;
}

/**
 * The notifications in day groups (Today, Yesterday, Earlier) with their loading, error and empty states, inside the page's
 * card. Each group starts with a full-width band (grey background, uppercase label and its count); lines between rows.
 * Presentational: it keeps the order it is given (newest first) and only emits what happened; the parent owns the store.
 * A loading placeholder is the row's own box (same padding and line boxes, see `ROW_BOX`), so it matches a two-line row.
 * It reads no mock data: the page passes the timeline names and batch labels.
 */
@Component({
  selector: 'qa-notification-list',
  imports: [NotificationRow, QaButtonImports],
  host: { class: 'block' },
  template: `
    @if (state() === 'loading') {
      <div role="status" aria-busy="true">
        <span class="sr-only">Loading notifications</span>
        @for (p of placeholders; track p; let last = $last) {
          <div class="border-(--border-soft)" [class.border-b]="!last">
            <div data-placeholder aria-hidden="true" class="{{ box }}">
              <span></span>
              <span class="block size-8 rounded-full bg-(--surface-3) motion-safe:animate-pulse"></span>
              <span class="block min-w-0">
                @for (line of sentenceLines; track line) {
                  <span data-placeholder-line class="flex h-[1.5em] items-center">
                    <span class="h-3 rounded-[4px] bg-(--surface-3) motion-safe:animate-pulse {{ line }}"></span>
                  </span>
                }
                <span data-placeholder-meta class="h-5 {{ metaBox }}">
                  <span class="h-2.5 w-2/5 rounded-[4px] bg-(--surface-3) motion-safe:animate-pulse"></span>
                </span>
              </span>
            </div>
          </div>
        }
      </div>
    } @else if (state() === 'error') {
      <div role="alert" class="flex flex-col items-center gap-3 px-5 py-8 text-center">
        <p class="m-0 text-(length:--fs-14) font-semibold text-(--text)">Couldn't load notifications.</p>
        <button hlmBtn qaBtn tone="secondary" size="sm" type="button" (click)="retry.emit()">Try again</button>
      </div>
    } @else if (groups().length === 0) {
      <div class="flex flex-col items-center gap-3 px-5 py-8 text-center">
        <p class="m-0 text-(length:--fs-14) font-semibold text-(--text)">{{ empty().title }}</p>
        @if (empty().action; as action) {
          <button hlmBtn qaBtn tone="link" size="sm" type="button" (click)="emptyAction.emit()">{{ action }}</button>
        }
      </div>
    } @else {
      @for (g of groups(); track g.key; let first = $first) {
        <section>
          <h3
            data-group
            class="m-0 flex items-center gap-2 border-b border-(--border-soft) bg-(--surface-2) px-4 py-2 text-(length:--fs-11) leading-[1.4] font-semibold tracking-[0.08em] text-(--text-3) uppercase sm:px-5"
            [class.border-t]="!first"
          >
            {{ g.label }}<span data-group-count class="font-medium tracking-normal text-(--text-4) tabular-nums"
              ><span class="sr-only">, </span>{{ g.items.length }}<span class="sr-only"> notification{{ g.items.length === 1 ? '' : 's' }}</span></span
            >
          </h3>
          <ul class="m-0 list-none p-0">
            @for (n of g.items; track n.id; let last = $last) {
              <li class="border-(--border-soft)" [class.border-b]="!last">
                <qa-notification-row
                  [notification]="n"
                  [timelineName]="timelineNames()[n.timelineId] ?? ''"
                  [batch]="batchLabels()[n.timelineId] ?? ''"
                  (opened)="opened.emit($event)"
                  (dismissed)="dismissed.emit($event)"
                />
              </li>
            }
          </ul>
        </section>
      }
    }
  `,
})
export class NotificationList {
  /** Newest first, as the store gives them; only the day groups are made here. */
  readonly items = input<readonly Notification[]>([]);
  readonly state = input<NotificationsLoadState>('ready');
  /** Names of the timelines by id. The parent builds it, so the list reads no mock. */
  readonly timelineNames = input<Readonly<Record<string, string>>>({});
  /** "Main batch", "Complementary batch" or "All batches", by timeline id. */
  readonly batchLabels = input<Readonly<Record<string, string>>>({});
  /** What to say when there are no items; `action` is the button that clears what hides them. */
  readonly empty = input<NotificationsEmpty>({ title: 'No notifications yet', action: null });

  /** A row's main action, or a click on an update row. */
  readonly opened = output<Notification>();
  /** "Not now" on a needs-action row. */
  readonly dismissed = output<Notification>();
  /** "Try again" on the error state. */
  readonly retry = output<void>();
  /** The empty state's action; never fired when it has none. */
  readonly emptyAction = output<void>();

  protected readonly placeholders = PLACEHOLDERS;
  protected readonly sentenceLines = SENTENCE_LINES;
  protected readonly box = ROW_BOX;
  protected readonly metaBox = ROW_META;

  protected readonly groups = computed(() =>
    DAYS.map((d) => ({ ...d, items: this.items().filter((n) => n.day === d.key) })).filter((g) => g.items.length > 0),
  );
}
