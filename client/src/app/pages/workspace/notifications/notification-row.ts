import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, input, output } from '@angular/core';
import { QaButtonImports } from '../../../ui';
import type { Notification, NotificationType } from './notifications.model';

/**
 * The row's box: unread dot, round icon, then the text. The list's loading placeholder reuses these exact classes, so a
 * placeholder is built from the row's own box and cannot drift from it.
 */
export const ROW_BOX = 'grid w-full grid-cols-[8px_32px_minmax(0,1fr)] items-start gap-x-3 px-4 py-3.5 text-(length:--fs-14) leading-[1.5] sm:px-5';

/** The meta line's box (type pill · batch pill · timeline or step · time); it wraps on phones. */
export const ROW_META = 'mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-(length:--fs-12) leading-[1.4] tabular-nums';

/** Pill and icon colours by type, and the icon's paths (24 viewBox). Needs-action types are coloured; updates are grey. */
interface TypeLook {
  readonly tone: string;
  readonly paths: readonly string[];
}

const CIRCLE = 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z';
const NEUTRAL = 'bg-(--surface-3) text-(--text-3)';

const LOOKS: Readonly<Record<NotificationType, TypeLook>> = {
  'Step complete': { tone: 'bg-(--st-approved-bg) text-(--st-approved-fg)', paths: [CIRCLE, 'm8.5 12.5 2.5 2.5 4.5-5'] },
  'Slow program': { tone: 'bg-(--st-editing-bg) text-(--st-editing-fg)', paths: [CIRCLE, 'M12 7.5V12l3 2'] },
  'At risk': {
    tone: 'bg-(--danger-bg) text-(--danger)',
    paths: ['M10.3 3.9 2.4 17.5a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z', 'M12 9v4M12 17h.01'],
  },
  Stage: { tone: NEUTRAL, paths: ['M3 12h4l3 7 4-14 3 7h4'] },
  'Program response': { tone: NEUTRAL, paths: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'] },
  Escalation: { tone: NEUTRAL, paths: ['M7 17 17 7M8 7h9v9'] },
  'Quality assessed': { tone: NEUTRAL, paths: ['M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z', 'm9 12 2 2 4-4'] },
  Load: { tone: NEUTRAL, paths: ['M12 3v12M7 10l5 5 5-5M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2'] },
};

/**
 * One notification, after the PRMS pattern: unread dot, round icon tinted by type, then the sentence (subjects in bold),
 * a meta line (type pill · batch pill · timeline or step · time) and an optional grey detail line.
 * - Needs-action rows show their buttons ("View results" / "Open next step", and "Not now"); the row itself does nothing.
 * - Update rows are one button that opens their target.
 * No `--text-muted` (under 4.5:1 on `--surface`). Presentational: it only emits; the parent marks read and navigates.
 */
@Component({
  selector: 'qa-notification-row',
  imports: [NgTemplateOutlet, QaButtonImports],
  host: { class: 'block' },
  template: `
    @let n = notification();

    <ng-template #body>
      <span class="block pt-3">
        @if (n.unread) {
          <span aria-hidden="true" class="block size-2 rounded-full bg-(--primary)"></span>
          <span class="sr-only">Unread</span>
        }
      </span>
      <span aria-hidden="true" class="flex size-8 items-center justify-center rounded-full {{ look().tone }}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          @for (d of look().paths; track d) {
            <path [attr.d]="d" />
          }
        </svg>
      </span>
      <span class="block min-w-0">
        <span data-sentence [id]="sentenceId()" class="block text-pretty text-(--text-2) tabular-nums"
          >@for (p of n.sentence; track $index) {@if (p.strong) {<strong class="font-semibold text-(--text)">{{ p.text }}</strong>} @else {<span>{{ p.text }}</span>}}</span
        >
        <span data-meta class="{{ metaBox }} text-(--text-4)">
          <span data-type class="inline-flex h-5 items-center rounded-full px-2 text-(length:--fs-11) font-semibold {{ look().tone }}">{{ n.type }}</span>
          <span data-batch class="inline-flex h-5 items-center rounded-full border border-(--border) px-2 text-(length:--fs-11) font-medium text-(--text-3)">{{ batch() }}</span>
          @if (context()) {
            <span data-context>{{ context() }}</span>
            <span aria-hidden="true">·</span>
          }
          <span data-when>{{ n.when }}</span>
        </span>
        @if (n.detail) {
          <span data-detail class="mt-1 block text-(length:--fs-12) leading-[1.4] text-(--text-4)">{{ n.detail }}</span>
        }
      </span>
    </ng-template>

    @if (n.action) {
      <div data-row data-category="action" class="{{ box }} text-(--text-2)">
        <ng-container *ngTemplateOutlet="body" />
        <div class="col-start-3 mt-3 flex flex-wrap gap-2">
          <button hlmBtn qaBtn tone="secondary" size="sm" type="button" [attr.aria-describedby]="sentenceId()" (click)="opened.emit(n)">
            <span class="text-(--accent)">{{ n.action }}</span>
          </button>
          <button hlmBtn qaBtn tone="secondary" size="sm" type="button" [attr.aria-describedby]="sentenceId()" (click)="dismissed.emit(n)">Not now</button>
        </div>
      </div>
    } @else {
      <button
        type="button"
        data-row
        data-category="info"
        class="{{ box }} cursor-pointer border-0 bg-transparent text-left text-(--text-2) hover:bg-(--surface-2) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--accent)"
        (click)="opened.emit(n)"
      >
        <ng-container *ngTemplateOutlet="body" />
      </button>
    }
  `,
})
export class NotificationRow {
  readonly notification = input.required<Notification>();
  /** Name of the notification's timeline. The parent resolves it, so the row reads no mock. */
  readonly timelineName = input<string>('');
  /** "Main batch", "Complementary batch" or "All batches". */
  readonly batch = input<string>('');
  /** The main action ("View results", "Open next step"), or a click on an update row. */
  readonly opened = output<Notification>();
  /** "Not now": only marks it read. */
  readonly dismissed = output<Notification>();

  protected readonly box = ROW_BOX;
  protected readonly metaBox = ROW_META;
  protected readonly look = computed(() => LOOKS[this.notification().type]);
  protected readonly sentenceId = computed(() => `notification-${this.notification().id}-sentence`);
  /** The step when the notification names one, else the timeline; nothing for an update about every timeline. */
  protected readonly context = computed(() => {
    const n = this.notification();
    return n.step ?? (n.timelineId === 'all' ? '' : this.timelineName());
  });
}
