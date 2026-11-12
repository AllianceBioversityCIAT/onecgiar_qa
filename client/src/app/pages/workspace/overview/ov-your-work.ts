import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { QaButtonImports, QaProgress } from '../../../ui';

/** A link inside the Overview: a route and its query params. */
export interface OvLink {
  readonly path: readonly string[];
  readonly query?: Readonly<Record<string, string | null>>;
}

export interface YourWorkVm {
  /** "18". */
  readonly count: string;
  /** "results to assess". */
  readonly noun: string;
  /** "Assessors · July 2026 sub-timeline". */
  readonly step: string;
  /** "Closes 23 Jul (4 days left)" / "Opens 29 Jul". */
  readonly when: string;
  /** Closes in 3 days or less: the one urgent signal of the block. */
  readonly urgent: boolean;
  /** Share of the role's work already done; null when the role has no "done" (the lead highlights only some comments). */
  readonly progress: { readonly done: number; readonly of: number; readonly label: string } | null;
  /** What the count is made of; a row with a link opens that list. */
  readonly rows: readonly { readonly label: string; readonly count: string; readonly link: OvLink | null }[];
  readonly action: { readonly label: string; readonly link: OvLink };
}

/**
 * "Your work": the first block of every reviewing role (Juanpa, 2026-11-11). It answers "what needs me, and by when?"
 * with the same layout for the assessor, the lead assessor, the TPB and the PPU; only the words and numbers change.
 */
@Component({
  selector: 'qa-ov-your-work',
  imports: [QaButtonImports, QaProgress, RouterLink],
  host: { class: 'block @container' },
  template: `
    @let d = data();
    <section aria-labelledby="overview-work-title" class="flex flex-col gap-5 rounded-[12px] border border-(--border) bg-(--surface) p-5">
      <div class="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div class="flex min-w-0 flex-col gap-1">
          <h2 id="overview-work-title" class="m-0 text-(length:--fs-16) font-bold tracking-[-0.01em] text-(--text)">Your work</h2>
          <p class="m-0 flex flex-wrap items-baseline gap-x-3">
            <span class="text-[2rem] leading-[1.05] font-bold tracking-[-0.02em] tabular-nums text-(--text) @2xl:text-[2.5rem]">{{ d.count }}</span>
            <span class="text-(length:--fs-16) font-semibold text-(--text-2)">{{ d.noun }}</span>
          </p>
          <p class="m-0 text-(length:--fs-13) text-(--text-3)">
            {{ d.step }} · <span [class]="d.urgent ? 'font-semibold text-(--danger)' : ''">{{ d.when }}</span>
          </p>
        </div>
        <a hlmBtn qaBtn tone="primary" [routerLink]="d.action.link.path" [queryParams]="d.action.link.query ?? null" class="flex-none">{{ d.action.label }}</a>
      </div>

      @if (d.progress; as p) {
        <div class="flex flex-col gap-1.5">
          <qa-progress [value]="p.done" [max]="p.of || 1" [attr.aria-label]="p.done + ' of ' + p.of + ' ' + p.label" class="h-2!" />
          <span class="text-(length:--fs-12) text-(--text-3)"><b class="font-semibold tabular-nums text-(--text-2)">{{ p.done }} of {{ p.of }}</b> {{ p.label }} so far</span>
        </div>
      }

      <ul class="m-0 -mx-2 grid list-none grid-cols-1 gap-x-4 p-0 @xl:grid-cols-3">
        @for (r of d.rows; track r.label) {
          <li>
            @if (r.link; as l) {
              <a
                [routerLink]="l.path"
                [queryParams]="l.query ?? null"
                class="group flex min-h-11 items-center gap-3 rounded-[8px] px-2 py-[7px] no-underline hover:bg-(--surface-3) focus-visible:shadow-(--focus-ring) focus-visible:outline-none"
              >
                <span class="min-w-0 flex-1 text-(length:--fs-14) font-medium text-(--text-2)">{{ r.label }}</span>
                <span class="flex-none text-(length:--fs-16) font-bold tabular-nums text-(--text)">{{ r.count }}</span>
                <svg class="flex-none text-(--text-muted) group-hover:text-(--text-3)" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg>
              </a>
            } @else {
              <div class="flex min-h-11 items-center gap-3 px-2 py-[7px]">
                <span class="min-w-0 flex-1 text-(length:--fs-14) font-medium text-(--text-2)">{{ r.label }}</span>
                <span class="flex-none text-(length:--fs-16) font-bold tabular-nums text-(--text)">{{ r.count }}</span>
                <span aria-hidden="true" class="w-[14px] flex-none"></span>
              </div>
            }
          </li>
        }
      </ul>
    </section>
  `,
})
export class OvYourWork {
  readonly data = input.required<YourWorkVm>();
}
