import { InjectionToken } from '@angular/core';
import { environment } from '../../../environments/environment';
import { Environment } from '../../../environments/environment.model';

/** Read settings through this token (never import `environment` directly) so tests can override them. */
export const APP_CONFIG = new InjectionToken<Environment>('APP_CONFIG', {
  providedIn: 'root',
  factory: () => environment,
});
