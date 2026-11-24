import { isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID, Service, inject } from '@angular/core';
import { toast } from '@spartan-ng/brain/sonner';

/**
 * The only way the app shows a toast. Rendered by `<hlm-toaster>` in `app.html`.
 * Messages are user text in English (server catalog messages are safe to show as is).
 * Browser only: the toast state is module-wide, so on the SSR server it would be shared by every
 * request (one user's error shown to another).
 */
@Service()
export class Toasts {
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  error(message: string): void {
    if (this.isBrowser) toast.error(message);
  }

  success(message: string): void {
    if (this.isBrowser) toast.success(message);
  }

  info(message: string): void {
    if (this.isBrowser) toast.info(message);
  }
}
