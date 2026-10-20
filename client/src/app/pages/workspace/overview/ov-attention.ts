import { Component, computed, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { QaButtonImports } from '../../../ui';
import { AttentionGroupKey, AttentionRow } from './overview.mock';

export interface AttentionGroupVm {
  readonly key: AttentionGroupKey;
  readonly name: string;
  /** Rows already filtered and sorted by severity. */
  readonly rows: readonly AttentionRow[];
}

/** Groups show five rows, then "+N more". */
const VISIBLE = 5;

/** "Needs attention": coverage, pace and waiting alerts, each with a way to act on it. */
@Component({
  selector: 'qa-ov-attention',
  imports: [QaButtonImports, RouterLink],
  host: { class: 'block @container' },
  template: `
    <section aria-labelledby="overview-attn-title" class="flex flex-col gap-4 rounded-[12px] border border-(--border) bg-(--surface) p-5">
      <div class="flex flex-col gap-1">
        <div class="flex items-center gap-2">
          <h3 id="overview-attn-title" class="m-0 text-(length:--fs-16) font-bold tracking-[-0.01em] text-(--text)">Needs attention</h3>
          @if (count()) {
            <span class="text-(length:--fs-14) font-semibold tabular-nums text-(--text-muted)" [attr.aria-label]="count() + ' items'">{{ count() }}</span>
          }
        </div>
        <p class="m-0 text-(length:--fs-13) font-normal text-(--text-3)">Issues in this cycle that need someone to act.</p>
      </div>

      @if (count()) {
        <div class="flex flex-col gap-[18px]">
          @for (g of groups(); track g.key) {
            @let shown = isOpen(g.key) ? g.rows : g.rows.slice(0, visible);
            @let more = g.rows.length > visible;
            <div class="flex flex-col">
              <h4 class="m-0 flex min-h-8 items-baseline gap-2 border-b border-(--surface-4) px-[2px] pb-2">
                <!-- Coverage is the only group that keeps a color: results there will not be reviewed at all. -->
                <span class="text-(length:--fs-13) font-semibold" [class]="g.key === 'coverage' ? 'text-(--danger)' : 'text-(--text-2)'">{{ g.name }}</span>
                <span class="text-(length:--fs-12) font-normal tabular-nums text-(--text-muted)">{{ g.rows.length }}</span>
              </h4>
              <ul class="m-0 list-none p-0">
                @for (r of shown; track r.text; let last = $last) {
                  <!-- >= @2xl: text and action on one line. Narrower: text wraps, the action sits under it, left aligned. -->
                  <li
                    class="grid min-h-12 grid-cols-1 items-center gap-1 border-(--surface-4) px-[2px] py-2 @2xl:grid-cols-[minmax(0,1fr)_150px] @2xl:gap-4 @2xl:py-0"
                    [class.border-b]="!last || more"
                  >
                    <span [title]="r.text" class="min-w-0 text-(length:--fs-13) leading-[1.5] font-normal text-pretty text-(--text-2) @2xl:truncate"
                      >@for (seg of r.segs; track $index) {<span [class]="seg[1] ? 'font-semibold whitespace-nowrap text-(--text)' : ''">{{ seg[0] }}</span>}</span
                    >
                    @switch (r.to.kind) {
                      @case ('route') {
                        <a hlmBtn qaBtn tone="link" size="sm" [routerLink]="routePath(r)" class="-ml-2.5 justify-self-start @2xl:-mr-2.5 @2xl:ml-0 @2xl:justify-self-end">{{ r.label }}</a>
                      }
                      @case ('status') {
                        <a hlmBtn qaBtn tone="link" size="sm" routerLink="/results" [queryParams]="{ status: statuses(r) }" class="-ml-2.5 justify-self-start @2xl:-mr-2.5 @2xl:ml-0 @2xl:justify-self-end">{{ r.label }}</a>
                      }
                      @case ('risk') {
                        <button hlmBtn qaBtn tone="link" size="sm" type="button" (click)="risk.emit(riskKey(r))" class="-ml-2.5 justify-self-start @2xl:-mr-2.5 @2xl:ml-0 @2xl:justify-self-end">{{ r.label }}</button>
                      }
                    }
                  </li>
                }
              </ul>
              @if (more) {
                <div class="flex min-h-10 items-center px-[2px]">
                  <button hlmBtn qaBtn tone="link" size="sm" flush="start" type="button" (click)="toggle(g.key)" [attr.aria-expanded]="isOpen(g.key)">{{ isOpen(g.key) ? 'Show less' : '+' + (g.rows.length - visible) + ' more' }}</button>
                </div>
              }
            </div>
          }
        </div>
      } @else {
        <div class="flex items-center gap-2">
          <svg class="flex-none" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"></path></svg>
          <span class="text-(length:--fs-14) font-normal whitespace-nowrap text-(--text-3)">Nothing needs attention.</span>
        </div>
      }
    </section>
  `,
})
export class OvAttention {
  readonly groups = input.required<readonly AttentionGroupVm[]>();
  /** "See SP09"…: key of the row to show in Where the work is ("program:SP09"). */
  readonly risk = output<string>();

  protected readonly visible = VISIBLE;
  private readonly expanded = signal<ReadonlySet<AttentionGroupKey>>(new Set());

  protected readonly count = computed(() => this.groups().reduce((a, g) => a + g.rows.length, 0));

  protected isOpen(key: AttentionGroupKey): boolean {
    return this.expanded().has(key);
  }

  protected toggle(key: AttentionGroupKey): void {
    this.expanded.update((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  protected routePath(r: AttentionRow): string {
    return r.to.kind === 'route' ? r.to.path : '/';
  }

  protected statuses(r: AttentionRow): readonly string[] {
    return r.to.kind === 'status' ? r.to.statuses : [];
  }

  protected riskKey(r: AttentionRow): string {
    return r.to.kind === 'risk' ? r.to.key : '';
  }
}
