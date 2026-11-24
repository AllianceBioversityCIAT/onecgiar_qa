import { SetMetadata } from '@nestjs/common';

export const READ_ACCESS_KEY = 'auth:readAccess';

/**
 * Marks a route any authenticated user may call, GUEST included (FR-12). A
 * `@RequirePermission()` on the same route or class is stricter and wins.
 */
export const ReadAccess = () => SetMetadata(READ_ACCESS_KEY, true);
