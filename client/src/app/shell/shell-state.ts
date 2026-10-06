import { PLATFORM_ID, Service, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export const SIDEBAR_COLLAPSED_KEY = 'qa.sidebar.collapsed';

/** Sidebar state: collapsed rail on wide screens (remembered) and the mobile drawer. */
@Service()
export class ShellState {
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private readonly collapsedState = signal(this.restore());
  readonly collapsed = this.collapsedState.asReadonly();
  readonly drawerOpen = signal(false);

  toggleCollapsed(): void {
    const next = !this.collapsedState();
    this.collapsedState.set(next);
    this.persist(next);
  }

  private restore(): boolean {
    if (!this.isBrowser) {
      return false;
    }
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
    } catch {
      return false;
    }
  }

  private persist(collapsed: boolean): void {
    if (!this.isBrowser) {
      return;
    }
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
    } catch {
      // Storage blocked (private mode): the choice lasts for this page only.
    }
  }
}
