import { Component, computed, linkedSignal, signal } from '@angular/core';
import { QaBadge, QaBadgeStatus, QaButtonImports, QaMultiSelect, QaMultiSelectOption, QaPagination, QaSelect, QaSelectOption } from '../../../ui';
import { ACTIVITY_LOG, LOG_TODAY, LOG_TYPES, LogEntry, LogType } from './activity-log.mock';

const DAY = 86_400_000;

const DATE_OPTIONS: readonly QaSelectOption[] = [
  { value: 'any', label: 'Any time' },
  { value: 'today', label: 'Today' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
];

const TYPE_BADGE: Readonly<Record<LogType, QaBadgeStatus>> = { timelines: 'indigo', fields: 'qa', users: 'neutral' };

/** Columns of the wide table; the narrow one stacks each row as a card. */
const GRID = '@min-[760px]:grid-cols-[9rem_10rem_minmax(0,1fr)_minmax(0,1.15fr)] @min-[760px]:gap-x-5';

/**
 * P2-3915, Traceability (AC 7–8): every change to timelines, field configuration and users, with who, when, and
 * the value before and after. QA admins only, read only. Filters follow the Results bar (menus, chips, Clear all).
 * Design only, sample data (`activity-log.mock.ts`).
 */
@Component({
  selector: 'qa-activity-log-view',
  imports: [QaBadge, QaButtonImports, QaMultiSelect, QaPagination, QaSelect],
  host: { class: 'block' },
  template: `
    <div class="flex flex-col gap-1 px-4 pt-6 sm:px-6 sm:pt-8 lg:px-8">
      <h1 class="m-0 text-balance text-(length:--fs-26) leading-[1.2] font-bold tracking-[-0.02em] text-(--text)">Activity log</h1>
      <p class="m-0 text-pretty text-(length:--fs-14) text-(--text-3)">Every change to timelines, field configuration and users. Nobody can edit or delete it.</p>
    </div>

    <div class="flex flex-col items-stretch gap-5 px-4 pt-5 pb-8 sm:px-6 lg:px-8">
      <div class="flex flex-col gap-3">
        <div class="flex flex-wrap items-center gap-2 lg:gap-3">
          <qa-multi-select [(value)]="types" [options]="typeOptions" label="Type of change" [searchable]="false" panelWidth="260px" listMaxHeight="none" />
          <qa-multi-select [(value)]="people" [options]="peopleOptions" label="Changed by" searchPlaceholder="Search people" emptyText="Nobody matches that search." panelWidth="280px" />
          <qa-select [value]="date()" (valueChange)="setDate($event)" [options]="dateOptions" label="Date" appearance="filter" indicator="radio" panelWidth="220px" />
        </div>

        @if (applied().length) {
          <div class="flex flex-wrap items-center gap-2">
            @for (f of applied(); track f.key) {
              <span class="inline-flex h-7 max-w-[min(380px,100%)] items-center gap-1.5 rounded-full bg-(--tint) pr-1.5 pl-2.5 text-(length:--fs-12) font-medium text-(--accent)">
                <span class="flex-none font-semibold">{{ f.label }}</span>
                <span class="min-w-0 truncate">{{ f.values }}</span>
                <button type="button" (click)="clearFilter(f.key)" [attr.aria-label]="'Remove ' + f.label + ' filter'" class="flex size-[18px] flex-none items-center justify-center rounded-full p-0 text-(--accent) outline-none hover:bg-(--tint-3) focus-visible:shadow-(--focus-ring)">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" /></svg>
                </button>
              </span>
            }
            <button hlmBtn qaBtn tone="link" size="sm" type="button" (click)="clearAll()">Clear all</button>
          </div>
        }
      </div>

      <p class="m-0 text-(length:--fs-13) text-(--text-3)" role="status">
        <b class="font-semibold tabular-nums text-(--text-2)">{{ rows().length }}</b> {{ rows().length === 1 ? 'change' : 'changes' }}, newest first
      </p>

      @if (rows().length) {
        <div class="@container rounded-[12px] border border-(--border) bg-(--surface)">
          <table class="block w-full">
            <caption class="sr-only">Configuration changes</caption>
            <thead class="hidden @min-[760px]:block">
              <tr class="grid h-10 items-center rounded-t-[11px] border-b border-(--border) bg-(--surface-3) px-5" [class]="grid">
                @for (h of headers; track h) {
                  <th scope="col" class="min-w-0 p-0 text-left text-(length:--fs-11) font-semibold tracking-[0.06em] whitespace-nowrap text-(--text-muted) uppercase">{{ h }}</th>
                }
              </tr>
            </thead>
            <tbody class="block">
              @for (r of pageRows(); track r.id; let last = $last) {
                <tr class="grid grid-cols-1 gap-y-2 border-(--surface-4) px-4 py-3.5 @min-[760px]:items-start @min-[760px]:px-5" [class]="grid + (last ? '' : ' border-b')">
                  <td class="text-(length:--fs-13) text-(--text-2) tabular-nums @max-[759px]:hidden">
                    <time [attr.datetime]="r.at">{{ r.when }}</time>
                  </td>
                  <td class="flex min-w-0 flex-col @max-[759px]:hidden">
                    <span class="truncate text-(length:--fs-13) font-medium text-(--text)">{{ r.by.name }}</span>
                    <span class="truncate text-(length:--fs-12) text-(--text-3)">{{ r.by.nickname }}</span>
                  </td>
                  <td class="flex min-w-0 flex-col gap-1">
                    <span class="flex flex-wrap items-center gap-2">
                      <qa-badge [status]="badge(r.type)" size="sm">{{ typeLabel(r.type) }}</qa-badge>
                      <span class="text-(length:--fs-12) text-(--text-3)">{{ r.property }}</span>
                    </span>
                    <span class="text-(length:--fs-13) leading-[1.45] font-semibold text-pretty wrap-anywhere text-(--text)">{{ r.target }}</span>
                    <!-- Narrow: who and when under the change. -->
                    <span class="text-(length:--fs-12) text-(--text-3) @min-[760px]:hidden">
                      {{ r.by.name }} ({{ r.by.nickname }}) · <time [attr.datetime]="r.at">{{ r.when }}</time>
                    </span>
                  </td>
                  <td class="min-w-0">
                    <dl class="m-0 flex flex-col gap-1 rounded-[8px] bg-(--surface-3) px-3 py-2 text-(length:--fs-13) leading-[1.45]">
                      <div class="flex min-w-0 gap-2">
                        <dt class="w-12 flex-none text-(length:--fs-12) text-(--text-3)">Before</dt>
                        <dd class="m-0 min-w-0 wrap-anywhere" [class]="r.before === null ? 'text-(--text-3) italic' : 'text-(--text-2)'">{{ r.before ?? 'Not set' }}</dd>
                      </div>
                      <div class="flex min-w-0 gap-2">
                        <dt class="w-12 flex-none text-(length:--fs-12) text-(--text-3)">After</dt>
                        <dd class="m-0 min-w-0 font-medium wrap-anywhere" [class]="r.after === null ? 'text-(--danger)' : 'text-(--text)'">{{ r.after ?? 'Removed' }}</dd>
                      </div>
                    </dl>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <qa-pagination [(page)]="page" [(pageSize)]="pageSize" [total]="rows().length" />
      } @else {
        <div class="flex flex-col items-start gap-2">
          <p class="m-0 text-(length:--fs-14) text-(--text-3)">No changes match these filters.</p>
          <button hlmBtn qaBtn tone="secondary" size="sm" type="button" (click)="clearAll()">Clear filters</button>
        </div>
      }
    </div>
  `,
})
export class ActivityLogView {
  protected readonly grid = GRID;
  protected readonly headers = ['When', 'Changed by', 'What changed', 'Before and after'] as const;

  protected readonly types = signal<readonly string[]>([]);
  protected readonly people = signal<readonly string[]>([]);
  /** null = any time, so the Date menu shows no count until a range is picked. */
  protected readonly date = signal<string | null>(null);

  protected readonly typeOptions: readonly QaMultiSelectOption[] = LOG_TYPES.map((t) => ({
    value: t.value,
    label: t.label,
    count: ACTIVITY_LOG.filter((e) => e.type === t.value).length,
  }));

  protected readonly peopleOptions: readonly QaMultiSelectOption[] = [...new Map(ACTIVITY_LOG.map((e) => [e.by.nickname, e.by.name])).entries()].map(
    ([nickname, name]) => ({ value: nickname, label: `${name} (${nickname})`, count: ACTIVITY_LOG.filter((e) => e.by.nickname === nickname).length }),
  );

  protected readonly dateOptions = DATE_OPTIONS;

  protected readonly rows = computed(() => {
    const types = this.types();
    const people = this.people();
    const date = this.date() ?? 'any';
    return ACTIVITY_LOG.filter((e) => (!types.length || types.includes(e.type)) && (!people.length || people.includes(e.by.nickname)) && inDate(e, date));
  });

  protected readonly pageSize = signal(25);
  /** Back to page 1 whenever the filters change the list. */
  protected readonly page = linkedSignal({ source: this.rows, computation: () => 1 });
  protected readonly pageRows = computed(() => {
    const size = this.pageSize();
    const start = (this.page() - 1) * size;
    return this.rows().slice(start, start + size);
  });

  /** The chips under the menus, as in Results. */
  protected readonly applied = computed(() => {
    const out: { key: 'types' | 'people' | 'date'; label: string; values: string }[] = [];
    if (this.types().length) out.push({ key: 'types', label: 'Type:', values: this.types().map((v) => this.typeLabel(v as LogType)).join(', ') });
    if (this.people().length) {
      const names = this.people().map((n) => ACTIVITY_LOG.find((e) => e.by.nickname === n)?.by.name ?? n);
      out.push({ key: 'people', label: 'Changed by:', values: names.join(', ') });
    }
    const date = this.date();
    if (date && date !== 'any') out.push({ key: 'date', label: 'Date:', values: DATE_OPTIONS.find((o) => o.value === date)?.label ?? date });
    return out;
  });

  protected setDate(value: string | null): void {
    this.date.set(value === 'any' ? null : value);
  }

  protected clearFilter(key: 'types' | 'people' | 'date'): void {
    if (key === 'types') this.types.set([]);
    if (key === 'people') this.people.set([]);
    if (key === 'date') this.date.set(null);
  }

  protected clearAll(): void {
    this.types.set([]);
    this.people.set([]);
    this.date.set(null);
  }

  protected typeLabel(type: LogType): string {
    return LOG_TYPES.find((t) => t.value === type)?.label ?? type;
  }

  protected badge(type: LogType): QaBadgeStatus {
    return TYPE_BADGE[type];
  }
}

/** Against the sample's fixed "today" (`LOG_TODAY`), so the preview never depends on the real clock. */
function inDate(e: LogEntry, date: string): boolean {
  if (date === 'any') return true;
  if (date === 'today') return e.at.startsWith(LOG_TODAY);
  const end = Date.parse(`${LOG_TODAY}T23:59:59`);
  return end - Date.parse(e.at) < Number(date) * DAY;
}
