import type { Router } from 'express';

/**
 * Production/default build: there is NO mock. The `mock` build configuration replaces this file with
 * `dev-auth-mock.entry.mock.ts` (angular.json `fileReplacements`), so the mock code never ships.
 */
export function devAuthMock(): Router | null {
  return null;
}
