import { Component, DOCUMENT, computed, effect, inject, model, signal, untracked } from '@angular/core';
import { HlmButton } from '@spartan/button';
import { QaDrawerImports, QaMultiSelect } from '../../../ui';
import { commentsEstimate, csvDownload, fmt } from './overview-calc';
import { COMMENTS_BY_PROGRAM, COMMENT_KINDS, RESULT_TYPES } from './overview.mock';

const ALL_KINDS = COMMENT_KINDS.map(([k]) => k);

/** "Download comments": programs, result types and what to include, with a live count. */
@Component({
  selector: 'qa-ov-download-drawer',
  imports: [HlmButton, QaDrawerImports, QaMultiSelect],
  host: { class: 'contents' },
  template: `
    <qa-drawer [(open)]="open" title="Download comments" subtitle="One row per comment, with the field, the author and any reply." width="720px">
      @if (open()) {
        <div class="flex flex-col items-start gap-[6px]">
          <span id="overview-dl-programs-label" class="text-(length:--fs-13) font-semibold text-(--text-2)">Science programs</span>
          <qa-multi-select
            appearance="field"
            [(value)]="programs"
            [options]="programOptions"
            label="Science programs"
            placeholder="All programs"
            searchPlaceholder="Search programs"
            panelWidth="300px"
            listMaxHeight="240px"
            sideOffset="6"
            class="max-sm:w-full"
          />
        </div>
        <div class="flex flex-col items-start gap-[6px]">
          <span id="overview-dl-types-label" class="text-(length:--fs-13) font-semibold text-(--text-2)">Result types</span>
          <qa-multi-select
            appearance="field"
            [(value)]="types"
            [options]="typeOptions"
            label="Result types"
            placeholder="All result types"
            searchPlaceholder="Search result types"
            panelWidth="300px"
            listMaxHeight="240px"
            sideOffset="6"
            class="max-sm:w-full"
          />
        </div>
        <div class="flex flex-col items-start gap-[6px]">
          <span id="overview-dl-include-label" class="text-(length:--fs-13) font-semibold text-(--text-2)">Include</span>
          <qa-multi-select
            appearance="field"
            [(value)]="include"
            [options]="includeOptions"
            label="Include"
            placeholder="Nothing"
            [searchable]="false"
            panelWidth="300px"
            listMaxHeight="240px"
            sideOffset="6"
            class="max-sm:w-full"
          />
        </div>

        @let e = estimate();
        <div aria-live="polite" class="rounded-[8px] bg-(--surface-3) px-[14px] py-3 text-(length:--fs-13) leading-[1.55] font-normal text-(--text-2)">
          <span class="font-(family-name:--qa-mono) font-semibold tabular-nums text-(--text)">{{ n(e.total) }}</span> {{ e.total === 1 ? 'comment' : 'comments' }} across
          <span class="font-(family-name:--qa-mono) font-semibold tabular-nums text-(--text)">{{ n(e.rows.length) }}</span>
          {{ e.rows.length === 1 ? 'science program' : 'science programs' }}.
          @if (e.unpublished > 0) {
            <span class="font-(family-name:--qa-mono) font-semibold tabular-nums text-(--text)">{{ n(e.unpublished) }}</span> of them are not published to their program yet and will be marked in the file.
          } @else if (e.total > 0) {
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
          class="h-auto min-h-9 rounded-[8px] border-(--border) bg-(--field-bg) px-[14px] text-(length:--fs-14) font-medium text-(--text-2) shadow-none hover:border-(--border-strong) hover:bg-(--surface-2) hover:text-(--text-2) focus-visible:shadow-(--focus-ring) focus-visible:ring-0"
        >Cancel</button>
        <button
          hlmBtn
          type="button"
          (click)="download()"
          class="h-auto min-h-9 rounded-[8px] border-0 bg-(--primary) px-[14px] text-(length:--fs-14) font-semibold text-(--surface) hover:bg-(--accent) focus-visible:shadow-(--focus-ring) focus-visible:ring-0"
        >Download .xlsx</button>
      </div>
    </qa-drawer>
  `,
})
export class OvDownloadDrawer {
  private readonly doc = inject(DOCUMENT);

  readonly open = model(false);

  protected readonly programs = signal<readonly string[]>([]);
  protected readonly types = signal<readonly string[]>([]);
  protected readonly include = signal<readonly string[]>(ALL_KINDS);

  protected readonly programOptions = COMMENTS_BY_PROGRAM.map((p) => ({ value: p.code, label: p.code + ' ' + p.name }));
  protected readonly typeOptions = RESULT_TYPES.map(([t]) => ({ value: t, label: t }));
  protected readonly includeOptions = ALL_KINDS.map((k) => ({ value: k, label: k }));

  protected readonly estimate = computed(() => commentsEstimate(this.programs(), this.types(), this.include()));
  protected readonly n = fmt;

  constructor() {
    effect(() => {
      if (this.open()) {
        untracked(() => {
          this.programs.set([]);
          this.types.set([]);
          this.include.set(ALL_KINDS);
        });
      }
    });
  }

  protected download(): void {
    // TODO(api): ask the server for the real .xlsx (one row per comment). The mockup saves a CSV summary.
    csvDownload(this.doc, 'comments.csv', [['Science program', 'Comments'], ...this.estimate().rows.map((r) => [r.code, r.n])]);
    this.open.set(false);
  }
}
