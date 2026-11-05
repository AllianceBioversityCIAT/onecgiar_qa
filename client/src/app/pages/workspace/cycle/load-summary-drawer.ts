import { Component, computed, input, model } from '@angular/core';
import { QaButtonImports, QaDrawerImports, QaLoadingImports } from '../../../ui';
import { FinishedLoad } from './cycle-loads';
import { formatNumber } from './cycle.logic';
import { LoadDrawerNames } from './load-drawer';
import { failureLabel, skipLabel } from './load.copy';

/** What a load did when it ended: loaded (by program and type), skipped with reason, auto-validated KPs. */
@Component({
  selector: 'qa-cycle-load-summary-drawer',
  imports: [QaButtonImports, QaDrawerImports, QaLoadingImports],
  template: `
    <qa-drawer [(open)]="open" [title]="title()" [subtitle]="subtitle()" width="720px">
      @if (open() && load(); as l) {
        @let s = l.detail.summary;
        @if (l.detail.status === 'failed') {
          <p role="alert" class="m-0 rounded-[8px] bg-(--st-editing-bg) px-[14px] py-3 text-(length:--fs-13) leading-[1.55] text-(--st-editing-fg)">{{ failure(l.detail.failureReason) }}</p>
        }
        <div class="grid gap-3 max-sm:grid-cols-1" [class]="totals().length === 3 ? 'grid-cols-3' : 'grid-cols-2'">
          @for (n of totals(); track n.label) {
            <div [qaReveal]="$index" class="flex flex-col gap-1 rounded-[8px] bg-(--surface-3) px-[14px] py-3">
              <span class="font-(family-name:--qa-mono) text-(length:--fs-26) font-bold text-(--text) tabular-nums">{{ fmt(n.value) }}</span>
              <span class="text-(length:--fs-13) text-(--text-3)">{{ n.label }}</span>
            </div>
          }
        </div>
        @if (s.byProgram.length) {
          <div class="grid gap-6 sm:grid-cols-2">
            <div>
              <h3 class="m-0 mb-1 text-(length:--fs-11) font-semibold tracking-[0.08em] text-(--text-muted) uppercase">Loaded by science program</h3>
              <ul class="m-0 flex list-none flex-col p-0">
                @for (row of s.byProgram; track row.programId) {
                  <li [qaReveal]="$index" class="flex min-h-9 items-center justify-between gap-3 border-b border-(--surface-4)">
                    <span class="min-w-0 truncate text-(length:--fs-13) text-(--text)">{{ names().program(row.programId, row.code) }}</span>
                    <span class="font-(family-name:--qa-mono) text-(length:--fs-13) font-semibold text-(--text) tabular-nums">{{ fmt(row.count) }}</span>
                  </li>
                }
              </ul>
            </div>
            <div>
              <h3 class="m-0 mb-1 text-(length:--fs-11) font-semibold tracking-[0.08em] text-(--text-muted) uppercase">Loaded by result type</h3>
              <ul class="m-0 flex list-none flex-col p-0">
                @for (row of s.byResultType; track row.key) {
                  <li [qaReveal]="$index" class="flex min-h-9 items-center justify-between gap-3 border-b border-(--surface-4)">
                    <span class="min-w-0 truncate text-(length:--fs-13) text-(--text)">{{ names().type(row.key) }}</span>
                    <span class="font-(family-name:--qa-mono) text-(length:--fs-13) font-semibold text-(--text) tabular-nums">{{ fmt(row.count) }}</span>
                  </li>
                }
              </ul>
            </div>
          </div>
        }
        @if (s.skipped.length) {
          <div>
            <h3 class="m-0 mb-1 text-(length:--fs-11) font-semibold tracking-[0.08em] text-(--text-muted) uppercase">Skipped</h3>
            <ul class="m-0 flex list-none flex-col p-0">
              @for (row of s.skipped; track row.reason) {
                <li class="flex min-h-9 items-center justify-between gap-3 border-b border-(--surface-4)">
                  <span class="min-w-0 text-(length:--fs-13) text-(--text-2)">{{ skip(row.reason) }}</span>
                  <span class="font-(family-name:--qa-mono) text-(length:--fs-13) font-semibold text-(--text-2) tabular-nums">{{ fmt(row.count) }}</span>
                </li>
              }
            </ul>
          </div>
        }
      }
      <div qaDrawerFooter class="contents">
        <button hlmBtn qaBtn tone="primary" type="button" (click)="open.set(false)">Done</button>
      </div>
    </qa-drawer>
  `,
})
export class LoadSummaryDrawer {
  readonly open = model(false);
  readonly load = input<FinishedLoad | null>(null);
  readonly names = input.required<LoadDrawerNames>();

  protected readonly fmt = formatNumber;
  protected readonly skip = skipLabel;
  protected readonly failure = failureLabel;

  protected readonly title = computed(() => (this.load()?.detail.status === 'failed' ? 'The load stopped' : 'Results loaded'));
  protected readonly subtitle = computed(() => (this.load() ? `${this.load()!.timelineName} · step 1` : ''));
  protected readonly totals = computed(() => {
    const s = this.load()?.detail.summary;
    if (!s) return [];
    const skipped = s.skipped.reduce((n, r) => n + r.count, 0);
    const totals = [
      { label: 'loaded into step 1', value: s.loaded },
      { label: 'skipped', value: skipped },
    ];
    // Knowledge products are released as QAed only when the load completes (contract § 6).
    if (this.load()?.detail.status === 'completed') {
      totals.push({ label: 'knowledge products auto-validated', value: s.kpGroups.autoChecked + s.kpGroups.notInQa });
    }
    return totals;
  });
}
