/** Front-end settings per environment. Never put secrets here: this file ships to the browser. */
export interface Environment {
  readonly name: 'production' | 'test' | 'development' | 'mock' | 'preview';
  /** Base of the QA API including the version prefix, e.g. `https://api.qa.cgiar.org/api/v1`. */
  readonly apiBaseUrl: string;
  /** Path of this app that receives the SSO `code` (registered as callback in Cognito). */
  readonly ssoCallbackPath: string;
  /** True only when the auth mock of `server.ts` answers `/api/v1/auth/*` (`mock` and `preview` builds). */
  readonly mockAuth: boolean;
}
