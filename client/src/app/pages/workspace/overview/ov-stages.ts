import { Component, input, model } from '@angular/core';
import { QaDialogImports } from '../../../ui';

export type StageStatus = 'Completed' | 'In progress' | 'Behind' | 'Not started';

export interface StageRowVm {
  readonly n: number;
  readonly name: string;
  readonly criterion: string;
  /** "06 Jul – 11 Jul" / "From 19 Jul". */
  readonly dates: string;
  readonly status: StageStatus;
  /** Open stage only: how far it has gone. */
  readonly progress: { readonly pct: number; readonly done: string; readonly of: string; readonly left: string } | null;
  /** Completed stage: "214 assessed · 38 returned". */
  readonly summary: string;
}

/** Stages of one timeline. Each timeline has its own stages. */
export interface TimelineStagesVm {
  readonly name: string;
  /** "Official timeline, 989 results". */
  readonly meta: string;
  readonly rows: readonly StageRowVm[];
}

const STAGE_CHIP: Record<StageStatus, string> = {
  Completed: 'bg-(--surface-3) text-(--text-muted)',
  'In progress': 'bg-(--st-indigo-bg) text-(--st-indigo-fg)',
  Behind: 'bg-(--st-editing-bg) text-(--st-editing-fg)',
  'Not started': 'bg-(--surface-3) text-(--text-muted) opacity-70',
};

/** "View stages" pop-up of a timeline lane: one row per stage of that timeline. */
@Component({
  selector: 'qa-ov-stages',
  imports: [QaDialogImports],
  host: { class: 'contents' },
  template: `
    @if (data(); as d) {
      <qa-dialog [(open)]="open" [title]="d.name" [subtitle]="d.meta + '. Each stage closes when its own condition is met.'" width="640px">
        <ol class="m-0 flex list-none flex-col p-0" [attr.aria-label]="d.name + ' stages'">
          @for (s of d.rows; track s.n) {
            <li class="grid grid-cols-[20px_minmax(0,1fr)_auto] gap-x-3 gap-y-2 border-b border-(--surface-4) py-3 last:border-b-0">
              <span class="pt-px text-(length:--fs-13) font-semibold tabular-nums text-(--text-muted)">{{ s.n }}</span>
              <div class="flex min-w-0 flex-col gap-[3px]">
                <span class="text-(length:--fs-14) font-semibold text-(--text)">{{ s.name }}</span>
                @if (s.criterion) {
                  <span class="text-(length:--fs-12) leading-[1.45] text-(--text-4)">{{ s.criterion }}</span>
                }
                <span class="text-(length:--fs-11) font-medium text-(--text-muted)">{{ s.dates }}</span>
              </div>
              <span class="self-start rounded-full px-[10px] py-[3px] text-(length:--fs-11) font-semibold whitespace-nowrap" [class]="chip[s.status]">{{ s.status }}</span>

              @if (s.progress; as p) {
                <div class="col-start-2 col-end-[-1] flex flex-col gap-[5px]">
                  <div class="h-2 overflow-hidden rounded-full bg-(--surface-4)" role="progressbar" [attr.aria-label]="s.name + ': completion'" [attr.aria-valuenow]="p.pct" aria-valuemin="0" aria-valuemax="100">
                    <div class="h-full rounded-full bg-(--primary)" [style.width.%]="p.pct"></div>
                  </div>
                  <span class="text-(length:--fs-12) text-(--text-4)"
                    ><span class="font-bold tabular-nums text-(--text)">{{ p.pct }}%</span> ({{ p.done }}&nbsp;of&nbsp;{{ p.of }}), {{ p.left }} left</span
                  >
                </div>
              } @else if (s.summary) {
                <span class="col-start-2 col-end-[-1] text-(length:--fs-12) text-(--text-3)">{{ s.summary }}</span>
              }
            </li>
          }
        </ol>
      </qa-dialog>
    }
  `,
})
export class OvStages {
  readonly open = model(false);
  readonly data = input<TimelineStagesVm | null>(null);

  protected readonly chip = STAGE_CHIP;
}
