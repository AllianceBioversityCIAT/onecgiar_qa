import { Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { QaMenuImports } from '../../../ui';
import { PreviousOutcome, ResultStatus } from './results.mock';

export type SortKey = 'code' | 'title' | 'type' | 'comments' | 'r1' | 'status';
export type SortDir = 'asc' | 'desc';

export interface ResultRowVm {
  readonly code: string;
  readonly title: string;
  /** Second line under the title: "SP02 · M. Chen". */
  readonly meta: string;
  readonly type: string;
  readonly comments: readonly [number, number] | null;
  /** Comments not published to the program yet. */
  readonly locked: boolean;
  readonly r1: PreviousOutcome;
  readonly r1Class: string;
  readonly status: ResultStatus;
  readonly statusClass: string;
  readonly isAuto: boolean;
}

interface Column {
  readonly key: SortKey;
  readonly label: string;
  readonly right: boolean;
}

const COLUMNS: readonly Column[] = [
  { key: 'code', label: 'Code', right: false },
  { key: 'title', label: 'Title', right: false },
  { key: 'type', label: 'Result type', right: false },
  { key: 'comments', label: 'Comments', right: true },
  { key: 'r1', label: 'Previous outcome', right: false },
  { key: 'status', label: 'Status', right: true },
];

/** Results table: sortable headers, rows that open the review page, and a ⋯ menu per row. */
@Component({
  selector: 'qa-results-table',
  imports: [RouterLink, QaMenuImports],
  host: { class: 'block overflow-x-auto rounded-xl border border-(--border) bg-(--surface)' },
  template: `
    <table class="block w-full min-w-[994px]">
      <thead class="block">
        <tr class="grid grid-cols-[96px_minmax(180px,1fr)_200px_84px_150px_140px_32px] items-center gap-3 px-5 h-10 rounded-t-[11px] border-b border-(--border) bg-(--surface-3)">
          @for (col of columns; track col.key) {
            @let active = sortKey() === col.key;
            <th scope="col" class="min-w-0 p-0 font-normal" [attr.aria-sort]="active ? (sortDir() === 'asc' ? 'ascending' : 'descending') : null">
              <button
                type="button"
                (click)="sort.emit(col.key)"
                class="flex h-10 w-full min-w-0 items-center gap-1 p-0 text-(length:--fs-11) font-semibold tracking-[0.06em] whitespace-nowrap uppercase hover:text-(--text-2) outline-none focus-visible:shadow-(--focus-ring)"
                [class]="(col.right ? 'justify-end' : 'justify-start') + (active ? ' text-(--text-2)' : ' text-(--text-muted)')"
              >
                <span>{{ col.label }}</span>
                @if (active && sortDir() === 'asc') {
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
                }
                @if (active && sortDir() === 'desc') {
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M19 12l-7 7-7-7" /></svg>
                }
              </button>
            </th>
          }
          <th scope="col" class="p-0"><span class="sr-only">Actions</span></th>
        </tr>
      </thead>
      <tbody class="block">
        @for (r of rows(); track r.code; let last = $last) {
          <tr
            class="relative grid grid-cols-[96px_minmax(180px,1fr)_200px_84px_150px_140px_32px] items-center gap-3 px-5 min-h-[72px] border-b border-(--surface-4) bg-(--surface) py-2 hover:bg-(--surface-2)"
            [class]="last ? 'rounded-b-[11px]' : ''"
          >
            <td class="flex items-center self-stretch">
              <a
                [routerLink]="['/results', r.code]"
                class="font-(family-name:--qa-mono) tabular-nums text-(length:--fs-13) font-semibold whitespace-nowrap text-(--accent) outline-none after:absolute after:inset-0 focus-visible:after:inset-ring-2 focus-visible:after:inset-ring-(--primary)"
                [class]="last ? 'after:rounded-b-[11px]' : ''"
              >{{ r.code }}</a>
            </td>
            <td class="flex min-w-0 flex-col justify-center gap-0.5 self-stretch">
              <span [title]="r.title" class="min-w-0 truncate text-(length:--fs-14) text-(--text)">{{ r.title }}</span>
              <span [title]="r.meta" class="min-w-0 truncate text-(length:--fs-12) text-(--text-4)">{{ r.meta }}</span>
            </td>
            <td class="min-w-0 truncate text-(length:--fs-13) text-(--text-3)">{{ r.type }}</td>
            <td class="flex items-center justify-end gap-[5px] font-(family-name:--qa-mono) tabular-nums text-(length:--fs-13) whitespace-nowrap">
              @if (r.comments; as c) {
                <span><span class="font-semibold text-(--text)">{{ c[0] }}</span><span class="text-(--text-4)"> / {{ c[1] }}</span></span>
              } @else {
                <span class="text-(--text-muted)">–</span>
              }
              @if (r.locked) {
                <span title="Not published to the program yet" class="inline-flex"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="flex-none"><path d="M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4" /></svg><span class="sr-only">Not published to the program yet</span></span>
              }
            </td>
            <td class="flex min-w-0">
              @if (r.r1 === 'new') {
                <span class="rounded-full bg-(--tint-2) px-2 py-0.5 text-(length:--fs-11) font-semibold whitespace-nowrap text-(--accent)">First assessment</span>
              } @else if (r.r1) {
                <span class="inline-flex items-center gap-[5px] rounded-full px-[10px] py-[3px] text-(length:--fs-11) font-semibold whitespace-nowrap" [class]="r.r1Class">{{ r.r1 }}</span>
              }
            </td>
            <td class="flex justify-self-end">
              <span class="inline-flex items-center gap-[5px] rounded-full px-[10px] py-[3px] text-(length:--fs-11) font-semibold whitespace-nowrap" [class]="r.statusClass">
                @if (r.isAuto) {
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="flex-none"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>
                }
                {{ r.status }}
              </span>
            </td>
            <td class="relative z-10 justify-self-end">
              <button
                type="button"
                [qaMenuTrigger]="rowMenu"
                [qaMenuTriggerData]="{ $implicit: r }"
                qaMenuAlign="end"
                [attr.aria-label]="'More actions for ' + r.code"
                class="flex size-6 items-center justify-center rounded-md text-(--text-3) hover:text-(--primary) outline-none focus-visible:shadow-(--focus-ring)"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm7 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm7 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z" /></svg>
              </button>
            </td>
          </tr>
        }
      </tbody>
    </table>

    <ng-template #rowMenu let-r>
      <qa-menu-panel width="220px" [attr.aria-label]="'Actions for ' + r.code">
        <button qaMenuItem (triggered)="exportComments.emit(r.code)">Export comments</button>
        @if (!r.isAuto) {
          <button qaMenuItem (triggered)="reassign.emit(r.code)">Reassign assessor</button>
        }
      </qa-menu-panel>
    </ng-template>
  `,
})
export class ResultsTable {
  readonly rows = input.required<readonly ResultRowVm[]>();
  readonly sortKey = input<SortKey | null>(null);
  readonly sortDir = input<SortDir>('asc');

  readonly sort = output<SortKey>();
  readonly exportComments = output<string>();
  readonly reassign = output<string>();

  protected readonly columns = COLUMNS;
}
