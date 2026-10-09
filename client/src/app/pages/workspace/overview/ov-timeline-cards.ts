import { Component, computed, input, model } from '@angular/core';
import { fmt, timelineInfo } from './overview-calc';
import { Timeline, TimelineStatus } from './overview.mock';

interface TimelineCardVm {
  readonly id: string;
  readonly eyebrow: string;
  readonly name: string | null;
  readonly count: string;
  readonly status: TimelineStatus | null;
  readonly line: string;
}

const STATUS_CHIP: Record<TimelineStatus, string> = {
  Live: 'bg-(--st-indigo-bg) text-(--st-indigo-fg)',
  Scheduled: 'bg-(--st-submitted-bg) text-(--st-submitted-fg)',
  Closed: 'bg-(--surface-3) text-(--text-muted)',
};

/** Page-level timeline picker as cards: "All timelines", then the official timeline and the sub-timelines. */
@Component({
  selector: 'qa-ov-timeline-cards',
  host: { class: 'block @container' },
  template: `
    <div role="group" aria-label="Timeline" class="grid grid-cols-1 gap-3 @xs:grid-cols-2 @3xl:grid-cols-4">
      @for (card of cards(); track card.id) {
        @let on = value() === card.id;
        <button
          type="button"
          (click)="value.set(card.id)"
          [attr.aria-pressed]="on"
          class="flex min-w-0 cursor-pointer flex-col gap-[6px] rounded-[12px] border px-3 py-3 @3xl:px-4 @3xl:py-[14px] text-left focus-visible:shadow-(--focus-ring) focus-visible:outline-none"
          [class]="on ? 'border-(--primary) bg-(--tint-2)' : 'border-(--border) bg-(--surface) hover:border-(--border-strong)'"
        >
          <span class="text-(length:--fs-11) font-semibold tracking-[0.08em] uppercase" [class]="on ? 'text-(--accent)' : 'text-(--text-muted)'">{{ card.eyebrow }}</span>
          @if (card.name) {
            <span class="truncate text-(length:--fs-14) font-semibold text-(--text)">{{ card.name }}</span>
          }
          <span class="font-(family-name:--qa-mono) text-(length:--fs-26) leading-[1.1] font-bold tabular-nums text-(--text)">{{ card.count }}</span>
          <span class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-(length:--fs-12) font-normal text-(--text-4)">
            @if (card.status) {
              <span class="flex-none rounded-full px-2 py-[2px] text-(length:--fs-11) font-semibold whitespace-nowrap" [class]="chip[card.status]">{{ card.status }}</span>
            }
            <span>{{ card.line }}</span>
          </span>
        </button>
      }
    </div>
  `,
})
export class OvTimelineCards {
  /** Selected timeline id, or 'all'. */
  readonly value = model('all');
  readonly timelines = input.required<readonly Timeline[]>();
  readonly allCount = input.required<number>();

  protected readonly chip = STATUS_CHIP;

  protected readonly cards = computed<TimelineCardVm[]>(() => {
    const list = this.timelines();
    const live = list.filter((b) => b.status === 'Live').length;
    const sched = list.filter((b) => b.status === 'Scheduled').length;
    const all: TimelineCardVm = {
      id: 'all',
      eyebrow: 'All timelines',
      name: null,
      count: fmt(this.allCount()),
      status: null,
      line: [live ? live + ' live' : '', sched ? sched + ' scheduled' : ''].filter(Boolean).join(' · '),
    };
    const ordered = [...list].sort((a, b) => Number(a.kind !== 'Official timeline') - Number(b.kind !== 'Official timeline'));
    return [
      all,
      ...ordered.map((b) => {
        const i = timelineInfo(b);
        return {
          id: b.id,
          eyebrow: b.kind === 'Official timeline' ? 'Official timeline' : 'Sub-timeline',
          name: b.name,
          count: fmt(b.results),
          status: b.status,
          line: `Step ${i.step} of ${i.steps} · ${i.when} ${i.date}`,
        };
      }),
    ];
  });
}
