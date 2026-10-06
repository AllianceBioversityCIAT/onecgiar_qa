import { Component, ElementRef, inject, viewChild } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CdkTrapFocus } from '@angular/cdk/a11y';
import { Backdrop } from '../ui/backdrop';
import { ShellState } from './shell-state';
import { Sidebar } from './sidebar';

/** Signed-in layout: glass sidebar and glass content panel floating over the image backdrop. */
@Component({
  selector: 'app-shell-layout',
  imports: [RouterOutlet, CdkTrapFocus, Backdrop, Sidebar],
  host: {
    class: 'relative isolate block min-h-dvh bg-[var(--qa-bg)] transition-colors duration-500',
    '(document:keydown.escape)': 'closeDrawer()',
  },
  template: `
    <app-backdrop />

    <!-- Narrow screens: glass top bar with the menu button -->
    <header
      class="glass sticky top-3 z-30 mx-3 mt-3 flex h-14 items-center gap-2 rounded-2xl px-2 lg:hidden"
    >
      <button
        #opener
        type="button"
        class="grid size-10 place-items-center rounded-xl text-[var(--glass-ink)] transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-[var(--qa-primary-soft)]"
        aria-label="Open navigation"
        aria-controls="nav-drawer"
        [attr.aria-expanded]="state.drawerOpen()"
        (click)="state.drawerOpen.set(true)"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          class="size-5 fill-none stroke-current stroke-[1.75] [stroke-linecap:round]"
        >
          <path d="M4 7h16M4 12h16M4 17h10" />
        </svg>
      </button>
      <span class="font-bold tracking-tight text-[var(--glass-ink)]">PRMS</span>
      <span class="text-sm text-[var(--glass-muted)]">quality assurance</span>
    </header>

    <div class="flex gap-3 p-3">
      <app-sidebar
        class="sticky top-3 hidden h-[calc(100dvh-1.5rem)] shrink-0 lg:block"
        [collapsed]="state.collapsed()"
        (toggle)="state.toggleCollapsed()"
      />
      <main
        class="glass min-h-[calc(100dvh-5.75rem)] min-w-0 flex-1 rounded-[1.75rem] p-6 text-[var(--glass-ink)] sm:p-10 lg:min-h-[calc(100dvh-1.5rem)]"
      >
        <router-outlet />
      </main>
    </div>

    @if (state.drawerOpen()) {
      <div class="fixed inset-0 z-40 lg:hidden">
        <div
          class="drawer-scrim absolute inset-0 bg-[oklch(0.15_0.03_255/0.45)]"
          aria-hidden="true"
          data-testid="drawer-scrim"
          (click)="closeDrawer()"
        ></div>
        <app-sidebar
          id="nav-drawer"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
          class="drawer-panel absolute inset-y-3 left-3 w-72 max-w-[calc(100vw-1.5rem)]"
          drawer
          cdkTrapFocus
          cdkTrapFocusAutoCapture
          (navigated)="closeDrawer()"
          (dismiss)="closeDrawer()"
        />
      </div>
    }
  `,
  styles: `
    @media (prefers-reduced-motion: no-preference) {
      .drawer-scrim {
        animation: fade-in 200ms ease-out;
      }
      .drawer-panel {
        animation: slide-in 320ms cubic-bezier(0.22, 1, 0.36, 1);
      }
    }
    @keyframes fade-in {
      from {
        opacity: 0;
      }
    }
    @keyframes slide-in {
      from {
        opacity: 0;
        translate: -1.5rem 0;
      }
    }
  `,
})
export class ShellLayout {
  protected readonly state = inject(ShellState);
  private readonly opener = viewChild<ElementRef<HTMLButtonElement>>('opener');

  protected closeDrawer(): void {
    if (!this.state.drawerOpen()) {
      return;
    }
    this.state.drawerOpen.set(false);
    this.opener()?.nativeElement.focus();
  }
}
