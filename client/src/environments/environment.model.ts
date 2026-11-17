/** Front-end settings per environment. Never put secrets here: this file ships to the browser. */
export interface Environment {
  readonly name: 'production' | 'test' | 'development';
  /** Base of the QA API including the version prefix, e.g. `https://api.qa.cgiar.org/api/v1`. */
  readonly apiBaseUrl: string;
  /** Path of this app that receives the SSO `code` (registered as callback in Cognito). */
  readonly ssoCallbackPath: string;
  /**
   * Plan B of P2-3918 (spec assessment/ai-suggestions): the dev/test-only AI preview page for the 23-nov
   * session. Off when absent. Never in production: `ProductionEnvironment` makes `true` a compile error,
   * so a production build fails if it is turned on. Delete with the page once the chip is on the Review page.
   */
  readonly aiPreview?: boolean;
}

/** The production environment file is typed with this: `aiPreview: true` there does not compile. */
export interface ProductionEnvironment extends Environment {
  readonly name: 'production';
  readonly aiPreview?: false;
}
