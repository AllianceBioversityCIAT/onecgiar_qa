import { Signal, signal } from '@angular/core';
import { Observable, firstValueFrom, isObservable } from 'rxjs';

export interface Submission {
  /** True from the first click until the work answers: bind it to `[disabled]` and the spinner. */
  readonly busy: Signal<boolean>;
  /** Runs the work once; a second call while busy is ignored and resolves to `undefined`. */
  run<T>(work: () => Observable<T> | Promise<T>): Promise<T | undefined>;
}

/**
 * Client half of "every action survives two taps" (golden rule, Yeck 26-sep-2026): the lock is
 * taken synchronously on the first call, so a double click or Enter + click starts the work once.
 * The request-safety interceptor also merges identical writes; this covers the button state.
 */
export function submission(): Submission {
  const busy = signal(false);
  return {
    busy: busy.asReadonly(),
    async run<T>(work: () => Observable<T> | Promise<T>): Promise<T | undefined> {
      if (busy()) return undefined;
      busy.set(true);
      try {
        const result = work();
        return await (isObservable(result) ? firstValueFrom(result) : result);
      } finally {
        busy.set(false);
      }
    },
  };
}
