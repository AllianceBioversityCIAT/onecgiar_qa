import { inject } from '@angular/core';
import { CanMatchFn } from '@angular/router';
import { APP_CONFIG } from '../../../core/config/app-config';

/** Plan B of P2-3918: the AI preview route exists only where the environment turns it on (dev/test). */
export const aiPreviewMatch: CanMatchFn = () => inject(APP_CONFIG).aiPreview === true;
