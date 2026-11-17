import { Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { SpApi } from '../../core/api/sp-api';
import { SpResults, SpResultRow } from '../../core/api/sp.models';
import { toApiError } from '../../core/http/api-envelope';
import {
  QaBadge,
  QaButtonImports,
  QaLoadingImports,
  QaMultiSelect,
  QaMultiSelectOption,
  QaSelectImports,
  QaSelectOption,
} from '../../ui';
import { SpContext } from './sp-context';
import { SpCsvDownload } from './sp-csv-download';
import { STEP_STATE_LABEL, statusLabel, statusTone, stepTone, stepWindow } from './sp-format';
import { SpResultsRowsSkeleton, SpResultsSkeleton } from './sp-results-skeleton';

/**
 * The program's results in a QA timeline (P2-3911 AC2–AC5, AC13): timeline picker with the step-2
 * window, server-side filters (QA status, result type), and per row the comments, how many the program
 * answered, the QA status, and "Export comments". A row opens the result view.
 */
@Component({
  selector: 'qa-sp-results-page',
  imports: [RouterLink, QaBadge, QaButtonImports, QaLoadingImports, QaMultiSelect, QaSelectImports, SpResultsSkeleton, SpResultsRowsSkeleton],
  host: { class: 'block' },
  template: `
    <main class="mx-auto flex max-w-[1280px] flex-col gap-5 px-4 pt-6 pb-10 sm:px-6 lg:px-8">
      <div class="flex flex-col gap-1">
        <h1 class="m-0 text-balance text-(length:--fs-26) leading-[1.2] font-bold tracking-[-0.02em] text-(--text)">Results in QA</h1>
        <p class="m-0 text-pretty text-(length:--fs-14) text-(--text-3)">
          Read the Quality Assurance comments on your program's results and respond to them.
        </p>
      </div>

      @if (ctx.programId() === null) {
        <p class="m-0 text-(length:--fs-14) text-(--text-3)" data-testid="sp-pick-program">Select a Science Program to see its results.</p>
      } @else if (timelines.isLoading() && !timelines.hasValue()) {
        <qa-sp-results-skeleton />
      } @else if (timelinesError(); as error) {
        <div class="flex flex-col items-start gap-2" role="alert">
          <p class="m-0 text-(length:--fs-14) text-(--text-2)">{{ error }}</p>
          <button hlmBtn qaBtn tone="secondary" size="sm" type="button" (click)="timelines.reload()">Try again</button>
        </div>
      } @else if (timelineOptions().length === 0) {
        <p class="m-0 text-(length:--fs-14) text-(--text-3)">There is no QA timeline for this program in the current cycle.</p>
      } @else {
        <div class="flex flex-col gap-3">
          <div class="flex flex-wrap items-center gap-x-5 gap-y-2">
            <div class="flex min-w-0 items-center gap-2">
              <label for="sp-timeline-select" class="flex-none text-(length:--fs-13) font-medium text-(--text-3)">Timeline</label>
              <qa-select
                triggerId="sp-timeline-select"
                [value]="timelineValue()"
                (valueChange)="onTimeline($event)"
                [options]="timelineOptions()"
                label="Timeline"
                class="min-w-[240px] max-sm:min-w-0 max-sm:flex-1"
              />
            </div>
            @if (step(); as s) {
              <div class="flex flex-wrap items-center gap-2 text-(length:--fs-13) text-(--text-3)" data-testid="sp-step">
                <span class="font-medium text-(--text-2)">{{ s.name }}</span>
                <qa-badge [status]="stepTone(s.state)">{{ stepStateLabel[s.state] }}</qa-badge>
                <span>{{ stepWindow(s) }}</span>
              </div>
            } @else if (results.hasValue()) {
              <span class="text-(length:--fs-13) text-(--text-3)">This timeline has no response step for programs.</span>
            }
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <qa-multi-select
              [value]="ctx.statuses()"
              (valueChange)="ctx.statuses.set($event)"
              [options]="statusOptions()"
              label="QA status"
              [searchable]="false"
              panelWidth="280px"
              listMaxHeight="none"
            />
            <qa-multi-select
              [value]="ctx.resultTypes()"
              (valueChange)="ctx.resultTypes.set($event)"
              [options]="typeOptions()"
              label="Result type"
              [searchable]="false"
              panelWidth="320px"
              listMaxHeight="none"
            />
            @if (ctx.statuses().length || ctx.resultTypes().length) {
              <button hlmBtn qaBtn tone="link" size="sm" type="button" (click)="clearFilters()">Clear filters</button>
            }
          </div>
        </div>

        <p class="sr-only" aria-live="polite">{{ exportNotice() }}</p>
        @if (exportError(); as message) {
          <p class="m-0 rounded-lg border border-(--danger-soft) bg-(--danger-bg) px-3 py-2 text-(length:--fs-13) text-(--danger-strong)" role="alert">
            {{ message }}
          </p>
        }

        @if (results.isLoading() && !results.hasValue()) {
          <qa-sp-results-rows-skeleton />
        } @else if (resultsError(); as error) {
          <div class="flex flex-col items-start gap-2" role="alert">
            <p class="m-0 text-(length:--fs-14) text-(--text-2)">{{ error }}</p>
            <button hlmBtn qaBtn tone="secondary" size="sm" type="button" (click)="results.reload()">Try again</button>
          </div>
        } @else if (rows().length === 0) {
          @if (ctx.statuses().length || ctx.resultTypes().length) {
            <div class="flex flex-col items-start gap-2">
              <p class="m-0 text-(length:--fs-14) text-(--text-3)">No results match your filters.</p>
              <button hlmBtn qaBtn tone="link" size="sm" flush="start" type="button" (click)="clearFilters()">Clear filters</button>
            </div>
          } @else {
            <p class="m-0 text-(length:--fs-14) text-(--text-3)">This program has no results in this timeline.</p>
          }
        } @else {
          <div class="overflow-x-auto rounded-xl border border-(--border) bg-(--surface)" [attr.aria-busy]="results.isLoading() || null">
            <table class="w-full min-w-[820px] border-collapse text-left">
              <caption class="sr-only">Results of {{ ctx.program()?.code }} in this timeline</caption>
              <thead class="bg-(--surface-3)">
                <tr class="border-b border-(--border)">
                  @for (h of headers; track h) {
                    <th scope="col" class="h-10 px-4 text-(length:--fs-11) font-semibold tracking-[0.06em] whitespace-nowrap text-(--text-muted) uppercase first:pl-5 last:pr-5">
                      {{ h }}
                    </th>
                  }
                </tr>
              </thead>
              <tbody>
                @for (r of rows(); track r.resultCode) {
                  <tr [qaReveal]="$index" class="relative border-b border-(--surface-4) last:border-b-0 hover:bg-(--surface-2)">
                    <td class="py-3 pr-4 pl-5 align-middle">
                      <a
                        [routerLink]="['/sp', 'timelines', activeTimelineId(), 'results', r.resultCode]"
                        [queryParams]="linkParams()"
                        [attr.aria-label]="'Open result ' + r.resultCode"
                        class="font-(family-name:--qa-mono) text-(length:--fs-13) font-semibold whitespace-nowrap text-(--accent) tabular-nums outline-none after:absolute after:inset-0 focus-visible:after:inset-ring-2 focus-visible:after:inset-ring-(--primary)"
                      >{{ r.resultCode }}</a>
                    </td>
                    <td class="max-w-[420px] px-4 py-3 align-middle">
                      <span class="flex min-w-0 items-center gap-2">
                        <span class="min-w-0 text-(length:--fs-14) text-pretty text-(--text)">{{ r.title || 'Untitled result' }}</span>
                        @if (r.updated) {
                          <qa-badge status="submitted" size="sm">Updated</qa-badge>
                        }
                      </span>
                    </td>
                    <td class="px-4 py-3 align-middle text-(length:--fs-13) text-(--text-3)">{{ r.resultType.label }}</td>
                    <td class="px-4 py-3 text-right align-middle font-(family-name:--qa-mono) text-(length:--fs-13) text-(--text) tabular-nums">{{ r.comments }}</td>
                    <td class="px-4 py-3 text-right align-middle font-(family-name:--qa-mono) text-(length:--fs-13) whitespace-nowrap tabular-nums">
                      <span class="font-semibold text-(--text)">{{ r.answered }}</span><span class="text-(--text-4)"> / {{ r.comments }}</span>
                    </td>
                    <td class="px-4 py-3 align-middle">
                      <qa-badge [status]="statusTone(r.status)">{{ statusLabel(r.status) }}</qa-badge>
                    </td>
                    <td class="relative z-10 py-3 pr-5 pl-4 text-right align-middle">
                      <button
                        hlmBtn
                        qaBtn
                        tone="link"
                        size="sm"
                        flush="end"
                        type="button"
                        [loading]="exporting() === r.resultCode"
                        [disabled]="r.comments === 0"
                        [attr.aria-label]="'Export comments of result ' + r.resultCode"
                        (click)="exportComments(r)"
                      >Export comments</button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      }
    </main>
  `,
})
export class SpResultsPage {
  protected readonly ctx = inject(SpContext);
  private readonly api = inject(SpApi);
  private readonly csv = inject(SpCsvDownload);

  protected readonly headers = ['Code', 'Title', 'Type', 'Assessor comments', 'Answered by SP', 'QA status', 'Actions'];
  protected readonly stepStateLabel = STEP_STATE_LABEL;
  protected readonly statusLabel = statusLabel;
  protected readonly statusTone = statusTone;
  protected readonly stepTone = stepTone;
  protected readonly stepWindow = stepWindow;

  protected readonly timelines = rxResource({
    params: () => {
      const programId = this.ctx.programId();
      return programId === null ? undefined : { programParam: this.ctx.programParam(), programId };
    },
    stream: ({ params }) => this.api.timelines(params.programParam),
  });

  protected readonly timelineOptions = computed<readonly QaSelectOption[]>(() =>
    this.timelines.hasValue()
      ? this.timelines.value().timelines.map((t) => ({ value: String(t.id), label: t.name, tag: t.kind === 'official' ? 'Official' : undefined }))
      : [],
  );

  /** The chosen timeline while it is in the list, else the server's default. */
  protected readonly activeTimelineId = computed<number | null>(() => {
    if (!this.timelines.hasValue()) return null;
    const { timelines, defaultTimelineId } = this.timelines.value();
    const chosen = this.ctx.timelineId();
    if (chosen !== null && timelines.some((t) => t.id === chosen)) return chosen;
    return defaultTimelineId ?? timelines[0]?.id ?? null;
  });

  protected readonly timelineValue = computed(() => {
    const id = this.activeTimelineId();
    return id === null ? null : String(id);
  });

  protected readonly results = rxResource({
    params: () => {
      const timelineId = this.activeTimelineId();
      if (timelineId === null || this.ctx.programId() === null) return undefined;
      return { timelineId, programId: this.ctx.programParam(), status: this.ctx.statuses(), resultTypeKey: this.ctx.resultTypes() };
    },
    stream: ({ params }) =>
      this.api.results(params.timelineId, { programId: params.programId, status: params.status, resultTypeKey: params.resultTypeKey }),
  });

  /** The last answer, kept while a new filter loads so the toolbar does not jump. */
  private readonly lastResults = linkedSignal<SpResults | null, SpResults | null>({
    source: () => (this.results.hasValue() ? this.results.value() : null),
    computation: (next, previous) => next ?? previous?.value ?? null,
  });

  protected readonly rows = computed<readonly SpResultRow[]>(() => (this.results.hasValue() ? this.results.value().rows : []));

  protected readonly step = computed(() => {
    const fromResults = this.lastResults()?.step;
    if (fromResults !== undefined && fromResults !== null) return fromResults;
    const id = this.activeTimelineId();
    return this.timelines.hasValue() ? (this.timelines.value().timelines.find((t) => t.id === id)?.step ?? null) : null;
  });

  protected readonly statusOptions = computed<readonly QaMultiSelectOption[]>(() =>
    (this.lastResults()?.options.statuses ?? []).map((o) => ({ value: o.key, label: o.label })),
  );
  protected readonly typeOptions = computed<readonly QaMultiSelectOption[]>(() =>
    (this.lastResults()?.options.resultTypes ?? []).map((o) => ({ value: o.key, label: o.label })),
  );

  protected readonly linkParams = computed(() => {
    const programId = this.ctx.programParam();
    return programId === null ? {} : { programId };
  });

  protected readonly timelinesError = computed(() => {
    const e = this.timelines.error();
    return e ? toApiError(e).message : null;
  });
  protected readonly resultsError = computed(() => {
    const e = this.results.error();
    return e ? toApiError(e).message : null;
  });

  protected readonly exporting = signal<number | null>(null);
  protected readonly exportError = signal<string | null>(null);
  protected readonly exportNotice = signal('');

  protected onTimeline(value: string | null): void {
    if (!value) return;
    this.ctx.timelineId.set(Number(value));
  }

  protected clearFilters(): void {
    this.ctx.statuses.set([]);
    this.ctx.resultTypes.set([]);
  }

  protected async exportComments(row: SpResultRow): Promise<void> {
    const timelineId = this.activeTimelineId();
    if (timelineId === null || this.exporting() !== null) return;
    this.exporting.set(row.resultCode);
    this.exportError.set(null);
    this.exportNotice.set('');
    try {
      await this.csv.download(timelineId, row.resultCode, this.ctx.programParam());
      this.exportNotice.set(`Comments of result ${row.resultCode} exported.`);
    } catch (error) {
      this.exportError.set(`We could not export the comments of result ${row.resultCode}. ${toApiError(error).message}`);
    } finally {
      this.exporting.set(null);
    }
  }
}
