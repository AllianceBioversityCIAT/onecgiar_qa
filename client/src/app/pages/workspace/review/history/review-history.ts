import { Component, computed, input, signal } from '@angular/core';
import { QaBadge, QaButtonImports, QaDrawerImports, QaSegmented, QaSegmentedOption, QaTabsImports } from '../../../../ui';
import {
  HISTORY_GROUP,
  HISTORY_STEPS,
  HistoryEntry,
  HistoryGroup,
  HistoryKind,
  RESULT_HISTORY,
  RESULT_LOADS,
} from './result-history.mock';

type Tone = 'indigo' | 'approved' | 'editing' | 'danger' | 'neutral' | 'qa';

interface KindLook {
  /** Words around the field: "{actor} commented on {field}". */
  readonly before: string;
  readonly after?: string;
  readonly tone: Tone;
  /** SVG path(s) of a 24×24 stroke icon. */
  readonly icon: string;
}

const ICON = {
  comment: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  check: 'M20 6L9 17l-5-5',
  undo: 'M3 7v6h6M21 17a9 9 0 0 0-15-6.7L3 13',
  reply: 'M9 17l-5-5 5-5M20 18v-2a4 4 0 0 0-4-4H4',
  question: 'M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6',
  up: 'M7 17L17 7M8 7h9v9',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  inbox: 'M22 12h-6l-2 3h-4l-2-3H2M5.5 5h13l3.5 7v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z',
  status: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  minus: 'M5 12h14M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z',
} as const;

const LOOK: Readonly<Record<HistoryKind, KindLook>> = {
  load: { before: 'loaded the result into QA', tone: 'qa', icon: ICON.inbox },
  status: { before: 'changed the status', tone: 'neutral', icon: ICON.status },
  comment: { before: 'commented on', tone: 'indigo', icon: ICON.comment },
  withdrawn: { before: 'withdrew their comment on', tone: 'neutral', icon: ICON.minus },
  validation: { before: 'validated', tone: 'approved', icon: ICON.check },
  undo: { before: 'undid the validation of', tone: 'neutral', icon: ICON.undo },
  'program-accepted': { before: 'accepted the comment on', tone: 'editing', icon: ICON.reply },
  'program-rejected': { before: 'rejected the comment on', tone: 'editing', icon: ICON.reply },
  'clarification-request': { before: 'asked for a clarification on', tone: 'editing', icon: ICON.question },
  'clarification-answer': { before: 'answered the clarification on', tone: 'indigo', icon: ICON.question },
  deleted: { before: 'deleted a comment on', tone: 'danger', icon: ICON.trash },
  'lead-agree': { before: 'agreed with the program on', tone: 'approved', icon: ICON.check },
  'lead-escalate': { before: 'escalated', after: 'to the third-party broker', tone: 'indigo', icon: ICON.up },
  'tpb-agreed': { before: 'agreed with the program on', tone: 'approved', icon: ICON.check },
  'tpb-changes': { before: 'required changes on', tone: 'editing', icon: ICON.edit },
  'ppu-done': { before: 'marked', after: 'as done', tone: 'approved', icon: ICON.check },
};

const TONE_CLASS: Readonly<Record<Tone, string>> = {
  indigo: 'bg-(--st-indigo-bg) text-(--st-indigo-fg)',
  approved: 'bg-(--st-approved-bg) text-(--st-approved-fg)',
  editing: 'bg-(--st-editing-bg) text-(--st-editing-fg)',
  danger: 'bg-(--danger-soft) text-(--danger)',
  neutral: 'bg-(--surface-4) text-(--text-3)',
  qa: 'bg-(--st-qa-bg) text-(--st-qa-fg)',
};

/** What the entry's quote box is called, for screen readers and the eyebrow. */
const QUOTE_LABEL: Partial<Readonly<Record<HistoryKind, string>>> = {
  comment: 'Comment',
  withdrawn: 'Withdrawn comment',
  'program-accepted': "Program's answer",
  'program-rejected': "Program's answer",
  'clarification-request': 'Question',
  'clarification-answer': 'Answer',
  'lead-agree': "Lead assessor's comment",
  'lead-escalate': "Lead assessor's comment",
  'tpb-agreed': "Broker's note",
  'tpb-changes': 'Note for the PPU',
  'ppu-done': "PPU's note",
};

/**
 * P2-3915, Traceability: everything that happened to a result in QA, read only. A "History" button that opens a
 * drawer with two tabs: Activity (by step, oldest first) and Data at load (step 1 against step 3).
 * Design only, sample data (`result-history.mock.ts`).
 */
@Component({
  selector: 'qa-review-history',
  imports: [QaBadge, QaButtonImports, QaDrawerImports, QaSegmented, QaTabsImports],
  host: { class: 'contents' },
  template: `
    <button hlmBtn qaBtn tone="secondary" size="sm" type="button" aria-haspopup="dialog" (click)="open.set(true)">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" class="flex-none" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></svg>
      History
    </button>

    <qa-drawer [(open)]="open" title="History" [subtitle]="code() + ' · Everything that happened to this result in QA. Read only.'" width="720px">
      <div qaTabs [(value)]="tab" class="-mt-1 gap-5">
        <div qaTabList aria-label="History">
          <button qaTab="activity">Activity <span qaTabCount>{{ entries.length }}</span></button>
          <button qaTab="loads">Data at load</button>
        </div>

        <div qaTabPanel="activity" class="flex flex-col gap-5">
          <qa-segmented [(value)]="filter" [options]="filterOptions()" size="compact" aria-label="Show" />

          @for (s of steps(); track s.key) {
            <section [attr.aria-labelledby]="'history-step-' + s.key" class="flex flex-col gap-3">
              <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-(--surface-4) pb-2">
                <h3 [id]="'history-step-' + s.key" class="m-0 text-(length:--fs-14) font-bold text-(--text)">{{ s.name }}</h3>
                <span class="text-(length:--fs-12) text-(--text-3) tabular-nums">{{ s.dates }}</span>
              </div>
              <ol class="m-0 flex list-none flex-col p-0">
                @for (e of s.entries; track e.id; let last = $last) {
                  @let look = lookOf(e.kind);
                  <li class="relative grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3 pb-4">
                    @if (!last) {
                      <span class="absolute top-8 bottom-0 left-[13px] w-px bg-(--border)" aria-hidden="true"></span>
                    }
                    <span class="flex size-7 items-center justify-center rounded-full" [class]="toneClass(look.tone)" aria-hidden="true">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path [attr.d]="look.icon" /></svg>
                    </span>
                    <div class="flex min-w-0 flex-col gap-1.5 pt-1">
                      <p class="m-0 text-(length:--fs-14) leading-[1.45] text-pretty text-(--text-2)">
                        <span class="font-semibold text-(--text)">{{ e.actor.name }}</span>
                        @if (e.actor.nickname) {
                          <span class="text-(--text-3)"> ({{ e.actor.nickname }})</span>
                        }
                        {{ look.before }}
                        @if (e.field) {
                          <span class="font-semibold text-(--text)">{{ e.field }}</span>
                        }
                        @if (look.after) {
                          {{ look.after }}
                        }
                      </p>
                      <p class="m-0 text-(length:--fs-12) text-(--text-3)">
                        {{ e.actor.role }} · <time [attr.datetime]="e.at">{{ e.when }}</time>
                      </p>

                      @if (e.kind === 'status' && e.from && e.to) {
                        <p class="m-0 flex flex-wrap items-center gap-1.5">
                          <span class="sr-only">From</span>
                          <qa-badge status="neutral" size="sm">{{ e.from }}</qa-badge>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                          <span class="sr-only">to</span>
                          <qa-badge [status]="e.to === 'Quality assessed' ? 'approved' : 'indigo'" size="sm">{{ e.to }}</qa-badge>
                        </p>
                      }
                      @if (e.load) {
                        <p class="m-0 text-(length:--fs-13) text-(--text-2)">{{ e.load }}</p>
                      }
                      @if (e.text && e.kind !== 'deleted') {
                        <div class="flex flex-col gap-1 rounded-[8px] bg-(--surface-3) px-3 py-2" [class.opacity-80]="e.kind === 'withdrawn'">
                          <span class="text-(length:--fs-11) font-semibold text-(--text-3)">{{ quoteLabel(e.kind) }}</span>
                          <p class="m-0 text-(length:--fs-13) leading-[1.5] text-pretty wrap-anywhere text-(--text)">{{ e.text }}</p>
                          @if (e.valueThen) {
                            <p class="m-0 text-(length:--fs-12) leading-[1.5] wrap-anywhere text-(--text-3)">
                              Value then: <span class="text-(--text-2)">{{ e.valueThen }}</span>
                            </p>
                          }
                        </div>
                      }
                      @if (e.deleted; as d) {
                        <p class="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-(length:--fs-12) text-(--text-3)">
                          <qa-badge status="rejected" size="sm">Deleted</qa-badge>
                          <span>by {{ d.by.name }} ({{ d.by.nickname }}) · <time [attr.datetime]="d.at">{{ d.when }}</time></span>
                        </p>
                      }
                    </div>
                  </li>
                }
              </ol>
            </section>
          } @empty {
            <p class="m-0 text-(length:--fs-13) text-(--text-3)">Nothing of this kind happened to this result yet.</p>
          }
        </div>

        <div qaTabPanel="loads" class="flex flex-col gap-4 @container">
          <p class="m-0 text-(length:--fs-13) leading-[1.5] text-(--text-2)">
            What the result said when it was loaded in step 1, on <time [attr.datetime]="loads.step1.at">{{ loads.step1.when }}</time>, and in step 3, on
            <time [attr.datetime]="loads.step3.at">{{ loads.step3.when }}</time>.
          </p>
          <qa-segmented [(value)]="loadFilter" [options]="loadOptions" size="compact" aria-label="Fields" />
          <ul class="m-0 flex list-none flex-col gap-3 p-0">
            @for (f of loadRows(); track f.label) {
              <li class="flex flex-col gap-2.5 rounded-[10px] border border-(--border) p-4" [class]="f.changed ? 'border-l-[3px] border-l-(--accent)' : ''">
                <div class="flex flex-wrap items-center gap-2">
                  <h4 class="m-0 text-(length:--fs-13) font-bold text-(--text)">{{ f.label }}</h4>
                  @if (f.changed) {
                    <qa-badge status="indigo" size="sm">Changed</qa-badge>
                  }
                </div>
                <dl class="m-0 grid grid-cols-1 gap-3 @lg:grid-cols-2">
                  <div class="flex min-w-0 flex-col gap-0.5">
                    <dt class="text-(length:--fs-11) font-semibold text-(--text-3)">Step 1</dt>
                    <dd class="m-0 text-(length:--fs-13) leading-[1.5] wrap-anywhere text-(--text-2)">{{ f.step1 }}</dd>
                  </div>
                  <div class="flex min-w-0 flex-col gap-0.5">
                    <dt class="text-(length:--fs-11) font-semibold text-(--text-3)">Step 3</dt>
                    <dd class="m-0 text-(length:--fs-13) leading-[1.5] wrap-anywhere" [class]="f.changed ? 'font-medium text-(--text)' : 'text-(--text-2)'">{{ f.step3 }}</dd>
                  </div>
                </dl>
              </li>
            }
          </ul>
        </div>
      </div>
    </qa-drawer>
  `,
})
export class ReviewHistory {
  /** Result code shown in the drawer subtitle ("QA-2026-0841"). */
  readonly code = input.required<string>();

  protected readonly open = signal(false);
  protected readonly tab = signal('activity');
  protected readonly filter = signal<string | null>('all');
  protected readonly loadFilter = signal<string | null>('all');

  protected readonly entries = RESULT_HISTORY;
  protected readonly loads = RESULT_LOADS;

  protected readonly filterOptions = computed<readonly QaSegmentedOption[]>(() => {
    const count = (g: HistoryGroup) => this.entries.filter((e) => HISTORY_GROUP[e.kind] === g).length;
    return [
      { value: 'all', label: 'All', count: this.entries.length },
      { value: 'comments', label: 'Comments', count: count('comments') },
      { value: 'decisions', label: 'Decisions', count: count('decisions') },
      { value: 'status', label: 'Status', count: count('status') },
    ];
  });

  /** The steps that have entries under the chosen filter, each with its entries, oldest first. */
  protected readonly steps = computed(() => {
    const f = this.filter();
    const shown = (e: HistoryEntry) => f === 'all' || f === null || HISTORY_GROUP[e.kind] === f;
    return HISTORY_STEPS.map((s) => ({ ...s, entries: this.entries.filter((e) => e.step === s.key && shown(e)) })).filter((s) => s.entries.length > 0);
  });

  private readonly loadFields = RESULT_LOADS.fields.map((f) => ({ ...f, changed: f.step1 !== f.step3 }));

  protected readonly loadOptions: readonly QaSegmentedOption[] = [
    { value: 'all', label: 'All fields', count: this.loadFields.length },
    { value: 'changed', label: 'Changed', count: this.loadFields.filter((f) => f.changed).length },
  ];

  protected readonly loadRows = computed(() => (this.loadFilter() === 'changed' ? this.loadFields.filter((f) => f.changed) : this.loadFields));

  protected lookOf(kind: HistoryKind): KindLook {
    return LOOK[kind];
  }

  protected toneClass(tone: Tone): string {
    return TONE_CLASS[tone];
  }

  protected quoteLabel(kind: HistoryKind): string {
    return QUOTE_LABEL[kind] ?? 'Note';
  }
}
