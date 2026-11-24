import { CdkMenuTrigger } from '@angular/cdk/menu';
import { Component, computed, inject, input, model, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { HlmInput } from '@spartan/input';
import { QaMenuImports } from '../../../ui';
import { OvAutofocus, OvScrollTo } from './ov-dom';
import { fmt, timelineInfo } from './overview-calc';
import { Timeline, TimelineStatus } from './overview.mock';

interface TimelineRowVm {
  readonly id: string;
  readonly name: string;
  readonly count: string;
  readonly step: number;
  readonly steps: number;
  readonly when: string;
  readonly date: string;
  readonly status: TimelineStatus;
}

const STATUS_CHIP: Record<TimelineStatus, string> = {
  Live: 'bg-(--st-indigo-bg) text-(--st-indigo-fg)',
  Scheduled: 'bg-(--st-submitted-bg) text-(--st-submitted-fg)',
  Closed: 'bg-(--surface-3) text-(--text-muted)',
};

/** Page-level timeline picker: trigger + popover with search, official / sub-timeline groups. */
@Component({
  selector: 'qa-ov-timeline-menu',
  imports: [QaMenuImports, HlmInput, OvAutofocus, OvScrollTo],
  host: { class: 'relative flex-none max-sm:w-full' },
  template: `
    <button
      type="button"
      [qaMenuTrigger]="panel"
      (qaMenuOpened)="query.set('')"
      (qaMenuClosed)="scrollToSubs.set(false)"
      [attr.aria-labelledby]="labelledBy() + ' overview-timeline-value'"
      class="box-border flex min-h-9 w-full min-w-[260px] cursor-pointer items-center gap-2 rounded-[8px] border border-(--border) bg-(--field-bg) px-3 text-left text-(length:--fs-14) font-semibold text-(--text) hover:border-(--border-strong) focus-visible:shadow-(--focus-ring) focus-visible:outline-none aria-expanded:border-(--border-strong)"
    >
      <span id="overview-timeline-value" class="min-w-0 truncate">{{ selected()?.name ?? 'All timelines' }}</span>
      @if (selected(); as s) {
        <span class="flex-none rounded-full bg-(--surface-3) px-1.5 py-px text-(length:--fs-10) font-semibold text-(--text-muted)">{{ s.kind === 'Official timeline' ? 'Official' : 'Sub' }}</span>
      }
      <svg class="ml-auto flex-none" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"></path></svg>
    </button>

    <ng-template #panel>
      <qa-menu-panel width="340px" density="comfortable" maxHeight="360px" scroll="content">
        <label for="overview-timeline-search" class="sr-only">Search timelines</label>
        <input
          hlmInput
          qaOvAutofocus
          id="overview-timeline-search"
          type="text"
          placeholder="Search timelines"
          [value]="query()"
          (input)="onQuery($event)"
          (keydown)="onSearchKey($event)"
          class="box-border h-8 w-full flex-none rounded-[6px] border border-(--border) bg-(--field-bg) px-[10px] text-(length:--fs-13) text-(--text) shadow-none outline-none focus-visible:border-(--primary) focus-visible:ring-0 md:text-(length:--fs-13)"
        />
        <div class="relative mt-2 flex min-h-0 flex-1 flex-col gap-px overflow-y-auto [scrollbar-width:thin]">
          @if (showAll()) {
            <button
              qaMenuItem
              size="tall"
              (triggered)="value.set('all')"
              [attr.aria-current]="value() === 'all' ? 'true' : null"
              [class]="value() === 'all' ? 'bg-(--tint-2)' : ''"
            >
              <span class="flex min-w-0 flex-1 flex-col gap-[2px]">
                <span class="truncate text-(length:--fs-13) font-medium text-(--text-2)">All timelines</span>
                <span class="text-(length:--fs-12) font-normal text-(--text-4)"><span class="font-(family-name:--qa-mono) font-medium tabular-nums">{{ allCountText() }}</span> results</span>
              </span>
              @if (value() === 'all') {
                <svg class="flex-none" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"></path></svg>
              }
            </button>
          }

          @for (group of groups(); track group.label) {
            <div qaMenuLabel size="tall" [qaOvScrollTo]="group.subs && scrollToSubs()">{{ group.label }}</div>
            @for (row of group.rows; track row.id) {
              <button
                qaMenuItem
                size="tall"
                (triggered)="value.set(row.id)"
                [attr.aria-current]="value() === row.id ? 'true' : null"
                [class]="value() === row.id ? 'bg-(--tint-2)' : ''"
              >
                <span class="flex min-w-0 flex-1 flex-col gap-[2px]">
                  <span class="truncate text-(length:--fs-13) font-medium text-(--text-2)">{{ row.name }}</span>
                  <span class="truncate text-(length:--fs-12) font-normal text-(--text-4)"
                    ><span class="font-(family-name:--qa-mono) font-medium">{{ row.count }}</span> results · step
                    <span class="font-(family-name:--qa-mono) font-medium">{{ row.step }}</span> of
                    <span class="font-(family-name:--qa-mono) font-medium">{{ row.steps }}</span> · {{ row.when }}
                    <span class="font-(family-name:--qa-mono) font-medium">{{ row.date }}</span></span
                  >
                </span>
                <span class="flex-none rounded-full px-2 py-[2px] text-(length:--fs-11) font-semibold whitespace-nowrap" [class]="chipClass(row.status)">{{ row.status }}</span>
                @if (value() === row.id) {
                  <svg class="flex-none" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"></path></svg>
                }
              </button>
            }
          }
          @if (noMatch()) {
            <p class="m-0 p-2 text-(length:--fs-13) text-(--text-3)">Nothing matches that search.</p>
          }
        </div>
        <div class="mt-2 flex-none border-t border-(--surface-4) pt-2">
          <button qaMenuItem variant="link" size="compact" (triggered)="manage()">Manage timelines</button>
        </div>
      </qa-menu-panel>
    </ng-template>
  `,
})
export class OvTimelineMenu {
  private readonly router = inject(Router);
  private readonly trigger = viewChild.required(CdkMenuTrigger);

  /** Selected timeline id, or 'all'. */
  readonly value = model('all');
  readonly timelines = input.required<readonly Timeline[]>();
  readonly allCount = input.required<number>();
  /** Id of the visible "Timeline" label. */
  readonly labelledBy = input.required<string>();

  protected readonly query = signal('');
  protected readonly scrollToSubs = signal(false);

  protected readonly selected = computed(() => this.timelines().find((b) => b.id === this.value()) ?? null);
  protected readonly allCountText = computed(() => fmt(this.allCount()));

  private readonly q = computed(() => this.query().trim().toLowerCase());
  private readonly rows = computed(() =>
    this.timelines()
      .filter((b) => !this.q() || b.name.toLowerCase().includes(this.q()))
      .map((b) => {
        const i = timelineInfo(b);
        const row: TimelineRowVm = { id: b.id, name: b.name, count: fmt(b.results), step: i.step, steps: i.steps, when: i.when, date: i.date, status: b.status };
        return { row, official: b.kind === 'Official timeline' };
      }),
  );
  protected readonly groups = computed(() =>
    [
      { label: 'Official timeline', subs: false, rows: this.rows().filter((r) => r.official).map((r) => r.row) },
      { label: 'Sub-timelines', subs: true, rows: this.rows().filter((r) => !r.official).map((r) => r.row) },
    ].filter((g) => g.rows.length),
  );
  protected readonly showAll = computed(() => !this.q() || 'all timelines'.includes(this.q()));
  protected readonly noMatch = computed(() => !this.showAll() && !this.rows().length);

  /** Opens the popover scrolled to the sub-timelines ("1 sub-timeline is also live"). */
  openAtSubs(): void {
    this.query.set('');
    this.scrollToSubs.set(true);
    this.trigger().open();
  }

  protected chipClass(status: TimelineStatus): string {
    return STATUS_CHIP[status];
  }

  protected onQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  /** Keep typing in the search box; only Esc / arrows / Tab reach the menu's keyboard handling. */
  protected onSearchKey(event: KeyboardEvent): void {
    if (!['Escape', 'ArrowDown', 'ArrowUp', 'Tab'].includes(event.key)) event.stopPropagation();
  }

  protected manage(): void {
    void this.router.navigateByUrl('/cycle');
  }
}
