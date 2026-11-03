import { isPlatformBrowser } from '@angular/common';
import { DestroyRef, PLATFORM_ID, Service, computed, inject, signal } from '@angular/core';
import { CanDeactivateFn } from '@angular/router';
import { AuthSession } from '../auth/auth-session';

const LEAVE_MESSAGE = 'You have unsaved changes. Leave this page and discard them?';

/**
 * One place that knows whether anything on screen is unsaved. Forms and drawers register an
 * `isDirty` check while they live; the browser warns on tab close / reload and the router asks
 * before leaving a workspace view while any of them is dirty.
 */
@Service()
export class UnsavedChanges {
  private readonly checks = signal<readonly (() => boolean)[]>([]);

  readonly anyDirty = computed(() => this.checks().some((isDirty) => isDirty()));

  constructor() {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!this.anyDirty()) return;
      event.preventDefault();
      // Older browsers still need a return value to show their own leave-page dialog.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    inject(DestroyRef).onDestroy(() => window.removeEventListener('beforeunload', onBeforeUnload));
  }

  /** Returns the function that removes the check (call it when the form goes away). */
  register(isDirty: () => boolean): () => void {
    this.checks.update((list) => [...list, isDirty]);
    return () => this.checks.update((list) => list.filter((check) => check !== isDirty));
  }

  /** Asks before throwing work away; true when there is nothing to lose or the user agrees. */
  confirmLeave(): boolean {
    return !this.anyDirty() || window.confirm(LEAVE_MESSAGE);
  }
}

/** Route guard for every workspace view (see `view()` in app.routes.ts). */
// A forced exit (session expired or signed out) never asks: there is no session to save with.
export const unsavedChangesGuard: CanDeactivateFn<unknown> = () =>
  !inject(AuthSession).isSignedIn() || inject(UnsavedChanges).confirmLeave();
