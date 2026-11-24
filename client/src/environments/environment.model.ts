/** Front-end settings per environment. Never put secrets here: this file ships to the browser. */
export interface Environment {
  readonly name: 'production' | 'test' | 'development';
  /** Base of the QA API including the version prefix, e.g. `https://api.qa.cgiar.org/api/v1`. */
  readonly apiBaseUrl: string;
  /** Path of this app that receives the SSO `code` (registered as callback in Cognito). */
  readonly ssoCallbackPath: string;
}
