import { LowerCasePipe, NgTemplateOutlet } from '@angular/common';
import { Component, input, model, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HlmButton } from '@spartan/button';
import { QaTabsImports } from '../../../ui';
import { Pace } from './overview.mock';

export type WorkTab = 'type' | 'program' | 'assessor' | 'risk' | 'timeline';

export interface WorkRowVm {
  readonly id: string;
  /** "Result type" / "Science program" / "Assessor" (At risk tab only). */
  readonly angle: string | null;
  /** Program code shown before the name. */
  readonly code: string | null;
  readonly name: string;
  /** Assessor full name, after the nickname. */
  readonly person: string | null;
  /** "Official" / "Sub" (By timeline tab). */
  readonly chip: string | null;
  readonly title: string;
  readonly pct: number;
  readonly detail: string;
  readonly pending: string;
  readonly pace: Pace;
  readonly highlighted: boolean;
  /** Results filter the row opens, or null for timeline rows. */
  readonly queryParams: Readonly<Record<string, string>> | null;
  /** Timeline the row selects (By timeline tab). */
  readonly timelineId: string | null;
}

const PACE: Record<Pace, { color: string; icon: string }> = {
  'On track': { color: 'text-(--text-3)', icon: 'M20 6L9 17l-5-5' },
  Behind: { color: 'text-(--warning)', icon: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2' },
  'At risk': { color: 'text-(--danger)', icon: 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01' },
};

const TABS: readonly { value: WorkTab; label: string }[] = [
  { value: 'type', label: 'By result type' },
  { value: 'program', label: 'By science program' },
  { value: 'assessor', label: 'By assessor' },
  { value: 'risk', label: 'At risk' },
  { value: 'timeline', label: 'By timeline' },
];

const NAME_LINK =
  'block truncate text-(length:--fs-14) font-normal text-(--text) no-underline after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:rounded-[6px] focus-visible:after:shadow-(--focus-ring)';

/** "Where the work is": completion by result type, program, assessor, risk or timeline. */
@Component({
  selector: 'qa-ov-work',
  imports: [HlmButton, RouterLink, QaTabsImports, NgTemplateOutlet, LowerCasePipe],
  host: { class: 'block' },
  template: `
    <section aria-labelledby="overview-ww-title" class="flex flex-col gap-4 rounded-[12px] border border-(--border) bg-(--surface) p-5">
      <div class="flex flex-wrap items-start gap-4">
        <div class="flex min-w-[200px] flex-1 flex-col gap-1 max-sm:min-w-0">
          <h3 id="overview-ww-title" class="m-0 text-(length:--fs-16) font-bold tracking-[-0.01em] text-(--text)">Where the work is</h3>
          <p class="m-0 text-(length:--fs-13) font-normal text-(--text-3)">Least advanced first.</p>
        </div>
        <button
          hlmBtn
          variant="outline"
          type="button"
          (click)="download.emit()"
          class="ml-auto h-auto min-h-9 flex-none gap-2 rounded-[8px] border-(--border) bg-(--field-bg) px-[14px] text-(length:--fs-14) font-medium whitespace-nowrap text-(--text-2) shadow-none hover:border-(--border-strong) hover:bg-(--surface-2) hover:text-(--text-2) focus-visible:shadow-(--focus-ring) focus-visible:ring-0"
        >
          <svg class="flex-none" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"></path></svg>Download comments
        </button>
      </div>

      <div qaTabs variant="segmented" [(value)]="tab" class="gap-4">
        <div qaTabList aria-label="Group the work">
          <button qaTab="type">By result type</button>
          <button qaTab="program">By science program</button>
          <button qaTab="assessor">By assessor</button>
          <span aria-hidden="true" class="mx-1 h-[18px] w-px flex-none self-center bg-(--border)"></span>
          <button qaTab="risk" class="gap-[6px] text-(--warning)! hover:text-(--warning)!">
            At risk<span class="font-(family-name:--qa-mono) text-(length:--fs-12) font-semibold tabular-nums">{{ riskCount() }}</span>
          </button>
          <button qaTab="timeline">By timeline</button>
        </div>

        @for (t of tabs; track t.value) {
          <div [qaTabPanel]="t.value">
            @if (tab() === t.value) {
              <div class="overflow-x-auto">
                <table class="w-full min-w-[700px] table-fixed border-collapse">
                  <caption class="sr-only">Where the work is, {{ t.label | lowercase }}</caption>
                  <colgroup>
                    <col />
                    <col class="w-[236px]" />
                    <col class="w-[126px]" />
                    <col class="w-[134px]" />
                  </colgroup>
                  <thead>
                    <tr class="h-9 border-b border-(--surface-4)">
                      <th scope="col" class="pr-4 pl-1 text-left text-(length:--fs-11) font-semibold tracking-[0.06em] text-(--text-muted) uppercase">Name</th>
                      <th scope="col" class="pr-4 text-left text-(length:--fs-11) font-semibold tracking-[0.06em] text-(--text-muted) uppercase">Completion</th>
                      <th scope="col" class="pr-4 text-right text-(length:--fs-11) font-semibold tracking-[0.06em] text-(--text-muted) uppercase">Pending</th>
                      <th scope="col" class="pr-1 text-right text-(length:--fs-11) font-semibold tracking-[0.06em] text-(--text-muted) uppercase">Pace</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (w of rows(); track w.id; let last = $last) {
                      <tr
                        class="relative h-14 cursor-pointer border-(--surface-4) transition-[background] duration-300"
                        [class]="w.highlighted ? 'bg-(--tint) hover:bg-(--tint)' : 'bg-transparent hover:bg-(--surface-2)'"
                        [class.border-b]="!last"
                      >
                        <td class="py-2 pr-4 pl-1 align-middle">
                          <div class="flex min-w-0 flex-col gap-[2px]">
                            @if (w.angle) {
                              <span class="text-(length:--fs-11) font-semibold tracking-[0.06em] text-(--text-muted) uppercase">{{ w.angle }}</span>
                            }
                            @if (w.queryParams) {
                              <a routerLink="/results" [queryParams]="w.queryParams" [title]="w.title" class="${NAME_LINK}">
                                <ng-container *ngTemplateOutlet="name; context: { $implicit: w }" />
                              </a>
                            } @else {
                              <button type="button" (click)="pickTimeline.emit(w.timelineId ?? '')" [title]="w.title" class="${NAME_LINK} w-full cursor-pointer border-0 bg-transparent p-0 text-left">
                                <ng-container *ngTemplateOutlet="name; context: { $implicit: w }" />
                              </button>
                            }
                          </div>
                        </td>
                        <td class="pr-4 align-middle">
                          <div class="flex min-w-0 flex-col gap-[5px]">
                            <div class="h-[6px] overflow-hidden rounded-full bg-(--surface-4)">
                              <div class="h-full rounded-full bg-(--primary) transition-[width] duration-200" [style.width.%]="w.pct"></div>
                            </div>
                            <span class="truncate text-(length:--fs-12) font-normal text-(--text-3)"
                              ><span class="font-(family-name:--qa-mono) font-bold tabular-nums text-(--text)">{{ w.pct }}%</span
                              ><span class="text-(--text-4)">{{ w.detail }}</span></span
                            >
                          </div>
                        </td>
                        <td class="pr-4 text-right align-middle font-(family-name:--qa-mono) text-(length:--fs-13) font-semibold tabular-nums text-(--text)">{{ w.pending }}</td>
                        <td class="pr-1 text-right align-middle">
                          <span class="inline-flex items-center gap-[6px] text-(length:--fs-12) font-medium whitespace-nowrap" [class]="pace[w.pace].color">
                            <svg class="flex-none" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path [attr.d]="pace[w.pace].icon"></path></svg>{{ w.pace }}
                          </span>
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </div>
        }
      </div>

      <div class="flex">
        <a hlmBtn variant="ghost" routerLink="/results" class="-ml-[6px] h-auto min-h-8 rounded-[8px] border-0 px-[10px] text-(length:--fs-13) font-medium text-(--accent) no-underline hover:bg-(--tint) hover:text-(--accent) focus-visible:shadow-(--focus-ring) focus-visible:ring-0">View all in Results</a>
      </div>
    </section>

    <ng-template #name let-w>
      @if (w.code) {
        <span class="font-(family-name:--qa-mono) text-(length:--fs-13) font-semibold tabular-nums text-(--text-2)">{{ w.code }} </span>
      }
      @if (w.person !== null) {
        <span class="text-(length:--fs-14) font-semibold text-(--text)">{{ w.name }}</span>
        <span class="text-(length:--fs-13) font-normal text-(--text-3)"> {{ w.person }}</span>
      } @else {
        <span>{{ w.name }}</span>
      }
      @if (w.chip) {
        <span class="ml-1 rounded-full bg-(--surface-3) px-1.5 py-px align-[2px] text-(length:--fs-10) font-semibold text-(--text-muted)">{{ w.chip }}</span>
      }
    </ng-template>
  `,
})
export class OvWork {
  readonly tab = model<WorkTab>('type');
  readonly rows = input.required<readonly WorkRowVm[]>();
  readonly riskCount = input.required<number>();
  readonly download = output();
  readonly pickTimeline = output<string>();

  protected readonly tabs = TABS;
  protected readonly pace = PACE;
}
