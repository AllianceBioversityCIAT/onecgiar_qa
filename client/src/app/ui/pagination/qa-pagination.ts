import { Component, computed, input, model } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { QaSelect, QaSelectOption } from '../select/qa-select';

/** A page number, or a gap ("…") between two of them. */
type PageItem = { readonly kind: 'page'; readonly n: number } | { readonly kind: 'gap'; readonly id: string };

/** Up to 7 slots: first, last, the current page with its neighbours, and a "…" where pages are skipped. */
function pageItems(page: number, pages: number): PageItem[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => ({ kind: 'page', n: i + 1 }));
  const near = page <= 4 ? [2, 3, 4, 5] : page >= pages - 3 ? [pages - 4, pages - 3, pages - 2, pages - 1] : [page - 1, page, page + 1];
  const items: PageItem[] = [{ kind: 'page', n: 1 }];
  if (near[0] > 2) items.push({ kind: 'gap', id: 'start' });
  near.forEach((n) => items.push({ kind: 'page', n }));
  if (near[near.length - 1] < pages - 1) items.push({ kind: 'gap', id: 'end' });
  items.push({ kind: 'page', n: pages });
  return items;
}

const NAV_BTN =
  'flex size-8 max-sm:size-10 items-center justify-center rounded-md text-(length:--fs-13) tabular-nums outline-none ' +
  'focus-visible:shadow-(--focus-ring) disabled:cursor-not-allowed disabled:opacity-40';

/**
 * Footer of a long table, as in PRMS: "Showing 1–25 of 240" on the left; rows per page and the pages on the right.
 * Narrow screens keep previous / next with "Page 2 of 10" instead of every number.
 *
 * <qa-pagination [(page)]="page" [(pageSize)]="pageSize" [total]="240" />
 */
@Component({
  selector: 'qa-pagination',
  imports: [QaSelect, DecimalPipe],
  host: { class: 'block' },
  template: `
    <nav aria-label="Pagination" class="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <p class="m-0 text-(length:--fs-13) text-(--text-3)" aria-live="polite">
        Showing <span class="tabular-nums text-(--text-2)">{{ from() | number }}–{{ to() | number }}</span> of
        <span class="tabular-nums text-(--text-2)">{{ total() | number }}</span>
      </p>

      <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
        <qa-select [value]="'' + pageSize()" (valueChange)="setPageSize($event)" [options]="sizeOptions()" label="Rows per page" />

        <div class="flex items-center gap-1">
          <button type="button" [class]="navBtn + ' text-(--text-3) enabled:hover:bg-(--surface-3) enabled:hover:text-(--text)'" [disabled]="page() <= 1" (click)="go(page() - 1)" aria-label="Previous page">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
          </button>

          <span class="px-2 text-(length:--fs-13) whitespace-nowrap text-(--text-3) sm:hidden">Page <span class="tabular-nums text-(--text-2)">{{ page() }}</span> of <span class="tabular-nums text-(--text-2)">{{ pages() }}</span></span>
          <ul class="m-0 hidden list-none items-center gap-1 p-0 sm:flex">
            @for (item of items(); track item.kind === 'page' ? item.n : item.id) {
              <li>
                @if (item.kind === 'page') {
                  @let current = item.n === page();
                  <button
                    type="button"
                    [class]="navBtn + ' min-w-8 px-1.5 ' + (current ? 'bg-(--tint-2) font-semibold text-(--accent)' : 'font-medium text-(--text-2) hover:bg-(--surface-3) hover:text-(--text)')"
                    [attr.aria-current]="current ? 'page' : null"
                    [attr.aria-label]="'Page ' + item.n"
                    (click)="go(item.n)"
                  >{{ item.n }}</button>
                } @else {
                  <span aria-hidden="true" class="flex size-8 items-center justify-center text-(length:--fs-13) text-(--text-muted)">…</span>
                }
              </li>
            }
          </ul>

          <button type="button" [class]="navBtn + ' text-(--text-3) enabled:hover:bg-(--surface-3) enabled:hover:text-(--text)'" [disabled]="page() >= pages()" (click)="go(page() + 1)" aria-label="Next page">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6" /></svg>
          </button>
        </div>
      </div>
    </nav>
  `,
})
export class QaPagination {
  /** Current page, from 1. */
  readonly page = model(1);
  readonly pageSize = model(25);
  /** Rows across every page. */
  readonly total = input.required<number>();
  readonly pageSizes = input<readonly number[]>([10, 25, 50, 100]);

  protected readonly navBtn = NAV_BTN;
  protected readonly pages = computed(() => Math.max(1, Math.ceil(this.total() / this.pageSize())));
  protected readonly from = computed(() => (this.total() ? (this.page() - 1) * this.pageSize() + 1 : 0));
  protected readonly to = computed(() => Math.min(this.total(), this.page() * this.pageSize()));
  protected readonly items = computed(() => pageItems(this.page(), this.pages()));
  protected readonly sizeOptions = computed<QaSelectOption[]>(() => this.pageSizes().map((n) => ({ value: '' + n, label: n + ' per page' })));

  protected go(n: number): void {
    this.page.set(Math.min(Math.max(1, n), this.pages()));
  }

  protected setPageSize(value: string | null): void {
    const n = Number(value);
    if (!n || n === this.pageSize()) return;
    this.pageSize.set(n);
    this.page.set(1);
  }
}
