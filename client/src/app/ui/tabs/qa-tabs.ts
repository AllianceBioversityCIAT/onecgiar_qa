import { BooleanInput } from '@angular/cdk/coercion';
import { Directive, booleanAttribute, computed, inject, input } from '@angular/core';
import { BrnTabs, BrnTabsContent, BrnTabsList, BrnTabsTrigger } from '@spartan-ng/brain/tabs';

/** `underline`: Cycle "Live / Closed" tabs. `segmented`: Overview "Group the work" pill tabs. */
export type QaTabsVariant = 'underline' | 'segmented';

/**
 * Tabs root (BrnTabs: role="tablist"/"tab"/"tabpanel", arrow keys, aria wiring).
 *
 * <div qaTabs [(value)]="tab">
 *   <div qaTabList aria-label="Timelines">
 *     <button qaTab="live">Live <span qaTabCount>3</span></button>
 *     <button qaTab="closed">Closed <span qaTabCount>14</span></button>
 *   </div>
 *   <div qaTabPanel="live">…</div>
 *   <div qaTabPanel="closed">…</div>
 * </div>
 */
@Directive({
  selector: '[qaTabs],qa-tabs',
  hostDirectives: [
    {
      directive: BrnTabs,
      inputs: ['brnTabs: value', 'activationMode'],
      outputs: ['brnTabsChange: valueChange', 'tabActivated'],
    },
  ],
  host: { class: 'flex flex-col' },
})
export class QaTabs {
  readonly variant = input<QaTabsVariant>('underline');
}

@Directive({
  selector: '[qaTabList],qa-tab-list',
  hostDirectives: [BrnTabsList],
  host: { '[class]': 'listClass()' },
})
export class QaTabList {
  private readonly tabs = inject(QaTabs);
  protected readonly listClass = computed(() =>
    this.tabs.variant() === 'segmented'
      ? 'box-border flex h-8 max-w-full gap-[2px] self-start overflow-x-auto rounded-[8px] bg-(--seg-track) p-[3px]'
      : 'flex min-h-10 items-center gap-6 overflow-x-auto overflow-y-hidden border-b border-(--border)',
  );
}

@Directive({
  selector: 'button[qaTab]',
  hostDirectives: [{ directive: BrnTabsTrigger, inputs: ['brnTabsTrigger: qaTab', 'disabled'] }],
  host: {
    type: 'button',
    '[class]': 'tabClass()',
  },
})
export class QaTab {
  private readonly tabs = inject(QaTabs);
  private readonly trigger = inject(BrnTabsTrigger);
  readonly qaTab = input.required<string>();
  readonly disabled = input<boolean, BooleanInput>(false, { transform: booleanAttribute });

  protected readonly tabClass = computed(() => {
    const active = this.trigger.selected();
    const common =
      'group flex flex-none cursor-pointer items-center gap-[7px] whitespace-nowrap outline-none focus-visible:shadow-(--focus-ring) disabled:cursor-not-allowed disabled:opacity-50';
    if (this.tabs.variant() === 'segmented') {
      return `${common} h-[26px] rounded-[6px] border-0 px-[14px] text-(length:--fs-13) ${
        active
          ? 'bg-(--seg-active) font-semibold text-(--text) shadow-(--shadow-seg)'
          : 'bg-transparent font-medium text-(--text-4) hover:text-(--text-2)'
      }`;
    }
    return `${common} box-border h-10 border-0 border-b-2 border-solid bg-transparent p-0 text-(length:--fs-14) ${
      active ? 'border-(--primary) font-semibold text-(--text)' : 'border-transparent font-medium text-(--text-3) hover:text-(--text)'
    }`;
  });
}

/** Mono count next to a tab label ("Live 3"). */
@Directive({
  selector: '[qaTabCount]',
  host: {
    class:
      'font-(family-name:--qa-mono) text-(length:--fs-12) font-semibold tabular-nums text-(--text-muted) group-aria-selected:text-(--text-3)',
  },
})
export class QaTabCount {}

@Directive({
  selector: '[qaTabPanel]',
  hostDirectives: [{ directive: BrnTabsContent, inputs: ['brnTabsContent: qaTabPanel'] }],
  host: { class: 'outline-none focus-visible:shadow-(--focus-ring)' },
})
export class QaTabPanel {}

export const QaTabsImports = [QaTabs, QaTabList, QaTab, QaTabCount, QaTabPanel] as const;
