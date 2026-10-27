import { Component, computed, input, output } from '@angular/core';
import { QaButtonImports } from '../../../ui';
import { NotificationRow, ROW_ACTION_PLACE, ROW_BOX, ROW_META } from './notification-row';
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

/**
 * On the page from 640 px most sentences fit on one line (measured 2026-10-27: 7 of 11 at 640, 10 of 11 at 1024, all at
 * 1280+), so the second line box is hidden there. The panel is a fixed width and keeps both.
 */
const PAGE_WIDE_SECOND_LINE = 'sm:hidden';

/**
 * The notifications in day groups (Today, Yesterday, Earlier) with their loading, error and empty states.
 * Presentational: it keeps the order it is given (newest first) and only emits what happened; the parent owns the store.
 * Eyebrow labels in `--text-4`; lines only between rows, never between a label and its first row.
 * A loading placeholder is the row's own box (same padding and line boxes, see `ROW_BOX`), so it matches a two-line row
 * (a one-line row on the page from 640 px, see `PAGE_WIDE_SECOND_LINE`).
 * It reads no mock data: the page passes the timeline names.
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
            <div data-placeholder aria-hidden="true" class="{{ box() }}">
              <span></span>
              <span class="block min-w-0">
                @for (line of sentenceLines; track line; let second = $last) {
                  <span data-placeholder-line class="flex h-[1.5em] items-center {{ second && variant() === 'page' ? pageWideSecondLine : '' }}">
                    <span class="h-3 rounded-[4px] bg-(--surface-3) motion-safe:animate-pulse {{ line }}"></span>
                  </span>
                }
                <span data-placeholder-meta class="flex h-[1.4em] items-center {{ metaBox }}">
                  <span class="h-2.5 w-2/5 rounded-[4px] bg-(--surface-3) motion-safe:animate-pulse"></span>
                </span>
              </span>
              @if (variant() === 'page') {
                <span data-placeholder-action class="block min-h-8 w-20 max-sm:min-h-10 {{ actionPlace }}"></span>
              }
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
      @for (g of groups(); track g.key) {
        <section>
          <h3 class="m-0 pt-4 pb-1 text-(length:--fs-11) font-semibold tracking-[0.08em] text-(--text-4) uppercase {{ pad() }}">{{ g.label }}</h3>
          <ul class="m-0 list-none p-0">
            @for (n of g.items; track n.id; let last = $last) {
              <li class="border-(--border-soft)" [class.border-b]="!last">
                <qa-notification-row [notification]="n" [variant]="variant()" [timelineName]="timelineName(n)" (opened)="opened.emit($event)" />
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
  readonly variant = input<'panel' | 'page'>('panel');
  readonly state = input<NotificationsLoadState>('ready');
  /**
   * Names of the timelines by id, for `variant="page"` (`all` reads "All timelines" when absent). The parent builds it;
   * the panel never shows a timeline and needs nothing.
   */
  readonly timelineNames = input<Readonly<Record<string, string>>>({});
  /**
   * Which empty state to show when there are no items: the Unread view is empty ("Show all"), the filters match nothing
   * ("Clear filters"), or there are no notifications at all (no action, so it never loops back to the same view).
   */
  readonly emptyKind = input<'unread' | 'no-match' | 'all'>('all');

  /** A row or its action was activated. */
  readonly opened = output<Notification>();
  /** "Try again" on the error state. */
  readonly retry = output<void>();
  /** "Show all" (Unread is empty) or "Clear filters" (nothing matches); never fired for the `all` kind. */
  readonly emptyAction = output<void>();

  protected readonly placeholders = PLACEHOLDERS;
  protected readonly sentenceLines = SENTENCE_LINES;
  protected readonly pageWideSecondLine = PAGE_WIDE_SECOND_LINE;
  protected readonly metaBox = ROW_META;
  protected readonly actionPlace = ROW_ACTION_PLACE;
  protected readonly box = computed(() => ROW_BOX[this.variant()]);
  /** Same horizontal padding as the row each eyebrow labels. */
  protected readonly pad = computed(() => (this.variant() === 'page' ? 'px-5' : 'px-4'));

  protected readonly empty = computed((): { title: string; action: string | null } => {
    switch (this.emptyKind()) {
      case 'unread':
        return { title: 'No unread notifications', action: 'Show all' };
      case 'no-match':
        return { title: 'No notifications match these filters', action: 'Clear filters' };
      default:
        return { title: 'No notifications yet', action: null };
    }
  });

  protected timelineName(n: Notification): string {
    return this.timelineNames()[n.timelineId] ?? (n.timelineId === 'all' ? 'All timelines' : '');
  }

  protected readonly groups = computed(() =>
    DAYS.map((d) => ({ ...d, items: this.items().filter((n) => n.day === d.key) })).filter((g) => g.items.length > 0),
  );
}
