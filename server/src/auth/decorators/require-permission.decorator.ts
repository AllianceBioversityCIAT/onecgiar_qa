import { SetMetadata } from '@nestjs/common';
import type { Permission } from '../../users/permissions.js';

export const REQUIRE_PERMISSION_KEY = 'auth:requirePermission';

/**
 * Declares the permission a route needs. The route guard checks it with
 * `canAny` (some assignment grants it in some scope); a resource-scoped route
 * must still call `can()` with the resource's context in its service (DD-4).
 */
export const RequirePermission = (permission: Permission) =>
  SetMetadata(REQUIRE_PERMISSION_KEY, permission);
