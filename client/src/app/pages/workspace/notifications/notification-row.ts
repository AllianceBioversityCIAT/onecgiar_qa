import { NgTemplateOutlet } from '@angular/common';
import { Component, input, output } from '@angular/core';
import { QaButtonImports } from '../../../ui';
import type { Notification } from './notifications.model';

/**
 * The row's box, per variant: grid, padding, font size and line height. The list's loading placeholder reuses these exact
 * classes, so a placeholder is built from the row's own box and cannot drift from it (FR-8).
 */
export const ROW_BOX = {
  panel: 'grid w-full grid-cols-[8px_minmax(0,1fr)] items-start gap-x-3 px-4 py-3 text-(length:--fs-13) leading-[1.5]',
  page: 'grid grid-cols-[8px_minmax(0,1fr)] items-start gap-x-3 gap-y-1 px-5 py-3.5 text-(length:--fs-14) leading-[1.5] sm:grid-cols-[8px_minmax(0,1fr)_auto] sm:gap-x-4',
} as const;

/** The meta line's box (type · timeline · time): one 12 px line at 1.4. */
export const ROW_META = 'mt-0.5 text-(length:--fs-12) leading-[1.4] tabular-nums';

/** Where the page action sits in the grid: beside the text from 640 px, below it under 640 px. */
export const ROW_ACTION_PLACE = 'col-start-2 justify-self-start sm:col-start-3 sm:row-start-1 sm:self-center sm:justify-self-end';

/**
 * One notification: the sentence (subject in bold), then "type · timeline · time" in gray.
 * Panel rows are one big button (hover `--surface-3`); page rows keep the sentence and an action as separate controls.
 * Only the At risk type label is red. No icons, and no `--text-muted` (under 4.5:1 on `--surface`).
 * Presentational: opening it only emits `opened`; the parent marks it read and navigates.
 * It reads no mock data: the page variant shows the timeline name it is given.
 */
@Component({
  selector: 'qa-notification-row',
  imports: [NgTemplateOutlet, QaButtonImports],
  host: { class: 'block' },
  template: `
    @let n = notification();

    <ng-template #dot>
      <span class="relative block pt-[7px]">
        @if (n.unread) {
          <span aria-hidden="true" class="block size-2 rounded-full bg-(--primary)"></span>
          <span class="sr-only">Unread</span>
        }
      </span>
    </ng-template>

    <ng-template #sentence>
      <span data-sentence class="block text-pretty tabular-nums"><strong class="font-semibold text-(--text)">{{ n.subject }}</strong> {{ n.text }}</span>
    </ng-template>

    <ng-template #meta>
      <span data-meta class="block {{ metaBox }} text-(--text-4)"
        ><span data-type [class]="n.type === 'At risk' ? 'font-semibold text-(--danger)' : 'text-(--text-4)'">{{ n.type }}</span
        >@if (variant() === 'page' && timelineName()) { · {{ timelineName() }}} · {{ n.time }}</span
      >
    </ng-template>

    @if (variant() === 'panel') {
      <button
        type="button"
        data-row
        class="{{ box.panel }} cursor-pointer border-0 bg-transparent text-left text-(--text-2) hover:bg-(--surface-3) focus-visible:shadow-(--focus-ring) focus-visible:outline-none"
        (click)="opened.emit(n)"
      >
        <ng-container *ngTemplateOutlet="dot" />
        <span class="block min-w-0">
          <ng-container *ngTemplateOutlet="sentence" />
          <ng-container *ngTemplateOutlet="meta" />
        </span>
      </button>
    } @else {
      <div data-row class="{{ box.page }} text-(--text-2)">
        <ng-container *ngTemplateOutlet="dot" />
        <div class="min-w-0">
          <button
            type="button"
            class="block w-full cursor-pointer rounded-[4px] border-0 bg-transparent p-0 text-left text-inherit hover:underline focus-visible:shadow-(--focus-ring) focus-visible:outline-none"
            (click)="opened.emit(n)"
          >
            <ng-container *ngTemplateOutlet="sentence" />
          </button>
          <ng-container *ngTemplateOutlet="meta" />
        </div>
        <button hlmBtn qaBtn tone="link" size="sm" type="button" class="{{ actionPlace }} -ml-2.5 sm:ml-0 sm:-mr-2.5" (click)="opened.emit(n)">
          {{ n.action }}
        </button>
      </div>
    }
  `,
})
export class NotificationRow {
  readonly notification = input.required<Notification>();
  /** `panel`: the bell's popover (13 px, no timeline). `page`: the Notifications page (14 px, timeline and action). */
  readonly variant = input<'panel' | 'page'>('panel');
  /** Name of the notification's timeline; shown only by `variant="page"`. The parent resolves it, so the row reads no mock. */
  readonly timelineName = input<string>('');
  readonly opened = output<Notification>();

  protected readonly box = ROW_BOX;
  protected readonly metaBox = ROW_META;
  protected readonly actionPlace = ROW_ACTION_PLACE;
}
