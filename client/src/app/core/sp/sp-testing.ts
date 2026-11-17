import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, Provider } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Routes, provideRouter } from '@angular/router';
import { APP_CONFIG } from '../config/app-config';
import { authInterceptor } from '../auth/auth.interceptor';
import { requestSafetyInterceptor } from '../http/request-safety.interceptor';
import { SpMe, SpSessionData } from '../api/sp.models';
import { SP_PARENT_FRAME, SpSession } from './sp-session';

/** Shared test wiring of the SP view (spec helper, not shipped: only imported by *.spec.ts). */
export const SP_API = 'https://api.test/api/v1';

@Component({ template: '' })
class Blank {}

export interface FakeParent {
  readonly messages: unknown[];
  postMessage(message: unknown, targetOrigin: string): void;
}

/** A parent window that records what it receives. */
export function fakeParent(): FakeParent {
  const messages: unknown[] = [];
  return {
    messages,
    postMessage: (message: unknown) => {
      messages.push(message);
    },
  };
}

/**
 * The real app wiring (both QA interceptors on HttpClient) plus a router with `/sp`, so a test can
 * prove the SP client skips them.
 */
export function setupSpTesting(
  parent: FakeParent | null = fakeParent(),
  providers: Provider[] = [],
  spChildren: Routes = [{ path: '**', component: Blank }],
): HttpTestingController {
  sessionStorage.clear();
  localStorage.clear();
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withInterceptors([requestSafetyInterceptor, authInterceptor])),
      provideHttpClientTesting(),
      provideRouter([
        { path: 'sp', children: spChildren },
        { path: '**', component: Blank },
      ]),
      { provide: APP_CONFIG, useValue: { name: 'test', apiBaseUrl: SP_API, ssoCallbackPath: '/auth/callback' } },
      { provide: SP_PARENT_FRAME, useValue: parent },
      ...providers,
    ],
  });
  return TestBed.inject(HttpTestingController);
}

export const spMeta = { requestId: 'req', timestamp: '2026-11-17T00:00:00Z' };
export const spOk = <T>(data: T) => ({ success: true, data, meta: spMeta });
export const spErr = (status: number, code: string, message = code, fields?: unknown) => ({
  success: false,
  error: { status, code, message, ...(fields ? { fields } : {}) },
  meta: spMeta,
});

export const SP01 = { id: 101, code: 'SP01', name: 'Breeding for Tomorrow' };
export const SP02 = { id: 102, code: 'SP02', name: 'Sustainable Farming' };

export function sessionData(over: Partial<SpSessionData> = {}): SpSessionData {
  return {
    accessToken: 'sp-token-1',
    expiresAt: new Date(Date.now() + 8 * 3600_000).toISOString(),
    user: { name: 'Sam Program' },
    program: SP01,
    isReportingAdmin: false,
    ...over,
  };
}

export function meData(over: Partial<SpMe> = {}): SpMe {
  return { user: { name: 'Sam Program' }, isReportingAdmin: false, program: SP01, programs: [SP01], ...over };
}

/** Retries `probe` across macrotasks until it stops throwing (e.g. `expectOne` of a call not sent yet). */
export async function until<T>(probe: () => T, attempts = 50): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return probe();
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  throw last;
}

/** Opens a live SP session through the real exchange. */
export async function startSpSession(http: HttpTestingController, data: SpSessionData = sessionData(), code = 'code-1'): Promise<SpSession> {
  const session = TestBed.inject(SpSession);
  const started = session.begin(code);
  (await until(() => http.expectOne(`${SP_API}/sp-access/session`))).flush(spOk(data));
  await started;
  return session;
}
