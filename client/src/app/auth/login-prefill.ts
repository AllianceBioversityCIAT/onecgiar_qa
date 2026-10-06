import { InjectionToken } from '@angular/core';
import { Credentials } from './auth-provider';

/**
 * Dummy credentials filled into the login form, provided only in development builds and only
 * honoured while the stub provider is active, so a reviewer can sign in with one click.
 */
export const LOGIN_PREFILL = new InjectionToken<Credentials>('LOGIN_PREFILL');

export const DEV_LOGIN_PREFILL: Credentials = { email: 'qa.lead@cgiar.org', password: 'dev-stub' };
