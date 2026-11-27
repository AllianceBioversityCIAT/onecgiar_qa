import { Component, Directive, input } from '@angular/core';

/** Marks the scope picker (a `qa-select` with `appearance="scope"`) that `qa-scope-title` shows after the page name. */
@Directive({ selector: '[qaScopePicker]' })
export class QaScopePicker {}

/**
 * Title of a page with a page-wide scope (a timeline, a result type): the page name, and next to it the scope picker in
 * a small grey container, "Results  [Annual report 2026 ⌄]", with the scope's facts as the subtitle (Juanpa,
 * 2026-11-25). It replaced a 52px green-bordered box next to 36px filters, which looked accidental and "made by AI".
 * The picker is as tall as the filters and filled instead of outlined, so the title stays the title and the picker
 * reads as the page's selector. Without a picker (still loading, nothing to choose) it is a plain page title.
 *
 * <qa-scope-title heading="Results" [subtitle]="meta()">
 *   <qa-select qaScopePicker appearance="scope" label="Timeline" … />
 * </qa-scope-title>
 */
@Component({
  selector: 'qa-scope-title',
  host: { class: 'flex min-w-0 flex-col gap-1' },
  template: `
    <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
      <h1 class="m-0 text-(length:--fs-26) leading-[1.2] font-bold tracking-[-0.02em] text-balance text-(--text)">{{ heading() }}</h1>
      <ng-content select="[qaScopePicker]" />
    </div>
    @if (subtitle()) {
      <p class="m-0 text-(length:--fs-14) text-pretty text-(--text-3)">{{ subtitle() }}</p>
    }
  `,
})
export class QaScopeTitle {
  /** The page's name ("Results", "Fields"). */
  readonly heading = input.required<string>();
  /** The scope's facts ("Main batch · Step 4 of 5"), or what the page is for when there are none. */
  readonly subtitle = input<string | null>(null);
}

/**
 * Filter toolbar of a scoped page: the filters that depend on the scope in the title, then their chips. It sits right
 * on the content it filters: no box and no line under it, because a line there cut the filters off from their table
 * (Juanpa, 2026-11-25). No total here: each page already says it right below (Results' counters, Overview's big number).
 * Results, Overview and Fields use it the same way.
 *
 * <qa-scope-card regionLabel="Filters">…filters, then their chips…</qa-scope-card>
 */
@Component({
  selector: 'qa-scope-card',
  host: { class: 'block' },
  template: `
    <section [attr.aria-label]="regionLabel()" class="flex min-w-0 flex-col gap-3">
      <ng-content />
    </section>
  `,
})
export class QaScopeCard {
  /** Names the region for screen readers ("Filters"). */
  readonly regionLabel = input.required<string>();
}

export const QaScopeCardImports = [QaScopeTitle, QaScopeCard, QaScopePicker] as const;
