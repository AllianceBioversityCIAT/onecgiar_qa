import { BooleanInput } from '@angular/cdk/coercion';
import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
import { ConnectedPosition } from '@angular/cdk/overlay';
import { Component, Directive, booleanAttribute, computed, effect, inject, input } from '@angular/core';
import { injectQaTokens } from '../tokens/qa-tokens';

export type QaMenuAlign = 'start' | 'end';

function menuPositions(align: QaMenuAlign): ConnectedPosition[] {
  const other: QaMenuAlign = align === 'start' ? 'end' : 'start';
  return [
    { originX: align, originY: 'bottom', overlayX: align, overlayY: 'top', offsetY: 4 },
    { originX: align, originY: 'top', overlayX: align, overlayY: 'bottom', offsetY: -4 },
    { originX: other, originY: 'bottom', overlayX: other, overlayY: 'top', offsetY: 4 },
    { originX: other, originY: 'top', overlayX: other, overlayY: 'bottom', offsetY: -4 },
  ];
}

/**
 * Opens a `<qa-menu-panel>` template anchored to the host button (CDK menu: aria-haspopup,
 * aria-expanded, Enter/Space/ArrowDown to open, Esc and outside click to close, focus return).
 *
 * <button type="button" [qaMenuTrigger]="actions" qaMenuAlign="end" aria-label="Actions">⋯</button>
 * <ng-template #actions><qa-menu-panel>…</qa-menu-panel></ng-template>
 */
@Directive({
  selector: '[qaMenuTrigger]',
  hostDirectives: [
    {
      directive: CdkMenuTrigger,
      inputs: ['cdkMenuTriggerFor: qaMenuTrigger', 'cdkMenuTriggerData: qaMenuTriggerData'],
      outputs: ['cdkMenuOpened: qaMenuOpened', 'cdkMenuClosed: qaMenuClosed'],
    },
  ],
})
export class QaMenuTrigger {
  private readonly trigger = inject(CdkMenuTrigger, { host: true });
  /** Which edge of the trigger the panel lines up with. */
  readonly align = input<QaMenuAlign>('start', { alias: 'qaMenuAlign' });

  constructor() {
    injectQaTokens();
    effect(() => {
      this.trigger.menuPosition = menuPositions(this.align());
    });
  }
}

/** Inner padding of the panel: compact (row menus) or comfortable (pickers with a search box). */
export type QaMenuDensity = 'compact' | 'comfortable';

/**
 * The floating panel (role="menu", arrow keys / Home / End / typeahead between items).
 * For a panel with its own scrolling list (search box on top, footer below) use
 * density="comfortable" maxHeight="360px" scroll="content" instead of overriding classes.
 */
@Component({
  selector: 'qa-menu-panel',
  hostDirectives: [CdkMenu],
  host: {
    class:
      'qa-tokens box-border flex max-w-[calc(100vw-32px)] flex-col rounded-xl border border-(--border-raised) bg-(--surface-raised) shadow-(--shadow-pop) outline-none animate-in fade-in-0 zoom-in-95 duration-100',
    '[class]': 'layoutClass()',
    '[style.width]': 'width()',
    '[style.max-height]': 'maxHeight()',
  },
  template: `<ng-content />`,
})
export class QaMenuPanel {
  /** CSS width of the panel, e.g. '220px' (mockup row menus) or '280px'. */
  readonly width = input('220px');
  readonly density = input<QaMenuDensity>('compact');
  /** CSS max height. Default: min(420px, viewport - 32px). */
  readonly maxHeight = input<string | null>(null);
  /** 'panel': the whole panel scrolls. 'content': the panel clips and an inner list scrolls. */
  readonly scroll = input<'panel' | 'content'>('panel');

  protected readonly layoutClass = computed(
    () =>
      (this.density() === 'comfortable' ? 'p-3' : 'p-1.5') +
      (this.maxHeight() ? '' : ' max-h-[min(420px,calc(100dvh-32px))]') +
      (this.scroll() === 'content' ? ' overflow-hidden' : ' overflow-y-auto'),
  );
}

export type QaMenuItemVariant = 'default' | 'danger' | 'link';
/** Row height: default 34px, 'tall' 44px for two-line rows, 'compact' 32px. */
export type QaMenuItemSize = 'default' | 'tall' | 'compact';

const ITEM_SIZE: Record<QaMenuItemSize, string> = {
  default: 'min-h-[34px] gap-2.5 px-2.5',
  tall: 'min-h-11 gap-2.5 px-2 py-1.5',
  compact: 'min-h-8 gap-2 px-2',
};
const ITEM_TONE: Record<QaMenuItemVariant, string> = {
  default: 'w-full text-(--text-2) hover:bg-(--surface-3) focus-visible:bg-(--surface-3)',
  danger: 'w-full text-(--danger) hover:bg-(--surface-3) focus-visible:bg-(--surface-3)',
  link: 'w-auto self-start font-medium text-(--accent) hover:bg-(--tint) focus-visible:bg-(--tint)',
};

/** A menu row. Use on a <button>; selection closes the menu. Listen with (triggered). */
@Directive({
  selector: 'button[qaMenuItem]',
  hostDirectives: [
    {
      directive: CdkMenuItem,
      inputs: ['cdkMenuItemDisabled: disabled'],
      outputs: ['cdkMenuItemTriggered: triggered'],
    },
  ],
  host: {
    type: 'button',
    class:
      'flex flex-none cursor-pointer items-center rounded-lg border-0 bg-transparent text-left text-(length:--fs-13) no-underline outline-none focus-visible:shadow-(--focus-ring) disabled:cursor-not-allowed disabled:opacity-50',
    '[class]': 'toneClass()',
    '[attr.disabled]': 'disabled() ? "" : null',
  },
})
export class QaMenuItem {
  readonly variant = input<QaMenuItemVariant>('default');
  readonly size = input<QaMenuItemSize>('default');
  readonly disabled = input<boolean, BooleanInput>(false, { transform: booleanAttribute });

  protected readonly toneClass = computed(() => ITEM_TONE[this.variant()] + ' ' + ITEM_SIZE[this.size()]);
}

/** Small uppercase group label inside a menu panel. size="tall" lines it up with tall items. */
@Directive({
  selector: '[qaMenuLabel]',
  host: {
    role: 'presentation',
    class: 'pt-2 pb-1 text-(length:--fs-10) font-semibold tracking-[0.08em] text-(--text-muted) uppercase',
    '[class]': "size() === 'tall' ? 'px-2' : 'px-2.5'",
  },
})
export class QaMenuLabel {
  readonly size = input<'default' | 'tall'>('default');
}

/** Divider between groups of items. */
@Directive({
  selector: '[qaMenuSeparator]',
  host: { role: 'separator', class: 'my-1 block h-px flex-none bg-(--surface-4)' },
})
export class QaMenuSeparator {}

export const QaMenuImports = [QaMenuTrigger, QaMenuPanel, QaMenuItem, QaMenuLabel, QaMenuSeparator] as const;
