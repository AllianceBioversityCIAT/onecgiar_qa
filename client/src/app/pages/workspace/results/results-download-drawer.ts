import { DecimalPipe } from '@angular/common';
import { Component, computed, input, linkedSignal, model } from '@angular/core';
import { HlmButtonImports } from '@spartan/button';
import { QaDrawerImports, QaMultiSelect } from '../../../ui';
import {
  ANNUAL_TOTAL,
  ANNUAL_TYPE_COUNTS,
  DL_INCLUDE,
  DL_INCLUDE_WEIGHTS,
  DL_PROGRAMS,
  PUBLISHED_PROGRAMS,
  RESULT_TYPES,
} from './results.mock';

/** "Download comments" drawer: pick programs, result types and what to include; shows a live estimate. */
@Component({
  selector: 'qa-results-download-drawer',
  imports: [QaDrawerImports, HlmButtonImports, QaMultiSelect, DecimalPipe],
  template: `
    <qa-drawer
      [(open)]="open"
      title="Download comments"
      subtitle="One row per comment, with the field, the author and any reply."
      width="720px"
    >
      @if (open()) {
        <div class="flex max-w-full flex-col items-start gap-1.5">
          <span class="text-(length:--fs-13) font-semibold text-(--text-2)">Science programs</span>
          <qa-multi-select
            appearance="field"
            [(value)]="programs"
            label="Science programs"
            [options]="programOptions"
            placeholder="All programs"
            searchPlaceholder="Search programs"
            emptyText="Nothing matches that search."
            panelWidth="300px"
          />
        </div>
        <div class="flex max-w-full flex-col items-start gap-1.5">
          <span class="text-(length:--fs-13) font-semibold text-(--text-2)">Result types</span>
          <qa-multi-select
            appearance="field"
            [(value)]="types"
            label="Result types"
            [options]="typeOptions"
            placeholder="All result types"
            searchPlaceholder="Search result types"
            emptyText="Nothing matches that search."
            panelWidth="300px"
          />
        </div>
        <div class="flex max-w-full flex-col items-start gap-1.5">
          <span class="text-(length:--fs-13) font-semibold text-(--text-2)">Include</span>
          <qa-multi-select
            appearance="field"
            [(value)]="include"
            label="Include"
            [options]="includeOptions"
            placeholder="Nothing"
            [searchable]="false"
            emptyText="Nothing matches that search."
            panelWidth="300px"
          />
        </div>
        <div aria-live="polite" class="rounded-lg bg-(--surface-3) px-[14px] py-3 text-(length:--fs-13) leading-[1.55] text-(--text-2)">
          <span class="font-(family-name:--qa-mono) tabular-nums font-semibold text-(--text)">{{ summary().total | number }}</span>
          {{ summary().total === 1 ? 'comment' : 'comments' }} across
          <span class="font-(family-name:--qa-mono) tabular-nums font-semibold text-(--text)">{{ summary().programs | number }}</span>
          {{ summary().programs === 1 ? 'science program' : 'science programs' }}.
          @if (summary().unpublished > 0) {
            <span class="font-(family-name:--qa-mono) tabular-nums font-semibold text-(--text)">{{ summary().unpublished | number }}</span>
            of them are not published to their program yet and will be marked in the file.
          } @else if (summary().total > 0) {
            All of them are published to their program.
          }
        </div>
      }
      <div qaDrawerFooter class="contents">
        <button
          hlmBtn
          variant="outline"
          type="button"
          (click)="open.set(false)"
          class="h-9 gap-[7px] rounded-lg border-(--border) bg-(--field-bg) px-3 text-(length:--fs-14) font-medium text-(--text-2) shadow-none hover:border-(--border-strong) hover:bg-(--field-bg) hover:text-(--text-2) focus-visible:border-(--border-strong) focus-visible:ring-0 focus-visible:shadow-(--focus-ring) h-auto min-h-9 px-[14px] hover:bg-(--surface-2)"
        >Cancel</button>
        <button
          hlmBtn
          type="button"
          (click)="download()"
          class="h-auto min-h-9 rounded-lg border-none bg-(--primary) px-[14px] text-(length:--fs-14) font-semibold text-(--surface) hover:bg-(--accent) focus-visible:ring-0 focus-visible:shadow-(--focus-ring)"
        >Download .xlsx</button>
      </div>
    </qa-drawer>
  `,
})
export class ResultsDownloadDrawer {
  readonly open = model(false);
  /** Programs pre-selected when the drawer opens (the page's Science program filter). */
  readonly presetPrograms = input<readonly string[]>([]);

  protected readonly programOptions = DL_PROGRAMS.map((p) => ({ value: p.code, label: `${p.code} ${p.name}` }));
  protected readonly typeOptions = RESULT_TYPES.map((t) => ({ value: t, label: t }));
  protected readonly includeOptions = DL_INCLUDE.map((t) => ({ value: t, label: t }));

  // Each time the drawer opens, the form starts again from the page filters (as in the mockup).
  protected readonly programs = linkedSignal<readonly string[]>(() =>
    this.open() ? this.presetPrograms().filter((p) => DL_PROGRAMS.some((d) => d.code === p)) : [],
  );
  protected readonly types = linkedSignal<boolean, readonly string[]>({ source: this.open, computation: () => [] });
  protected readonly include = linkedSignal<boolean, readonly string[]>({
    source: this.open,
    computation: () => [...DL_INCLUDE],
  });

  /** Estimate of the file (mockup dlFactor / dlCount). */
  protected readonly summary = computed(() => {
    const types = this.types();
    const typeShare = types.length
      ? Math.min(1, (types.reduce((a, t) => a + (ANNUAL_TYPE_COUNTS[t as keyof typeof ANNUAL_TYPE_COUNTS] ?? 0), 0) / ANNUAL_TOTAL) * 1.4)
      : 1;
    const include = this.include();
    const factor = typeShare * DL_INCLUDE.reduce((a, name, i) => a + (include.includes(name) ? DL_INCLUDE_WEIGHTS[i] : 0), 0);
    const sel = this.programs();
    const progs = DL_PROGRAMS.filter((p) => !sel.length || sel.includes(p.code))
      .map((p) => ({ code: p.code, n: Math.round(p.comments * factor) }))
      .filter((p) => p.n > 0);
    return {
      total: progs.reduce((a, p) => a + p.n, 0),
      programs: progs.length,
      unpublished: progs.filter((p) => !PUBLISHED_PROGRAMS.includes(p.code)).reduce((a, p) => a + p.n, 0),
    };
  });

  protected download(): void {
    // TODO(api): request the comments file (.xlsx) for programs(), types() and include() and download it.
    this.open.set(false);
  }
}
