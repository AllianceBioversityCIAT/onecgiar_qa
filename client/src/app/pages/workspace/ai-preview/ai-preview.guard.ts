import { inject } from '@angular/core';
import { CanMatchFn } from '@angular/router';
import { APP_CONFIG } from '../../../core/config/app-config';
import { AI_PREVIEW } from './ai-preview.flag';

/**
 * Plan B of P2-3918: the AI preview route exists only in the `development` and `test` builds
 * (`ai-preview.flag.ts`), and never where the environment says production, whatever the build.
 */
export const aiPreviewMatch: CanMatchFn = () => aiPreviewOn(AI_PREVIEW, inject(APP_CONFIG).name);

/** Pure: the build flag AND an environment that is not production. */
export function aiPreviewOn(flag: boolean, environmentName: string): boolean {
  return flag && environmentName !== 'production';
}
