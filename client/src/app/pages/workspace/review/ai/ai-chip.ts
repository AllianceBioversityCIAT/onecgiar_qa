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
import { AiChipVm } from './ai-chip.vm';

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
      'flex flex-col gap-2 rounded-[8px] border border-(--ai-tint-3) bg-(--ai-tint) px-[14px] py-3',
    role: 'group',
    '[attr.aria-label]': '"AI suggestion: " + vm().label',
  },
  template: `
    <div class="flex flex-wrap items-center gap-2">
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--ai)"
        stroke-width="1.9"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="flex-none"
        aria-hidden="true"
      >
        <path
          d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"
        />
      </svg>
      <span class="text-(length:--fs-11) font-semibold tracking-[0.08em] text-(--ai) uppercase"
        >AI suggestion</span
      >
      @switch (vm().kind) {
        @case ('available') {
          <qa-badge size="sm" [status]="badge()" data-testid="ai-signal">
            <span class="size-1.5 rounded-full bg-current" aria-hidden="true"></span
            >{{ vm().label }}
          </qa-badge>
        }
        @default {
          <qa-badge size="sm" status="neutral" data-testid="ai-signal">{{ vm().label }}</qa-badge>
        }
      }
      @if (mark(); as m) {
        <span class="text-(length:--fs-11) text-(--text-3)" data-testid="ai-mark">{{ m }}</span>
      }
      <span class="min-w-0 flex-[1_1_0px]"></span>
      @if (collapsible()) {
        <button
          type="button"
          [attr.aria-label]="expanded() ? 'Hide AI explanation' : 'Show AI explanation'"
          [title]="expanded() ? 'Hide AI explanation' : 'Show AI explanation'"
          [attr.aria-expanded]="expanded()"
          class="flex size-5 flex-none items-center justify-center rounded-[6px] p-0 text-(--text-muted) hover:text-(--text-3) focus-visible:shadow-(--focus-ring) focus-visible:outline-none"
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
    @switch (vm().kind) {
      @case ('available') {
        @if (headline(); as h) {
          <p class="m-0 text-(length:--fs-13) font-semibold text-(--text)">{{ h }}</p>
        }
        @if (quote(); as q) {
          <blockquote
            class="m-0 border-l-2 border-(--ai-tint-3) pl-3 text-(length:--fs-13) leading-[1.55] text-(--text-2) italic"
          >
            “{{ q }}”
          </blockquote>
        }
        @if (!collapsible() || expanded()) {
          <p
            class="m-0 text-(length:--fs-13) leading-[1.55] font-normal text-pretty text-(--text-2)"
            data-testid="ai-explanation"
          >
            {{ explanation() }}
          </p>
        }
        @if (!readOnly()) {
          <div class="flex items-center gap-2 pt-0.5">
            <button
              hlmBtn
              qaBtn
              tone="ai"
              size="sm"
              type="button"
              (click)="copyToComment.emit(vm().fieldKey)"
            >
              Copy to comment
            </button>
          </div>
        }
      }
      @case ('unavailable') {
        <p class="m-0 text-(length:--fs-13) text-(--text-3)" data-testid="ai-reason">
          {{ reason() }}
        </p>
      }
    }
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

  private readonly available = computed(() => {
    const vm = this.vm();
    return vm.kind === 'available' ? vm : null;
  });
  protected readonly badge = computed(() => SIGNAL_BADGE[this.available()?.signal ?? 'green']);
  protected readonly headline = computed(() => this.available()?.headline ?? null);
  protected readonly quote = computed(() => this.available()?.quote ?? null);
  protected readonly explanation = computed(() => this.available()?.explanation ?? '');
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
