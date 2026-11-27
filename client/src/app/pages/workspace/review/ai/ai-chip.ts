import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { QaBadge, QaBadgeStatus, QaButtonImports } from '../../../../ui';
import { AiChipVm, formatNumber, scoredSignal } from './ai-chip.vm';

const DOT: Readonly<Record<'green' | 'amber' | 'red', string>> = { green: 'var(--success)', amber: 'var(--warning)', red: 'var(--danger)' };

const SIGNAL_BADGE: Readonly<Record<'green' | 'amber' | 'red', QaBadgeStatus>> = {
  green: 'approved',
  amber: 'editing',
  red: 'rejected',
};

/**
 * The AI suggestion of one field (spec assessment/ai-suggestions, FR-6, FR-7). A hint only: it never
 * validates or comments (AC6). "Copy to comment" hands the explanation to the page, which puts it in the
 * comment box for the reviewer to edit and save. `shown` fires once, when the chip first becomes visible.
 */
@Component({
  selector: 'qa-ai-chip',
  imports: [QaBadge, QaButtonImports],
  host: {
    class:
      // Neutral like the rest of the page; the AI is named by a small marked icon, not by a purple box (Juanpa, 2026-11-25,
      // after Notion AI / Copilot / Linear: an AI hint must read as secondary to the human review).
      'flex flex-col gap-4 rounded-lg border border-(--border) bg-(--surface-2) px-5 py-4',
    role: 'group',
    '[attr.aria-label]': '"AI suggestion: " + vm().label',
  },
  template: `
    <!-- Header: who speaks (the AI), its verdict when it gives one, and that it is only a suggestion. -->
    <div class="flex flex-wrap items-center gap-2">
      <span class="flex size-5 flex-none items-center justify-center rounded-md bg-(--ai-tint-2)" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--ai)" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></svg></span>
      <span class="text-(length:--fs-13) font-semibold text-(--text)">AI suggestion</span>
      @switch (vm().kind) {
        @case ('available') {
          <!-- A rated field shows its verdict (Looks consistent / Check / Review); an indicative one has none. -->
          @if (!indicative()) {
            <!-- Same badge as every status in the app: neutral, the verdict colour only in its dot. -->
            <span class="inline-flex items-center gap-1.5 rounded-md bg-(--surface-5) px-2 py-0.5 text-(length:--fs-12) font-medium whitespace-nowrap text-(--text-2)" data-testid="ai-signal">
              @if (dot(); as d) {
                <span class="size-1.5 flex-none rounded-full" [style.background]="d" aria-hidden="true"></span>
              }
              {{ vm().label }}
            </span>
          } @else {
            <!-- Indicative fields give no verdict: a neutral badge in the same place, so every AI card has the same header
                 (Juanpa, 2026-11-26: one card said "Check" and another nothing). -->
            <span class="inline-flex items-center gap-1.5 rounded-md bg-(--surface-5) px-2 py-0.5 text-(length:--fs-12) font-medium whitespace-nowrap text-(--text-2)" data-testid="ai-signal-indicative">
              <span class="size-1.5 flex-none rounded-full bg-(--border-strong)" aria-hidden="true"></span>
              For reference
            </span>
          }
        }
        @default {
          <qa-badge size="sm" status="neutral" data-testid="ai-signal">{{ vm().label }}</qa-badge>
        }
      }
      @if (mark(); as m) {
        <span class="text-(length:--fs-12) text-(--text-3)" data-testid="ai-mark">{{ m }}</span>
      }
      <span class="min-w-0 flex-[1_1_0px]"></span>
      @if (vm().kind === 'available') {
        <span class="text-(length:--fs-12) text-(--text-muted)" data-testid="ai-meta">{{ meta() ?? 'Only a suggestion' }}</span>
      }
      @if (collapsible()) {
        <button
          type="button"
          [attr.aria-label]="expanded() ? 'Hide AI explanation' : 'Show AI explanation'"
          [title]="expanded() ? 'Hide AI explanation' : 'Show AI explanation'"
          [attr.aria-expanded]="expanded()"
          class="flex size-5 flex-none items-center justify-center rounded-md p-0 text-(--text-muted) hover:text-(--text-3) focus-visible:shadow-(--focus-ring) focus-visible:outline-none"
          (click)="expanded.set(!expanded())"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="transition-transform duration-150"
            [class.rotate-180]="expanded()"
            aria-hidden="true"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      }
    </div>

    <!-- Body under the title text (icon 20px + gap 8px): the answer, the reasoning, the evidence, the action. -->
    <div class="flex flex-col gap-3 pl-7 max-sm:pl-0">
    @switch (vm().kind) {
      @case ('available') {
        @if (headline(); as h) {
          <p class="m-0 text-(length:--fs-14) font-semibold text-(--text)">{{ h }}</p>
        }
        @if (indicative(); as ind) {
          @switch (ind.kind) {
            @case ('category') {
              <!-- The AI's value and the reported one side by side, close together, split by a thin vertical line, so they read
                   as a pair to compare (Juanpa, 2026-11-26, proximity). -->
              <div class="flex flex-wrap items-stretch gap-x-5 gap-y-2" data-testid="ai-category">
                <section class="flex min-w-0 flex-col gap-1" aria-label="Suggested by the AI">
                  <h3 class="m-0 text-(length:--fs-12) font-medium text-(--text-3)">Suggested category</h3>
                  <p class="m-0 text-(length:--fs-14) font-semibold text-(--text)">{{ ind.suggested }}</p>
                </section>
                @if (ind.reported; as r) {
                  <span class="w-px flex-none self-stretch bg-(--border)" aria-hidden="true"></span>
                  <section class="flex min-w-0 flex-col gap-1" aria-label="Reported">
                    <h3 class="m-0 text-(length:--fs-12) font-medium text-(--text-3)">Reported category</h3>
                    <p class="m-0 text-(length:--fs-14) font-medium text-(--text-2)">{{ r }}</p>
                  </section>
                }
              </div>
            }
            @case ('use_numbers') {
              <p class="m-0 text-(length:--fs-12) text-(--text-3)" data-testid="ai-covers">
                {{ ind.covers }}
              </p>
              <div class="flex flex-col gap-3 sm:flex-row sm:items-stretch sm:gap-5" data-testid="ai-use-numbers">
                <section class="flex min-w-0 flex-col gap-1" aria-label="Suggested by the AI">
                  <h3
                    class="m-0 text-(length:--fs-12) font-medium text-(--text-3)"
                  >
                    Suggested by the AI
                  </h3>
                  @if (ind.suggested.length === 0) {
                    <p
                      class="m-0 text-(length:--fs-13) text-(--text-2)"
                      data-testid="ai-no-numbers"
                    >
                      The evidence reports no use numbers.
                    </p>
                  } @else {
                    <ul class="m-0 flex list-none flex-col gap-1.5 p-0 text-(length:--fs-13)">
                      @for (row of ind.suggested; track $index) {
                        <li class="text-(--text-2)" data-testid="ai-suggested-row">
                          <span class="font-semibold text-(--text)">{{ fmt(row.quantity) }}</span>
                          {{ row.type }} <span class="text-(--text-3)">({{ row.group }})</span>
                          @if (row.detail) {
                            <span class="block text-(length:--fs-12) text-(--text-3)">{{
                              row.detail
                            }}</span>
                          }
                        </li>
                      }
                    </ul>
                  }
                </section>
                <span class="hidden w-px flex-none self-stretch bg-(--border) sm:block" aria-hidden="true"></span>
                <section class="flex min-w-0 flex-col gap-1" aria-label="Reported">
                  <h3
                    class="m-0 text-(length:--fs-12) font-medium text-(--text-3)"
                  >
                    Reported
                  </h3>
                  @if (ind.reported.length === 0) {
                    <p class="m-0 text-(length:--fs-13) text-(--text-3)">Nothing reported.</p>
                  } @else {
                    <ul class="m-0 flex list-none flex-col gap-1.5 p-0 text-(length:--fs-13)">
                      @for (row of ind.reported; track $index) {
                        <li class="text-(--text-2)" data-testid="ai-reported-row">
                          <span class="font-semibold text-(--text)">{{
                            row.quantity === null ? '—' : fmt(row.quantity)
                          }}</span>
                          {{ row.type }} <span class="text-(--text-3)">({{ row.group }})</span>
                        </li>
                      }
                    </ul>
                  }
                </section>
              </div>
            }
          }
        }
        @if (!collapsible() || expanded()) {
          <!-- pre-line: the worker writes its bullets on separate lines. The reasoning shows in full: the "Show more" cut was
               taken out for now (Juanpa, 2026-11-26). -->
          <p
            [id]="whyId"
            class="m-0 text-(length:--fs-13) leading-[1.55] font-normal whitespace-pre-line text-pretty text-(--text-2)"
            data-testid="ai-explanation"
          >
            {{ explanation() }}
          </p>
        }
        @if (quote(); as q) {
          <blockquote class="m-0 border-l-2 border-(--border-strong) pl-3 text-(length:--fs-13) leading-[1.55] text-(--text-2) italic">
            “{{ q }}”
          </blockquote>
        }
        @if (source(); as src) {
          <p class="m-0 text-(length:--fs-12) text-(--text-3)">
            From the evidence ·
            @if (isLink(src)) {
              <a [href]="src" target="_blank" rel="noopener" class="break-all text-(--text-3) underline underline-offset-2 hover:text-(--text)">{{ src }}<span class="sr-only"> (opens in a new tab)</span></a>
            } @else {
              <span class="break-all">{{ src }}</span>
            }
          </p>
        }
        @if (!readOnly()) {
          <!-- The action says what it does next to it: it starts the reviewer's comment, it changes nothing by itself. -->
          <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-(--border-soft) pt-3">
            <button
              hlmBtn
              qaBtn
              tone="ai"
              size="sm"
              type="button"
              class="-ml-3"
              [attr.aria-describedby]="useId"
              (click)="copyToComment.emit(vm().fieldKey)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" class="flex-none" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2zM12 7v6M9 10h6" /></svg>
              Use as comment
            </button>
            <span [id]="useId" class="text-(length:--fs-12) text-(--text-muted)">Opens your comment with this text. You can edit it before saving.</span>
          </div>
        }
      }
      @case ('unavailable') {
        <p class="m-0 text-(length:--fs-13) text-(--text-3)" data-testid="ai-reason">
          {{ reason() }}
        </p>
      }
    }
    </div>
  `,
})
export class AiChip {
  readonly vm = input.required<AiChipVm>();
  /** Third-Party Broker and ADMIN read it without acting on it. */
  readonly readOnly = input(false);
  readonly copyToComment = output<string>();
  /** Once, when the chip is first visible (or right away where visibility cannot be observed). */
  readonly shown = output<string>();

  protected readonly expanded = signal(false);
  private static seq = 0;
  private readonly uid = ++AiChip.seq;
  protected readonly whyId = `ai-why-${this.uid}`;
  protected readonly useId = `ai-use-${this.uid}`;

  private readonly available = computed(() => {
    const vm = this.vm();
    return vm.kind === 'available' ? vm : null;
  });
  /** Indicative suggestions are neutral: no green, amber or red (contract 2.0.0). */
  protected readonly badge = computed<QaBadgeStatus>(() => {
    const scored = scoredSignal(this.available()?.signal ?? 'indicative');
    return scored === null ? 'neutral' : SIGNAL_BADGE[scored];
  });
  protected readonly indicative = computed(() => this.available()?.indicative ?? null);
  /** Dot colour of the verdict badge (green / amber / red); null for an indicative suggestion. */
  protected readonly dot = computed(() => {
    const scored = scoredSignal(this.available()?.signal ?? 'indicative');
    return scored === null ? null : DOT[scored];
  });
  protected readonly meta = computed(() => this.available()?.meta ?? null);
  protected readonly fmt = formatNumber;
  protected readonly headline = computed(() => this.available()?.headline ?? null);
  protected readonly quote = computed(() => this.available()?.quote ?? null);
  protected readonly explanation = computed(() => this.available()?.explanation ?? '');
  protected readonly source = computed(() => this.available()?.source ?? null);
  protected isLink(value: string): boolean {
    return /^https?:\/\//i.test(value);
  }
  protected readonly mark = computed(() => this.available()?.reviewerMark ?? null);
  /** A green Impact Area hides its explanation behind a toggle; amber, red and the levels show it. */
  protected readonly collapsible = computed(() => {
    const vm = this.available();
    return vm !== null && vm.signal === 'green' && vm.headline === null;
  });
  protected readonly reason = computed(() => {
    const vm = this.vm();
    return vm.kind === 'unavailable' ? vm.reason : '';
  });

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef);
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const emit = () => {
        if (this.vm().kind === 'available') this.shown.emit(this.vm().fieldKey);
      };
      if (typeof IntersectionObserver === 'undefined') {
        emit();
        return;
      }
      const observer = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer.disconnect();
          emit();
        }
      });
      observer.observe(host.nativeElement);
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }
}
