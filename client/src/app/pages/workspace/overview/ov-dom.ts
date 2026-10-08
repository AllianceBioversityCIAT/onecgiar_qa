import { Directive, ElementRef, afterNextRender, inject, input } from '@angular/core';

/** Focuses the host once it is rendered (search box of a popover that just opened). */
@Directive({ selector: '[qaOvAutofocus]' })
export class OvAutofocus {
  constructor() {
    const el = inject<ElementRef<HTMLElement>>(ElementRef);
    afterNextRender(() => el.nativeElement.focus());
  }
}

/** When `qaOvScrollTo` is true on render, scrolls the host to the top of its scrolling list. */
@Directive({ selector: '[qaOvScrollTo]' })
export class OvScrollTo {
  readonly qaOvScrollTo = input(false);

  constructor() {
    const el = inject<ElementRef<HTMLElement>>(ElementRef);
    afterNextRender(() => {
      const host = el.nativeElement;
      const list = host.parentElement;
      if (this.qaOvScrollTo() && list) list.scrollTop = host.offsetTop - 4;
    });
  }
}
