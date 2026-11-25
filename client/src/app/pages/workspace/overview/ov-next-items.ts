import { Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { QaButtonImports } from '../../../ui';
import { QueueItem } from './overview-roles.mock';

export interface NextItemsVm {
  readonly title: string;
  readonly subtitle: string;
  /** Eyebrow over each note: "Lead assessor's instruction", "Change to apply". */
  readonly noteLabel: string;
  readonly items: readonly QueueItem[];
  /** `?as=` of the review page each row opens, so it shows this role's buttons. */
  readonly role: string;
}

/** The next few fields that need the TPB or the PPU: few enough to list, so a list beats a chart (Juanpa, 2026-11-11). */
@Component({
  selector: 'qa-ov-next-items',
  imports: [QaButtonImports, RouterLink],
  host: { class: 'block' },
  template: `
    @let d = data();
    <section aria-labelledby="overview-next-title" class="flex h-full flex-col rounded-[12px] border border-(--border) bg-(--surface) pt-5 shadow-(--shadow-card)">
      <div class="flex flex-col gap-0.5 px-5 pb-3">
        <h3 id="overview-next-title" class="m-0 text-(length:--fs-16) font-bold tracking-[-0.01em] text-(--text)">{{ d.title }}</h3>
        <p class="m-0 text-(length:--fs-13) text-(--text-3)">{{ d.subtitle }}</p>
      </div>
      <ul class="m-0 flex list-none flex-col p-0">
        @for (it of d.items; track it.code + it.field) {
          <!-- The row opens the review; a change already updated in the Reporting Tool can also be closed from here. -->
          <li class="flex flex-col border-t border-(--surface-4) has-[a:hover]:bg-(--surface-2) sm:flex-row sm:items-center">
            <a
              [routerLink]="['/results', it.code]"
              [queryParams]="{ as: d.role }"
              class="flex min-w-0 flex-1 flex-col gap-1.5 px-5 py-3.5 no-underline focus-visible:shadow-(--focus-ring) focus-visible:outline-none"
            >
              <span class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span class="font-(family-name:--qa-mono) text-(length:--fs-13) font-semibold text-(--accent) tabular-nums">{{ it.code }}</span>
                <span class="text-(length:--fs-12) text-(--text-muted)">{{ it.program }}</span>
                <span class="line-clamp-2 min-w-0 basis-full text-(length:--fs-14) text-(--text)">{{ it.title }}</span>
              </span>
              <span class="text-(length:--fs-13) text-(--text-2)"><span class="font-semibold">{{ it.field }}</span><span class="text-(--text-3)"> · {{ d.noteLabel }}: {{ it.note }}</span></span>
              @switch (it.reporting) {
                @case ('updated') {
                  <span class="inline-flex items-center gap-[5px]">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--st-approved-fg)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" class="flex-none" aria-hidden="true"><path d="M20 6L9 17l-5-5" /></svg>
                    <span class="text-(length:--fs-11) font-semibold text-(--st-approved-fg)">Updated in the Reporting Tool</span>
                  </span>
                }
                @case ('not-updated') {
                  <span class="inline-flex items-center gap-[5px]">
                    <span class="box-border size-[11px] flex-none rounded-full border-[1.5px] border-(--border-strong)" aria-hidden="true"></span>
                    <span class="text-(length:--fs-11) font-semibold text-(--text-3)">Not updated in the Reporting Tool yet</span>
                  </span>
                }
              }
            </a>
            @if (it.reporting === 'updated') {
              <div class="flex-none px-5 pb-3.5 sm:py-3.5 sm:pl-0">
                <button hlmBtn qaBtn tone="secondary" size="sm" type="button" (click)="done.emit(it)">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" class="flex-none" aria-hidden="true"><path d="M20 6L9 17l-5-5" /></svg>Mark when done<span class="sr-only">: {{ it.code }} {{ it.field }}</span>
                </button>
              </div>
            }
          </li>
        }
      </ul>
    </section>
  `,
})
export class OvNextItems {
  readonly data = input.required<NextItemsVm>();
  /** PPU: close a change the program already updated in the Reporting Tool, without opening its review. */
  readonly done = output<QueueItem>();
}
