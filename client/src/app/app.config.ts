import { ApplicationConfig, isDevMode, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { provideClientHydration } from '@angular/platform-browser';
import { AuthProvider } from './auth/auth-provider';
import { StubAuthProvider } from './auth/stub-auth-provider';
import { DEV_LOGIN_PREFILL, LOGIN_PREFILL } from './auth/login-prefill';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideClientHydration(),
    // Provider not decided yet: replace this binding when it is.
    { provide: AuthProvider, useClass: StubAuthProvider },
    // Development only: one-click sign-in while the stub is active.
    ...(isDevMode() ? [{ provide: LOGIN_PREFILL, useValue: DEV_LOGIN_PREFILL }] : []),
  ],
};
