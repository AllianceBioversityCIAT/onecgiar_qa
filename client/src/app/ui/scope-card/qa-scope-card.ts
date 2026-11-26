import { Component, Directive, input } from '@angular/core';

/** Marks the picker that leads the row (a `qa-select` with `appearance="scope"`). */
@Directive({ selector: '[qaScopePicker]' })
export class QaScopePicker {}

/** Optional element at the right of the row (a second picker, a note). Shown before the count. */
@Directive({ selector: '[qaScopeAside]' })
export class QaScopeAside {}

/**
 * Scope band at the top of a page: what the whole page is about (a timeline, a result type) and the filters that depend
 * on it, in one row. It is part of the page header, not a card: no box, and a line from edge to edge under it, so it
 * never reads as one more block of content (Juanpa, 2026-11-23, after Yeck's demo with María Julia). The picker leads
 * the row, bigger than the filters and with an accent border; a short vertical line separates it from them; the total
 * sits at the right; the picker's facts go under it. Results, Overview and Fields use it the same way.
 * (A grey band was tried and dropped the same day: the picker carries the hierarchy, the other pages have white
 * headers, and Fields' grey chips vanished on it.)
 *
 * The page gives it the bleed of its own padding, so the line runs from edge to edge, e.g.
 * <qa-scope-card class="-mx-4 -mt-5 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8" regionLabel="Timeline" meta="…" count="989" countLabel="results">
 *   <qa-select qaScopePicker appearance="scope" label="Timeline" … />
 *   …filters and their chips…
 * </qa-scope-card>
 */
@Component({
  selector: 'qa-scope-card',
  host: { class: 'block @container border-b border-(--border) pt-6 pb-5' },
  template: `
    <section [attr.aria-label]="regionLabel()" class="flex flex-col gap-2">
      <div class="flex flex-wrap items-start gap-x-4 gap-y-3">
        <!-- The picker and, right under it, its facts. Where the big total does not fit at the right, it joins the facts. -->
        <div class="flex min-w-0 flex-none flex-col gap-1.5 max-sm:w-full">
          <ng-content select="[qaScopePicker]" />
          @if (meta() || count()) {
            <p class="m-0 max-w-[22rem] text-(length:--fs-12) text-pretty text-(--text-3)">
              {{ meta() }}
              @if (count()) {
                <span class="@min-[56rem]:hidden">{{ meta() ? ' · ' : '' }}<b class="font-semibold tabular-nums text-(--text-2)">{{ count() }}</b> {{ countLabel() }}</span>
              }
            </p>
          }
        </div>
        <span aria-hidden="true" class="mt-2.5 h-8 w-px flex-none bg-(--border) max-sm:hidden"></span>
        <!-- The filters: their first line is centred on the 52px picker; their chips wrap under them. -->
        <div class="flex min-w-[min(100%,16rem)] flex-1 flex-col gap-3 pt-2 empty:hidden max-sm:pt-0">
          <ng-content />
        </div>
        <div class="ml-auto flex flex-none flex-wrap items-center gap-x-6 gap-y-2 pt-0.5 empty:hidden max-sm:ml-0">
          <ng-content select="[qaScopeAside]" />
          @if (count()) {
            <p class="m-0 flex flex-col items-end leading-none @max-[56rem]:hidden">
              <span class="text-[1.75rem] font-bold tracking-[-0.02em] tabular-nums text-(--text)">{{ count() }}</span>
              <span class="mt-1 text-(length:--fs-12) text-(--text-3)">{{ countLabel() }}</span>
            </p>
          }
        </div>
      </div>
    </section>
  `,
})
export class QaScopeCard {
  /** Names the region for screen readers ("Timeline"); the visible label is inside the picker. */
  readonly regionLabel = input.required<string>();
  /** The picker's key facts, under the row ("Main batch · Step 4 of 5 · closes 23 Jul"). */
  readonly meta = input<string | null>(null);
  /** Big number at the right ("989"); hidden when empty. */
  readonly count = input<string | null>(null);
  readonly countLabel = input('');
}

export const QaScopeCardImports = [QaScopeCard, QaScopePicker, QaScopeAside] as const;
