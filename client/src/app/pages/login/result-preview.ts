import { Component, DestroyRef, ElementRef, afterNextRender, inject } from '@angular/core';

interface PreviewField {
  readonly label: string;
  readonly value: string;
  readonly comment?: string;
}

const FIELDS: readonly PreviewField[] = [
  { label: 'Title', value: 'Aquaculture feed formulation trialled in Bangladesh' },
  { label: 'Result level', value: 'Output' },
  {
    label: 'Geographic scope',
    value: 'National · Bangladesh',
    comment: 'Add the districts where the trial ran.',
  },
  { label: 'Contributing centers', value: 'WorldFish · IFPRI' },
];

/**
 * Decorative preview of the product: a real-looking result being assessed field by field.
 * Static (all fields resolved) on the server and with reduced motion; gently animated otherwise.
 */
@Component({
  selector: 'app-result-preview',
  host: { 'aria-hidden': 'true', class: 'block' },
  template: `
    <div class="relative">
      <!-- the next results waiting in the batch -->
      <div
        class="absolute inset-x-6 -top-3 h-full rounded-2xl bg-white/60 shadow-[0_8px_24px_-14px_rgb(0_0_0/0.35)]"
      ></div>
      <div
        class="absolute inset-x-3 -top-1.5 h-full rounded-2xl bg-white/80 shadow-[0_8px_24px_-14px_rgb(0_0_0/0.35)]"
      ></div>

      <article
        class="preview-card relative rounded-2xl bg-white p-5 shadow-[0_24px_48px_-24px_rgb(0_0_0/0.4),0_2px_6px_-2px_rgb(0_0_0/0.08)]"
      >
        <header class="flex items-start justify-between gap-3">
          <div>
            <p
              class="font-mono text-[0.6875rem] font-semibold tracking-wide text-[var(--qa-primary)]"
            >
              QA-2026-0821
            </p>
            <p class="mt-1 text-sm font-semibold text-[var(--qa-ink)]">Innovation development</p>
          </div>
          <span
            class="preview-status rounded-full bg-[var(--qa-light)] px-2.5 py-1 text-[0.6875rem] font-medium text-[var(--qa-muted-ink)]"
          >
            In assessment
          </span>
        </header>

        <ul class="mt-4 grid gap-2">
          @for (field of fields; track field.label) {
            <li class="rounded-xl bg-[var(--qa-light)] px-3 py-2.5">
              <div class="flex items-center justify-between gap-3">
                <span class="text-[0.6875rem] font-medium text-[var(--qa-muted-ink)]">{{
                  field.label
                }}</span>
                @if (field.comment) {
                  <span
                    class="preview-verdict inline-flex items-center gap-1 text-[0.6875rem] font-medium text-[var(--qa-accent)]"
                  >
                    <span class="size-1.5 rounded-full bg-current"></span>
                    Comment
                  </span>
                } @else {
                  <span
                    class="preview-verdict inline-flex items-center gap-1 rounded-full bg-[var(--qa-primary-soft)] px-2 py-0.5 text-[0.6875rem] font-medium text-[var(--qa-primary)]"
                  >
                    <svg
                      viewBox="0 0 12 12"
                      class="size-3"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.8"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <path d="m2.5 6.2 2.3 2.3 4.7-5" />
                    </svg>
                    Approved
                  </span>
                }
              </div>
              <p class="mt-1 truncate text-[0.8125rem] text-[var(--qa-ink)]">{{ field.value }}</p>
              @if (field.comment) {
                <p
                  class="preview-comment mt-2 flex overflow-hidden items-start gap-2 border-t border-black/5 pt-2 text-xs text-[var(--qa-muted-ink)]"
                >
                  <span
                    class="grid size-5 shrink-0 place-items-center rounded-full bg-[var(--qa-ink)] text-[0.5625rem] font-semibold text-white"
                  >
                    AS
                  </span>
                  {{ field.comment }}
                </p>
              }
            </li>
          }
        </ul>

        <footer class="mt-4 flex items-center gap-3">
          <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--qa-light)]">
            <div
              class="preview-progress h-full w-full origin-left rounded-full bg-[var(--qa-ink)]/80"
            ></div>
          </div>
          <span class="font-mono text-[0.6875rem] text-[var(--qa-muted-ink)]">
            <span class="preview-count">{{ fields.length }}</span> of {{ fields.length }} resolved
          </span>
        </footer>
      </article>
    </div>
  `,
})
export class ResultPreview {
  protected readonly fields = FIELDS;

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private revert: (() => void) | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.revert?.());
    afterNextRender(() => void this.animate());
  }

  private async animate(): Promise<void> {
    if (
      typeof matchMedia !== 'function' ||
      matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }
    const root = this.host.nativeElement;
    const { createScope, createTimeline, stagger } = await import('animejs');
    const q = <T extends Element>(selector: string) =>
      Array.from(root.querySelectorAll<T>(selector));

    const scope = createScope({ root }).add(() => {
      const verdicts = q<HTMLElement>('.preview-verdict');
      const [comment] = q<HTMLElement>('.preview-comment');
      const [count] = q<HTMLElement>('.preview-count');
      const [status] = q<HTMLElement>('.preview-status');
      const step = 900;
      const total = FIELDS.length;

      const timeline = createTimeline({ loop: true, loopDelay: 2600, delay: 600 })
        .set(verdicts, { opacity: 0, translateX: 6 })
        .set(comment, { opacity: 0, maxHeight: 0, marginTop: 0, paddingTop: 0 })
        .set('.preview-progress', { scaleX: 0 })
        .call(() => {
          count.textContent = '0';
          status.textContent = 'In assessment';
        }, 0)
        .add(
          verdicts,
          { opacity: 1, translateX: 0, duration: 420, ease: 'outCubic', delay: stagger(step) },
          300,
        )
        .add('.preview-progress', { scaleX: [0, 1], duration: step * total, ease: 'linear' }, 300);

      FIELDS.forEach((field, index) => {
        const at = 300 + index * step;
        timeline.call(() => (count.textContent = String(index + 1)), at);
        if (field.comment) {
          timeline.add(
            comment,
            {
              opacity: 1,
              maxHeight: 64,
              marginTop: 8,
              paddingTop: 8,
              duration: 420,
              ease: 'outCubic',
            },
            at + 200,
          );
        }
      });

      timeline
        .call(() => (status.textContent = 'Assessed'), 300 + step * total)
        .add(
          '.preview-card',
          { translateY: [0, -3, 0], duration: 600, ease: 'inOutSine' },
          300 + step * total,
        );
    });

    this.revert = () => scope.revert();
  }
}
