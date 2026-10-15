import type { Router } from 'express';
import { devAuthMockRouter } from './dev-auth-mock';

/** `mock` build only (`npm run start:mock`): mounted when `QA_DEV_AUTH_MOCK=1` as a second lock. */
export function devAuthMock(): Router | null {
  if (process.env['QA_DEV_AUTH_MOCK'] !== '1') return null;
  console.warn(
    '⚠️  QA dev auth mock is ON (/api/v1/auth/*, /__mock-sso). Personas: admin@mock.qa … password "mock-password".',
  );
  return devAuthMockRouter();
}
