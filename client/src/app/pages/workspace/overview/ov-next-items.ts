import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
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
  imports: [RouterLink],
  host: { class: 'block' },
  template: `
    @let d = data();
    <section aria-labelledby="overview-next-title" class="flex h-full flex-col rounded-[12px] border border-(--border) bg-(--surface) pt-5">
      <div class="flex flex-col gap-0.5 px-5 pb-3">
        <h3 id="overview-next-title" class="m-0 text-(length:--fs-16) font-bold tracking-[-0.01em] text-(--text)">{{ d.title }}</h3>
        <p class="m-0 text-(length:--fs-13) text-(--text-3)">{{ d.subtitle }}</p>
      </div>
      <ul class="m-0 flex list-none flex-col p-0">
        @for (it of d.items; track it.code + it.field) {
          <li class="border-t border-(--surface-4)">
            <a
              [routerLink]="['/results', it.code]"
              [queryParams]="{ as: d.role }"
              class="group flex flex-col gap-1.5 px-5 py-3.5 no-underline hover:bg-(--surface-2) focus-visible:shadow-(--focus-ring) focus-visible:outline-none"
            >
              <span class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span class="font-(family-name:--qa-mono) text-(length:--fs-13) font-semibold text-(--accent) tabular-nums">{{ it.code }}</span>
                <span class="text-(length:--fs-12) text-(--text-muted)">{{ it.program }}</span>
                <span class="min-w-0 basis-full truncate text-(length:--fs-14) text-(--text)">{{ it.title }}</span>
              </span>
              <span class="text-(length:--fs-13) text-(--text-2)"><span class="font-semibold">{{ it.field }}</span><span class="text-(--text-3)"> · {{ d.noteLabel }}: {{ it.note }}</span></span>
            </a>
          </li>
        }
      </ul>
    </section>
  `,
})
export class OvNextItems {
  readonly data = input.required<NextItemsVm>();
}
