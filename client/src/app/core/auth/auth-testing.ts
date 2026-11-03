import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { APP_CONFIG } from '../config/app-config';
import { authInterceptor } from './auth.interceptor';
import { Session, UserProfile } from './auth.models';

/** Shared test wiring for the auth layer (spec helper, not shipped: only imported by *.spec.ts). */
export const API = 'https://api.test/api/v1';

@Component({ template: '' })
class Blank {}

export function setupAuthTesting(): HttpTestingController {
  sessionStorage.clear();
  localStorage.clear();
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withInterceptors([authInterceptor])),
      provideHttpClientTesting(),
      provideRouter([
        { path: 'login', component: Blank },
        { path: 'cycle', component: Blank },
        { path: '**', component: Blank },
      ]),
      {
        provide: APP_CONFIG,
        useValue: {
          name: 'test',
          apiBaseUrl: API,
          ssoCallbackPath: '/auth/callback',
        },
      },
    ],
  });
  return TestBed.inject(HttpTestingController);
}

export const meta = { requestId: 'req', timestamp: '2026-10-15T00:00:00Z' };
export const ok = <T>(data: T) => ({ success: true, data, meta });
export const err = (status: number, code: string, message = code) => ({
  success: false,
  error: { status, code, message },
  meta,
});

export const user = (over: Partial<UserProfile> = {}): UserProfile => ({
  id: 1,
  email: 'ana@cgiar.org',
  firstName: 'Ana',
  lastName: null,
  authSource: 'custom',
  assignments: [{ role: 'ASSESSOR', resultTypeKey: 'KP' }],
  ...over,
});

export const session = (token = 'tok-1', over: Partial<UserProfile> = {}): Session => ({
  accessToken: token,
  expiresIn: 3600,
  user: user(over),
});

/** Lets queued promise callbacks run between HTTP flushes. */
export const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
