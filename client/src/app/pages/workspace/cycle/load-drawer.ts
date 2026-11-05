import { Component, computed, inject, input, linkedSignal, model, output } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { LoadsApi } from '../../../core/api/loads-api';
import { LoadPreview } from '../../../core/api/loads.models';
import { toApiError } from '../../../core/http/api-envelope';
import { QaButtonImports, QaDrawerImports, QaLoadingImports, QaSelect, QaSelectOption } from '../../../ui';
import { Timeline } from './cycle.mock';
import { formatNumber } from './cycle.logic';
import { skipLabel } from './load.copy';

/** What opens the load drawer: the page button, a timeline menu ("Add results…") or step 1's drawer. */
export interface RunRequest {
  /** View id of the timeline to preselect (`null`: the first one that can load). */
  timelineId: string | null;
  /** Opened from step 1's drawer: shows the "From step" tag. */
  fromStep: boolean;
}

export interface LoadDrawerNames {
  program(id: number, code?: string): string;
  type(key: string): string;
}

/**
 * "Load results into QA": pick a timeline (its step 1 takes the results), see its scope read-only and the
 * server's preview, then start the load. The scope is the timeline's own; the server takes no filters.
 */
@Component({
  selector: 'qa-cycle-load-drawer',
  imports: [QaButtonImports, QaDrawerImports, QaSelect, QaLoadingImports],
  template: `
    <qa-drawer [(open)]="open" title="Load results into QA" subtitle="Brings the results science programs have submitted into step 1 of a timeline. Results already in QA are not affected." width="720px">
      @if (open()) {
        <div class="flex flex-col items-start gap-[6px]">
          <div class="flex items-center gap-1">
            <span class="text-(length:--fs-13) font-semibold text-(--text-2)">Timeline</span>
            @if (fromStep()) {
              <span class="ml-1 rounded-full bg-(--tint-2) px-1.5 py-px text-(length:--fs-10) font-semibold whitespace-nowrap text-(--accent)">From step 1</span>
            }
          </div>
          @if (options().length) {
            <qa-select [(value)]="selectedId" [options]="options()" label="Timeline" placeholder="Select a timeline" panelWidth="440px" class="w-full max-w-[420px]" />
          } @else {
            <p class="m-0 text-(length:--fs-14) text-(--text-3)">No timeline can take results now: step 1 has closed on all of them.</p>
          }
        </div>
        @if (selected(); as t) {
          <dl class="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-(length:--fs-13)">
            <dt class="font-semibold text-(--text-2)">Science programs</dt>
            <dd class="m-0 text-(--text)">{{ t.programs.length ? t.programs.join(', ') : 'All programs' }}</dd>
            <dt class="font-semibold text-(--text-2)">Result types</dt>
            <dd class="m-0 text-(--text)">{{ t.types.length ? t.types.join(', ') : 'All result types' }}</dd>
          </dl>
        }
        <div class="flex items-start gap-[10px] rounded-[8px] bg-(--st-submitted-bg) px-[14px] py-3">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--st-submitted-fg)" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" class="mt-[2px] flex-none" aria-hidden="true"><path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01" /></svg>
          <span class="text-(length:--fs-13) leading-[1.55] font-normal text-pretty text-(--st-submitted-fg)">Only submitted, pooled-funding (W1/W2) results of this cycle within the timeline's scope come in. A result can be in one timeline only. Only one load runs at a time in the cycle.</span>
        </div>

        @if (selected()) {
          @if (preview.isLoading()) {
            <qa-loading label="Loading the preview" class="flex flex-col gap-3">
              <qa-skeleton class="h-5 w-64" />
              @for (i of skeleton; track i) {
                <div class="grid grid-cols-[minmax(0,1fr)_80px] gap-4"><qa-skeleton class="h-4 w-40" /><qa-skeleton class="ml-auto h-4 w-10" /></div>
              }
            </qa-loading>
          } @else if (previewError(); as err) {
            <div role="alert" class="flex flex-wrap items-center gap-3 rounded-[8px] bg-(--st-editing-bg) px-[14px] py-3 text-(length:--fs-13) text-(--st-editing-fg)">
              <span class="min-w-0 flex-1">
                We could not get the preview. {{ err.message }}
                @if (err.reference) {
                  <span class="mt-1 block font-(family-name:--qa-mono) text-(length:--fs-12) break-all">Reference: {{ err.reference }}</span>
                }
              </span>
              <button hlmBtn qaBtn tone="secondary" type="button" (click)="preview.reload()">Try again</button>
            </div>
          } @else if (preview.value(); as p) {
            <section aria-live="polite" class="flex flex-col gap-4">
              <p class="m-0 text-(length:--fs-14) leading-[1.55] text-(--text-2)">
                About <span class="font-(family-name:--qa-mono) font-semibold text-(--text) tabular-nums">{{ fmt(p.toLoad.total) }}</span>
                {{ p.toLoad.total === 1 ? 'result' : 'results' }} will be loaded into step 1 ({{ p.phaseYear }} phase).
                @if (kpTotal(p)) {
                  <br />Knowledge products: <span class="font-(family-name:--qa-mono) font-semibold text-(--text) tabular-nums">{{ fmt(p.kpGroups.review) }}</span> to review,
                  <span class="font-(family-name:--qa-mono) font-semibold text-(--text) tabular-nums">{{ fmt(p.kpGroups.autoChecked + p.kpGroups.notInQa) }}</span> auto-validated (not assessed).
                }
              </p>
              @if (p.window === 'closed') {
                <p role="status" class="m-0 rounded-[8px] bg-(--st-editing-bg) px-3 py-2 text-(length:--fs-13) text-(--st-editing-fg)">Step 1 of this timeline has closed, so no new load can start.</p>
              }
              @if (p.toLoad.byProgram.length) {
                <div class="grid gap-6 sm:grid-cols-2">
                  <div>
                    <h3 class="m-0 mb-1 text-(length:--fs-11) font-semibold tracking-[0.08em] text-(--text-muted) uppercase">By science program</h3>
                    <ul class="m-0 flex list-none flex-col p-0">
                      @for (row of p.toLoad.byProgram; track row.programId) {
                        <li [qaReveal]="$index" class="flex min-h-9 items-center justify-between gap-3 border-b border-(--surface-4)">
                          <span class="min-w-0 truncate text-(length:--fs-13) text-(--text)">{{ names().program(row.programId, row.code) }}</span>
                          <span class="font-(family-name:--qa-mono) text-(length:--fs-13) font-semibold text-(--text) tabular-nums">{{ fmt(row.count) }}</span>
                        </li>
                      }
                    </ul>
                  </div>
                  <div>
                    <h3 class="m-0 mb-1 text-(length:--fs-11) font-semibold tracking-[0.08em] text-(--text-muted) uppercase">By result type</h3>
                    <ul class="m-0 flex list-none flex-col p-0">
                      @for (row of p.toLoad.byResultType; track row.key) {
                        <li [qaReveal]="$index" class="flex min-h-9 items-center justify-between gap-3 border-b border-(--surface-4)">
                          <span class="min-w-0 truncate text-(length:--fs-13) text-(--text)">{{ names().type(row.key) }}</span>
                          <span class="font-(family-name:--qa-mono) text-(length:--fs-13) font-semibold text-(--text) tabular-nums">{{ fmt(row.count) }}</span>
                        </li>
                      }
                    </ul>
                  </div>
                </div>
              } @else {
                <p class="m-0 text-(length:--fs-13) text-(--text-3)">No new submitted results match this timeline right now.</p>
              }
              @if (p.skipped.length) {
                <div>
                  <h3 class="m-0 mb-1 text-(length:--fs-11) font-semibold tracking-[0.08em] text-(--text-muted) uppercase">Will be skipped</h3>
                  <ul class="m-0 flex list-none flex-col p-0">
                    @for (s of p.skipped; track s.reason) {
                      <li class="flex min-h-9 items-center justify-between gap-3 border-b border-(--surface-4)">
                        <span class="min-w-0 text-(length:--fs-13) text-(--text-2)">
                          {{ skip(s.reason) }}
                          @if (s.timelines?.length) {
                            <span class="text-(--text-3)">({{ otherTimelines(s.timelines!) }})</span>
                          }
                        </span>
                        <span class="font-(family-name:--qa-mono) text-(length:--fs-13) font-semibold text-(--text-2) tabular-nums">{{ fmt(s.count) }}</span>
                      </li>
                    }
                  </ul>
                </div>
              }
              <p class="m-0 text-(length:--fs-12) text-(--text-3)">This is an estimate: the load checks every result again and may skip a few more.</p>
            </section>
          }
        }
        @if (error()) {
          <p role="alert" class="m-0 rounded-[8px] bg-(--st-editing-bg) px-3 py-2 text-(length:--fs-13) text-(--st-editing-fg)">{{ error() }}</p>
        }
      }
      <div qaDrawerFooter class="contents">
        <button hlmBtn qaBtn tone="secondary" type="button" (click)="open.set(false)">Cancel</button>
        <button hlmBtn qaBtn tone="primary" type="button" [loading]="busy()" [disabled]="!canStart()" (click)="submit()">Load results</button>
      </div>
    </qa-drawer>
  `,
})
export class LoadDrawer {
  private readonly api = inject(LoadsApi);

  readonly open = model(false);
  readonly request = input.required<RunRequest>();
  /** Timelines that can take a load now (`loadTargets`). */
  readonly targets = input.required<readonly Timeline[]>();
  readonly names = input.required<LoadDrawerNames>();
  /** The start is in flight (spinner, no second tap). */
  readonly busy = input(false);
  /** Why the last start was refused (plain words). */
  readonly error = input<string | null>(null);
  readonly start = output<Timeline>();

  protected readonly fmt = formatNumber;
  protected readonly skip = skipLabel;
  protected readonly skeleton = [0, 1, 2, 3, 4];

  protected readonly selectedId = linkedSignal<string | null>(() => {
    const wanted = this.request().timelineId;
    const list = this.targets();
    return (wanted && list.some((t) => t.id === wanted) ? wanted : list[0]?.id) ?? null;
  });
  protected readonly selected = computed(() => this.targets().find((t) => t.id === this.selectedId()) ?? null);
  protected readonly fromStep = computed(() => this.request().fromStep && this.selectedId() === this.request().timelineId);
  protected readonly options = computed<QaSelectOption[]>(() =>
    this.targets().map((t) => ({ value: t.id, label: t.name, description: `Step 1 · ${t.steps[0]?.name ?? ''}` })),
  );

  /** Server preview of the chosen timeline, fetched only while the drawer is open. */
  protected readonly preview = rxResource<LoadPreview, number | undefined>({
    params: () => (this.open() ? this.selected()?.apiId : undefined),
    stream: ({ params }) => this.api.preview(params),
  });
  protected readonly previewError = computed(() => {
    const e = this.preview.error();
    if (!e) return null;
    const api = toApiError(e);
    return { message: api.message, reference: api.requestId };
  });
  protected readonly canStart = computed(() => {
    const p = this.preview.hasValue() ? this.preview.value() : null;
    return !!this.selected() && !!p && p.window === 'open' && p.toLoad.total > 0 && !this.preview.isLoading();
  });

  protected kpTotal(p: LoadPreview): number {
    return p.kpGroups.notInQa + p.kpGroups.autoChecked + p.kpGroups.review;
  }

  protected otherTimelines(list: readonly { name: string; count: number }[]): string {
    return list.map((t) => `${t.name}: ${formatNumber(t.count)}`).join(', ');
  }

  protected submit(): void {
    const t = this.selected();
    if (t && this.canStart() && !this.busy()) this.start.emit(t);
  }
}
