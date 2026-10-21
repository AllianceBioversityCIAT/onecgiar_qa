import { LowerCasePipe, NgTemplateOutlet } from '@angular/common';
import { Component, input, model, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { QaButtonImports, QaTabsImports } from '../../../ui';
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

/** Only "At risk" keeps a color, so the urgent rows stand out (same rule as Needs attention). */
const PACE: Record<Pace, string> = {
  'On track': 'text-(--text-4)',
  Behind: 'text-(--text-2)',
  'At risk': 'font-semibold text-(--danger)',
};

const TABS: readonly { value: WorkTab; label: string }[] = [
  { value: 'type', label: 'By result type' },
  { value: 'program', label: 'By science program' },
  { value: 'assessor', label: 'By assessor' },
  { value: 'risk', label: 'At risk' },
  { value: 'timeline', label: 'By timeline' },
];

const NAME_LINK =
  'block truncate text-(length:--fs-14) @max-2xl:whitespace-normal font-normal text-(--text) no-underline after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:rounded-[6px] focus-visible:after:shadow-(--focus-ring)';

/** Narrow cards: the segmented tabs wrap and grow to 40px touch targets instead of scrolling sideways. */
const TAB = '@max-2xl:h-10 @max-2xl:flex-auto @max-2xl:justify-center';

/** "Where the work is": completion by result type, program, assessor, risk or timeline. */
@Component({
  selector: 'qa-ov-work',
  imports: [QaButtonImports, RouterLink, QaTabsImports, NgTemplateOutlet, LowerCasePipe],
  host: { class: 'block @container' },
  template: `
    <section aria-labelledby="overview-ww-title" class="flex flex-col gap-4 rounded-[12px] border border-(--border) bg-(--surface) p-5">
      <div class="flex flex-col gap-1">
        <h3 id="overview-ww-title" class="m-0 text-(length:--fs-16) font-bold tracking-[-0.01em] text-(--text)">Where the work is</h3>
      </div>

      <div qaTabs variant="segmented" [(value)]="tab" class="gap-4">
        <div qaTabList aria-label="Group the work" class="@max-2xl:h-auto @max-2xl:w-full @max-2xl:flex-wrap @max-2xl:gap-1 @max-2xl:p-1">
          <button qaTab="type" class="${TAB}">By result type</button>
          <button qaTab="program" class="${TAB}">By science program</button>
          <button qaTab="assessor" class="${TAB}">By assessor</button>
          <span aria-hidden="true" class="mx-1 h-[18px] w-px flex-none self-center bg-(--border) @max-2xl:hidden"></span>
          <button qaTab="risk" class="gap-[6px] ${TAB}">
            At risk<span class="text-(length:--fs-12) font-normal tabular-nums text-(--text-muted)">{{ riskCount() }}</span>
          </button>
          <button qaTab="timeline" class="${TAB}">By timeline</button>
        </div>

        @for (t of tabs; track t.value) {
          <div [qaTabPanel]="t.value">
            @if (tab() === t.value) {
              <!-- >= @4xl: the mockup table. @2xl-@4xl: narrower number columns. < @2xl: rows stack, no header row.
                   Sticky header: no overflow ancestor up to <main>, so the column titles stay under the top bar. -->
              <div>
                <table class="w-full table-fixed border-collapse @max-2xl:block">
                  <caption class="sr-only">Where the work is, {{ t.label | lowercase }}</caption>
                  <colgroup class="@max-2xl:hidden">
                    <col />
                    <col class="w-[236px] @max-4xl:w-[200px]" />
                    <col class="w-[126px] @max-4xl:w-[96px]" />
                    <col class="w-[134px] @max-4xl:w-[112px]" />
                  </colgroup>
                  <thead class="@max-2xl:hidden">
                    <tr>
                      <th scope="col" class="sticky top-0 z-10 h-9 bg-(--surface) shadow-[inset_0_-1px_0_var(--surface-4)] pr-4 pl-1 text-left text-(length:--fs-12) font-medium text-(--text-4)">Name</th>
                      <th scope="col" class="sticky top-0 z-10 h-9 bg-(--surface) shadow-[inset_0_-1px_0_var(--surface-4)] pr-4 text-left text-(length:--fs-12) font-medium text-(--text-4)">Completion</th>
                      <th scope="col" class="sticky top-0 z-10 h-9 bg-(--surface) shadow-[inset_0_-1px_0_var(--surface-4)] pr-4 text-right text-(length:--fs-12) font-medium text-(--text-4)">Pending</th>
                      <th scope="col" class="sticky top-0 z-10 h-9 bg-(--surface) shadow-[inset_0_-1px_0_var(--surface-4)] pr-1 text-right text-(length:--fs-12) font-medium text-(--text-4)">Pace</th>
                    </tr>
                  </thead>
                  <tbody class="@max-2xl:block">
                    @for (w of rows(); track w.id; let last = $last) {
                      <tr
                        class="relative h-14 cursor-pointer border-(--surface-4) transition-[background] duration-300 @max-2xl:grid @max-2xl:h-auto @max-2xl:grid-cols-[minmax(0,1fr)_auto] @max-2xl:gap-x-4 @max-2xl:gap-y-2 @max-2xl:px-1 @max-2xl:py-3"
                        [class]="w.highlighted ? 'bg-(--tint) hover:bg-(--tint)' : 'bg-transparent hover:bg-(--surface-2)'"
                        [class.border-b]="!last"
                      >
                        <td class="py-2 pr-4 pl-1 align-middle @max-2xl:col-start-1 @max-2xl:row-start-1 @max-2xl:p-0">
                          <div class="flex min-w-0 flex-col gap-[2px]">
                            @if (w.angle) {
                              <span class="text-(length:--fs-12) font-medium text-(--text-4)">{{ w.angle }}</span>
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
                        <td class="pr-4 align-middle @max-2xl:contents">
                          <div class="flex min-w-0 flex-col gap-[5px] @max-2xl:contents">
                            <div class="h-[6px] overflow-hidden rounded-full bg-(--surface-4) @max-2xl:col-span-full @max-2xl:row-start-2">
                              <div class="h-full rounded-full bg-(--primary) transition-[width] duration-200" [style.width.%]="w.pct"></div>
                            </div>
                            <span class="truncate text-(length:--fs-12) font-normal text-(--text-3) @max-2xl:col-start-1 @max-2xl:row-start-3 @max-2xl:self-center @max-2xl:whitespace-normal"
                              ><span class="font-medium whitespace-nowrap tabular-nums text-(--text)">{{ w.pct }}%</span
                              ><span class="text-(--text-4)">{{ w.detail }}</span></span
                            >
                          </div>
                        </td>
                        <td class="pr-4 text-right align-middle text-(length:--fs-13) font-semibold whitespace-nowrap tabular-nums text-(--text) @max-2xl:col-start-2 @max-2xl:row-start-3 @max-2xl:self-center @max-2xl:p-0">
                          {{ w.pending }}<span class="hidden font-sans text-(length:--fs-12) font-normal text-(--text-4) @max-2xl:inline"> pending</span>
                        </td>
                        <td class="pr-1 text-right align-middle @max-2xl:col-start-2 @max-2xl:row-start-1 @max-2xl:block @max-2xl:self-start @max-2xl:p-0">
                          <span class="text-(length:--fs-13) font-normal whitespace-nowrap" [class]="pace[w.pace]">{{ w.pace }}</span>
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
        <a hlmBtn qaBtn tone="link" size="sm" flush="start" routerLink="/results">View all in Results</a>
      </div>
    </section>

    <ng-template #name let-w>
      @if (w.code) {
        <span class="text-(length:--fs-13) font-semibold tabular-nums text-(--text-2)">{{ w.code }} </span>
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
  readonly pickTimeline = output<string>();

  protected readonly tabs = TABS;
  protected readonly pace = PACE;
}
