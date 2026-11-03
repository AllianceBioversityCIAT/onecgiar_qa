import { DestroyRef, Signal, WritableSignal, inject, signal } from '@angular/core';
import { UnsavedChanges } from '../../core/forms/unsaved-changes';
import { QaDrawerCloseGuard } from './qa-drawer';

export interface DiscardGuard {
  /** True while the drawer asks "Discard what you wrote?". */
  readonly confirming: Signal<boolean>;
  /** Pass to `<qa-drawer [closeGuard]>`: Esc, overlay click and X ask first when there is input. */
  readonly guard: QaDrawerCloseGuard;
  /** Cancel button: same question as Esc / X. */
  requestClose(): void;
  keepWriting(): void;
  discard(): void;
}

/**
 * "Discard what you wrote?" for an editing drawer, from the assessor drawer pattern, so every
 * drawer asks the same way. While the drawer is open with input, the page also counts as unsaved
 * (tab close / reload / leaving the view ask first). Call it in a field initializer.
 */
export function discardGuard(open: WritableSignal<boolean>, isDirty: () => boolean): DiscardGuard {
  const confirming = signal(false);
  const unregister = inject(UnsavedChanges).register(() => open() && isDirty());
  inject(DestroyRef).onDestroy(unregister);

  const guard: QaDrawerCloseGuard = () => {
    if (isDirty() && !confirming()) {
      confirming.set(true);
      return false;
    }
    confirming.set(false);
    return true;
  };

  return {
    confirming: confirming.asReadonly(),
    guard,
    requestClose: () => {
      if (guard() === true) open.set(false);
    },
    keepWriting: () => confirming.set(false),
    discard: () => {
      confirming.set(false);
      open.set(false);
    },
  };
}
