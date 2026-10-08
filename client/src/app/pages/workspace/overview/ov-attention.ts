import { Component, computed, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HlmButton } from '@spartan/button';
import { AttentionGroupKey, AttentionRow } from './overview.mock';

export interface AttentionGroupVm {
  readonly key: AttentionGroupKey;
  readonly name: string;
  /** Rows already filtered and sorted by severity. */
  readonly rows: readonly AttentionRow[];
}

const GROUP_STYLE: Record<AttentionGroupKey, { color: string; icon: string }> = {
  coverage: { color: 'text-(--danger)', icon: 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01' },
  pace: { color: 'text-(--warning)', icon: 'M12 14l4-4M3.34 19a10 10 0 1 1 17.32 0' },
  waiting: { color: 'text-(--text-4)', icon: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2' },
};

/** Groups show five rows, then "+N more". */
const VISIBLE = 5;

/** "Needs attention": coverage, pace and waiting alerts, each with a way to act on it. */
@Component({
  selector: 'qa-ov-attention',
  imports: [HlmButton, RouterLink],
  host: { class: 'block @container' },
  template: `
    <section aria-labelledby="overview-attn-title" class="flex flex-col gap-4 rounded-[12px] border border-(--border) bg-(--surface) p-5">
      <div class="flex flex-col gap-1">
        <div class="flex items-center gap-2">
          <h3 id="overview-attn-title" class="m-0 text-(length:--fs-16) font-bold tracking-[-0.01em] text-(--text)">Needs attention</h3>
          @if (count()) {
            <span
              class="box-border flex h-5 min-w-5 items-center justify-center rounded-full px-[7px] font-(family-name:--qa-mono) text-(length:--fs-12) font-bold tabular-nums"
              [class]="critical() ? 'bg-(--st-rejected-bg) text-(--st-rejected-fg)' : 'bg-(--st-editing-bg) text-(--st-editing-fg)'"
              [attr.aria-label]="count() + ' items'"
            >{{ count() }}</span>
          }
        </div>
        <p class="m-0 text-(length:--fs-13) font-normal text-(--text-3)">Everything that will not resolve on its own.</p>
      </div>

      @if (count()) {
        <div class="flex flex-col gap-[18px]">
          @for (g of groups(); track g.key) {
            @let shown = isOpen(g.key) ? g.rows : g.rows.slice(0, visible);
            @let more = g.rows.length > visible;
            <div class="flex flex-col">
              <h4 class="m-0 flex min-h-8 items-center gap-2 border-b border-(--surface-4) px-[2px] pb-2" [class]="style[g.key].color">
                <svg class="flex-none" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path [attr.d]="style[g.key].icon"></path></svg>
                <span class="text-(length:--fs-12) font-semibold tracking-[0.06em] uppercase">{{ g.name }}</span>
                <span class="ml-auto font-(family-name:--qa-mono) text-(length:--fs-12) font-semibold tabular-nums text-(--text-muted)">{{ g.rows.length }}</span>
              </h4>
              <ul class="m-0 list-none p-0">
                @for (r of shown; track r.text; let last = $last) {
                  <!-- >= @2xl: text and action on one line. Narrower: text wraps, the action sits under it, left aligned. -->
                  <li
                    class="grid min-h-12 grid-cols-1 items-center gap-1 border-(--surface-4) px-[2px] py-2 hover:bg-(--surface-2) @2xl:grid-cols-[minmax(0,1fr)_150px] @2xl:gap-4 @2xl:py-0"
                    [class.border-b]="!last || more"
                  >
                    <span [title]="r.text" class="min-w-0 text-(length:--fs-13) leading-[1.5] font-normal text-pretty text-(--text-2) @2xl:truncate"
                      >@for (seg of r.segs; track $index) {<span [class]="seg[1] ? 'font-(family-name:--qa-mono) font-semibold whitespace-nowrap text-(--text)' : ''">{{ seg[0] }}</span>}</span
                    >
                    @switch (r.to.kind) {
                      @case ('route') {
                        <a hlmBtn variant="ghost" [routerLink]="routePath(r)" class="h-auto min-h-[30px] -ml-[10px] justify-self-start rounded-[8px] @max-2xl:min-h-10 @2xl:ml-0 @2xl:justify-self-end border-0 px-[10px] text-(length:--fs-13) font-semibold whitespace-nowrap text-(--accent) no-underline hover:bg-(--surface-3) hover:text-(--accent) focus-visible:shadow-(--focus-ring) focus-visible:ring-0">{{ r.label }}</a>
                      }
                      @case ('status') {
                        <a hlmBtn variant="ghost" routerLink="/results" [queryParams]="{ status: statuses(r) }" class="h-auto min-h-[30px] -ml-[10px] justify-self-start rounded-[8px] @max-2xl:min-h-10 @2xl:ml-0 @2xl:justify-self-end border-0 px-[10px] text-(length:--fs-13) font-semibold whitespace-nowrap text-(--accent) no-underline hover:bg-(--surface-3) hover:text-(--accent) focus-visible:shadow-(--focus-ring) focus-visible:ring-0">{{ r.label }}</a>
                      }
                      @case ('risk') {
                        <button hlmBtn variant="ghost" type="button" (click)="risk.emit(riskKey(r))" class="h-auto min-h-[30px] -ml-[10px] justify-self-start rounded-[8px] @max-2xl:min-h-10 @2xl:ml-0 @2xl:justify-self-end border-0 px-[10px] text-(length:--fs-13) font-semibold whitespace-nowrap text-(--accent) no-underline hover:bg-(--surface-3) hover:text-(--accent) focus-visible:shadow-(--focus-ring) focus-visible:ring-0">{{ r.label }}</button>
                      }
                    }
                  </li>
                }
              </ul>
              @if (more) {
                <div class="flex min-h-10 items-center px-[2px]">
                  <button
                    type="button"
                    (click)="toggle(g.key)"
                    [attr.aria-expanded]="isOpen(g.key)"
                    class="-ml-[10px] min-h-[30px] cursor-pointer rounded-[8px] border-0 bg-transparent px-[10px] text-(length:--fs-13) font-medium text-(--accent) hover:bg-(--tint) focus-visible:shadow-(--focus-ring) focus-visible:outline-none"
                  >{{ isOpen(g.key) ? 'Show less' : '+' + (g.rows.length - visible) + ' more' }}</button>
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

  protected readonly style = GROUP_STYLE;
  protected readonly visible = VISIBLE;
  private readonly expanded = signal<ReadonlySet<AttentionGroupKey>>(new Set());

  protected readonly count = computed(() => this.groups().reduce((a, g) => a + g.rows.length, 0));
  protected readonly critical = computed(() => this.groups().some((g) => g.key === 'coverage'));

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
