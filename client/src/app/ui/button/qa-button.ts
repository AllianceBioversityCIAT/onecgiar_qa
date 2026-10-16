import { Directive, effect, inject, input } from '@angular/core';
import { HlmButton } from '@spartan/button';

/**
 * One tone per intent. Pick by what the button does, not by how it should look:
 * - `primary`: the main action of a page, drawer or dialog. One per area ("Invite", "Load results", "Finish").
 * - `secondary`: supporting or exit actions ("Cancel", "Edit timeline", "Guidance"). With `aria-pressed` it works as a toggle.
 * - `danger`: confirms something that deletes or closes ("Remove", "Close timeline").
 * - `danger-quiet`: opens a destructive path without confirming it yet ("Discard all").
 * - `link`: goes somewhere or shows more ("Go to Assessors", "View all cycles", "+3 more").
 * - `ai`: acts on an AI suggestion, in the AI purple so people know where it comes from ("Use as comment").
 */
export type QaButtonTone = 'primary' | 'secondary' | 'danger' | 'danger-quiet' | 'link' | 'ai';

/** `md`: page headers, drawer and dialog footers. `sm`: inside cards, tables and toolbars. */
export type QaButtonSize = 'md' | 'sm';

/** Link only: pulls the side padding out so the label lines up with the text around it. */
export type QaButtonFlush = 'start' | 'end';

const BASE =
  'h-auto rounded-[8px] gap-1.5 whitespace-nowrap no-underline shadow-none max-sm:min-h-10 ' +
  'focus-visible:shadow-(--focus-ring) focus-visible:ring-0 focus-visible:outline-none';

const TONES: Record<QaButtonTone, string> = {
  primary: 'border-transparent bg-(--primary) font-semibold text-(--surface) hover:bg-(--accent) hover:text-(--surface)',
  secondary:
    'border-(--border) bg-(--surface) font-medium text-(--text-2) hover:border-(--border-strong) hover:bg-(--surface-2) hover:text-(--text) ' +
    'aria-pressed:border-(--tint-3) aria-pressed:bg-(--tint) aria-pressed:text-(--accent) aria-pressed:hover:bg-(--tint)',
  danger: 'border-transparent bg-(--danger) font-semibold text-(--surface) hover:bg-(--danger-strong) hover:text-(--surface)',
  'danger-quiet': 'border-(--border) bg-(--surface) font-medium text-(--danger) hover:border-(--danger) hover:bg-(--danger-bg) hover:text-(--danger)',
  link: 'border-transparent bg-transparent font-medium text-(--accent) hover:bg-(--tint) hover:text-(--accent)',
  ai: 'border-(--ai-tint-3) bg-(--surface) font-semibold text-(--ai) hover:border-(--ai-tint-3) hover:bg-(--ai-tint-2) hover:text-(--ai)',
};

const SIZES: Record<QaButtonSize, string> = {
  md: 'min-h-9 px-3.5 text-(length:--fs-14)',
  sm: 'min-h-8 px-3 text-(length:--fs-13)',
};

/** Links keep a tighter side padding (10px) so `flush` can pull it out exactly. */
const LINK_SIZES: Record<QaButtonSize, string> = {
  md: 'min-h-9 px-2.5 text-(length:--fs-14)',
  sm: 'min-h-8 px-2.5 text-(length:--fs-13)',
};

const FLUSH: Record<QaButtonFlush, string> = { start: '-ml-2.5', end: '-mr-2.5' };

export function qaButtonClasses(tone: QaButtonTone, size: QaButtonSize, flush: QaButtonFlush | null): string {
  const sizeClasses = tone === 'link' ? LINK_SIZES[size] : SIZES[size];
  const flushClasses = tone === 'link' && flush ? FLUSH[flush] : '';
  return [BASE, sizeClasses, TONES[tone], flushClasses].join(' ');
}

/**
 * The QA Platform button: spartan's button (a11y, disabled state) with the QA tones and sizes.
 * Always paired with `hlmBtn` (import `QaButtonImports`) instead of hlmBtn plus long class lists. Layout classes (`mr-auto`, `w-full`) still go in `class`.
 *
 * <button hlmBtn qaBtn tone="primary">Load results</button>
 * <button hlmBtn qaBtn tone="secondary">Cancel</button>
 * <a hlmBtn qaBtn tone="link" size="sm" flush="start" routerLink="/assessors">Go to Assessors</a>
 */
@Directive({
  selector: 'button[hlmBtn][qaBtn], a[hlmBtn][qaBtn]',
})
export class QaButton {
  readonly tone = input<QaButtonTone>('secondary');
  readonly size = input<QaButtonSize>('md');
  readonly flush = input<QaButtonFlush | null>(null);

  constructor() {
    const hlm = inject(HlmButton);
    effect(() => hlm.setClass(qaButtonClasses(this.tone(), this.size(), this.flush())));
  }
}

/** Everything a template needs for QA buttons: `hlmBtn` (a11y, disabled) + `qaBtn` (tones and sizes). */
export const QaButtonImports = [HlmButton, QaButton] as const;
