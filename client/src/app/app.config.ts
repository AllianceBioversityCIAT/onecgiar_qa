import {
  ApplicationConfig,
  DOCUMENT,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { provideClientHydration } from '@angular/platform-browser';
import { routes } from './app.routes';
import { authInterceptor } from './core/auth/auth.interceptor';
import { requestSafetyInterceptor } from './core/http/request-safety.interceptor';
import { actingRoleInterceptor } from './core/api/acting-role';
import { AuthSession } from './core/auth/auth-session';
import { startSession } from './core/auth/session-start';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideClientHydration(),
    provideHttpClient(withFetch(), withInterceptors([requestSafetyInterceptor, actingRoleInterceptor, authInterceptor])),
    // Recover the session from the refresh cookie before the first navigation (browser only; never on
    // the Science Program view, see `startSession`;
    // on the server the status is `anonymous` and protected pages render on the client).
    provideAppInitializer(() => startSession(inject(AuthSession), inject(DOCUMENT).location?.pathname ?? '')),
  ],
};
