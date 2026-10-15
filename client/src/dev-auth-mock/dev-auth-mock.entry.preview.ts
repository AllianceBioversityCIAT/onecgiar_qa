import type { Router } from 'express';
import { devAuthMockRouter } from './dev-auth-mock';

/**
 * `preview` build only (design preview on CloudFront while the QA API does not exist). Same mock as local:
 * any email signs in as ADMIN, `@mock.qa` personas test roles. Never part of the production build.
 */
export function devAuthMock(): Router | null {
  console.warn('⚠️  QA auth mock is ON in the PREVIEW build (no real accounts, design data only).');
  return devAuthMockRouter();
}
