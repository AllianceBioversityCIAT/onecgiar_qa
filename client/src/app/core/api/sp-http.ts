import { HttpClient } from '@angular/common/http';
// eslint-disable-next-line no-restricted-imports -- P2-3911: the SP view must skip the Cognito interceptors on purpose (see SpHttp).
import { HttpBackend } from '@angular/common/http';
import { Service, inject } from '@angular/core';

/**
 * The HTTP client of the Science Program view (P2-3911), built straight on the backend so NO
 * interceptor runs. This is the one deliberate exception to the "always HttpClient with interceptors"
 * rule: the SP page lives in Reporting's iframe with its own bearer (the SP session), and
 * `authInterceptor` would replace that header with a Cognito token if the tab had one and, on a 401,
 * refresh or end the Cognito session and send the iframe to /login. `requestSafetyInterceptor` would
 * queue writes for the QA Unsent list, which the SP page does not show. `SpApi` adds the bearer and
 * the timeout itself.
 */
@Service()
export class SpHttp {
  readonly client = new HttpClient(inject(HttpBackend));
}
