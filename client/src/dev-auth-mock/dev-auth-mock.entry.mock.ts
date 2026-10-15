import type { Router } from 'express';
import { devAuthMockRouter } from './dev-auth-mock';

/**
 * `mock` build only (`npm run start:mock`). The build configuration is the lock: production builds compile
 * the empty `dev-auth-mock.entry.ts`. `QA_DEV_AUTH_MOCK=0` turns it off (no shell syntax needed on Windows).
 */
export function devAuthMock(): Router | null {
  if (process.env['QA_DEV_AUTH_MOCK'] === '0') return null;
  console.warn(
    '⚠️  QA auth mock is ON (/api/v1/auth/*, /__mock-sso). Any email signs in as ADMIN; @mock.qa personas use "mock-password".',
  );
  return devAuthMockRouter();
}
