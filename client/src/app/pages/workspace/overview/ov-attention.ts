import { Component, computed, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { QaButtonImports } from '../../../ui';
import { AttentionGroupKey, AttentionRow } from './overview.mock';

export interface AttentionRowVm extends AttentionRow {
  /** Days until the stage closes (0 = today). */
  readonly days: number;
  /** "21 Jul". */
  readonly closesOn: string;
}

export interface AttentionGroupVm {
  readonly key: AttentionGroupKey;
  readonly name: string;
  /** Rows already filtered and sorted by deadline. */
  readonly rows: readonly AttentionRowVm[];
}

/** Groups show five rows, then "+N more". */
const VISIBLE = 5;

/**
 * "Needs your attention": what the admin can fix in QA before a stage closes.
 * Each row says what is wrong, where (timeline · stage), when it closes and where to fix it.
 */
@Component({
  selector: 'qa-ov-attention',
  imports: [QaButtonImports, RouterLink],
  host: { class: 'block @container' },
  template: `
    <section aria-labelledby="overview-attn-title" class="flex h-full flex-col gap-4 rounded-[12px] border border-(--border) bg-(--surface) p-5">
      <!-- Wording as on the PRMS home ("Needs your attention"), with a plain gray counter; the title stays inside the card. -->
      <h3 id="overview-attn-title" class="m-0 flex items-baseline gap-2 text-(length:--fs-16) font-bold tracking-[-0.01em] text-(--text)">
        Needs your attention
        @if (count()) {
          <span class="text-(length:--fs-13) font-semibold tabular-nums text-(--text-muted)">{{ count() }}</span>
        }
      </h3>

      @if (count()) {
        <!-- Wide cards put the two groups side by side, so the action sits close to its text. -->
        <div class="grid grid-cols-1 gap-x-10 gap-y-6" [class]="groups().length > 1 ? '@6xl:grid-cols-2' : ''">
          @for (g of groups(); track g.key) {
            @let shown = isOpen(g.key) ? g.rows : g.rows.slice(0, visible);
            @let more = g.rows.length > visible;
            <div class="flex min-w-0 flex-col @container">
              <h4 class="m-0 flex items-center gap-2 px-[2px] pb-1 text-(--text-muted)">
                <!-- Both groups stay gray; the leading icon tells them apart (ban: nobody will assess them; clock: time is running out). -->
                @if (g.key === 'unreviewed') {
                  <svg class="flex-none" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><path d="m4.9 4.9 14.2 14.2"></path></svg>
                } @else {
                  <svg class="flex-none" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><path d="M12 6v6l4 2"></path></svg>
                }
                <span class="text-(length:--fs-11) font-semibold tracking-[0.08em] uppercase">{{ g.name }}</span>
                <span class="text-(length:--fs-11) font-semibold tabular-nums text-(--text-muted)">{{ g.rows.length }}</span>
              </h4>
              <ul class="m-0 list-none p-0">
                @for (r of shown; track r.text; let last = $last) {
                  <!-- A list, not a table: the deadline reads as part of the gray context line. >= @sm the action sits on the right; narrower, under the text. -->
                  <li
                    class="grid grid-cols-1 items-center gap-x-6 gap-y-1 border-(--surface-4) px-[2px] py-3 @sm:grid-cols-[minmax(0,1fr)_auto]"
                    [class.border-b]="!last || more"
                  >
                    <div class="min-w-0">
                      <p class="m-0 text-(length:--fs-13) leading-[1.5] font-normal text-pretty text-(--text-2)">
                        @for (seg of r.segs; track $index) {<span [class]="seg[1] ? 'font-semibold text-(--text)' : ''">{{ seg[0] }}</span>}
                      </p>
                      <p class="m-0 mt-0.5 text-(length:--fs-12) leading-[1.4] text-pretty text-(--text-muted)">{{ r.context }} · <span class="whitespace-nowrap">Closes {{ r.closesOn }} ({{ daysLeft(r.days) }})</span></p>
                    </div>
                    <a hlmBtn qaBtn tone="link" size="sm" [routerLink]="r.path" class="-ml-2.5 justify-self-start @sm:-mr-2.5 @sm:ml-0 @sm:justify-self-end">{{ r.label }}</a>
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

  /** 0 → "today", 1 → "1 day left", 4 → "4 days left". */
  protected daysLeft(days: number): string {
    return days <= 0 ? 'today' : days === 1 ? '1 day left' : `${days} days left`;
  }
}
