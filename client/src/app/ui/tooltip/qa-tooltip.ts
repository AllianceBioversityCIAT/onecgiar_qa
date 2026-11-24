import { Component, Directive, input } from '@angular/core';
import { BrnTooltip, BrnTooltipPosition, provideBrnTooltipDefaultOptions } from '@spartan-ng/brain/tooltip';
import { injectQaTokens } from '../tokens/qa-tokens';

export type QaTooltipPosition = BrnTooltipPosition;

const QA_TOOLTIP_CLASSES = [
  'qa-tokens z-50 box-border flex w-max max-w-[min(320px,calc(100vw-32px))] flex-col gap-1.5 rounded-xl border border-(--border-raised)',
  'bg-(--surface-raised) p-3 text-(length:--fs-13) leading-[1.55] font-normal text-pretty text-(--text-2) shadow-(--shadow-pop)',
  'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0',
  'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
].join(' ');

/**
 * Hover / focus tooltip styled as the mockup ⓘ popovers (white card, 12px radius, shadow-pop).
 * Accepts plain text or an <ng-template> (use <qa-tooltip-content title="…"> for title + body).
 * Esc closes it; the trigger gets aria-describedby.
 *
 * <button type="button" qaTooltip="CGIAR centers that contributed staff or funding." aria-label="Field documentation">ⓘ</button>
 */
@Directive({
  selector: '[qaTooltip]',
  providers: [
    provideBrnTooltipDefaultOptions({
      showDelay: 150,
      hideDelay: 100,
      position: 'bottom',
      tooltipContentClasses: QA_TOOLTIP_CLASSES,
      arrowClasses: () => 'hidden',
      svgClasses: 'hidden',
    }),
  ],
  hostDirectives: [
    {
      directive: BrnTooltip,
      inputs: [
        'brnTooltip: qaTooltip',
        'position: qaTooltipPosition',
        'tooltipDisabled: qaTooltipDisabled',
        'showDelay',
        'hideDelay',
      ],
      outputs: ['show', 'hide'],
    },
  ],
})
export class QaTooltip {
  constructor() {
    injectQaTokens();
  }
}

/** Title + body layout for rich tooltips, used inside the template passed to [qaTooltip]. */
@Component({
  selector: 'qa-tooltip-content',
  host: { class: 'flex flex-col gap-1.5', '[attr.title]': 'null' },
  template: `
    @if (title()) {
      <span class="text-(length:--fs-14) leading-normal font-semibold text-(--text)">{{ title() }}</span>
    }
    <span class="text-(length:--fs-13) leading-[1.55] font-normal text-pretty text-(--text-2)"><ng-content /></span>
  `,
})
export class QaTooltipContent {
  readonly title = input('');
}

export const QaTooltipImports = [QaTooltip, QaTooltipContent] as const;
