/**
 * Metadata of a Science Program route (P2-3911). Such a route is authenticated
 * by its own SP session guard (an opaque bearer issued by QA, not a Cognito
 * token), so both global guards skip it exactly like `@Public()`. Defined here
 * so the global guards can read it without importing the assessment module;
 * routes set it only through the `SpSession()` decorator of
 * `assessment/sp-view`, which always adds that guard.
 */
export const SP_SESSION_KEY = 'auth:sp-session';
