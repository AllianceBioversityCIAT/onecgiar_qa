/**
 * The closed catalog of error codes the API returns (response standard, see
 * `api-response.ts`). Each code has its HTTP status and the message shown to
 * the user. These messages are the ONLY text an error response carries: never
 * an exception's own message, a driver or validation text, or anything from
 * an upstream body.
 *
 * Rules for messages: plain English UI copy, addressed to the user, saying
 * what happened and what to do next; no internals (no SQL, no class names,
 * no Cognito wording), and nothing that tells whether an account exists
 * before the password was proven (`AUTH_INVALID_CREDENTIALS`).
 *
 * Add a code here, never a free-text message in a controller. The front
 * branches on `code`; `message` is safe to show as is.
 */
export const ERROR_CATALOG = {
  // --- Generic (any route) -------------------------------------------------
  VALIDATION_FAILED: {
    status: 400,
    message: 'Some fields are missing or invalid. Check them and try again.',
  },
  MALFORMED_JSON: {
    status: 400,
    message: 'The request could not be read. Send a valid JSON body.',
  },
  BAD_REQUEST: { status: 400, message: 'The request is not valid.' },
  UNAUTHENTICATED: { status: 401, message: 'Sign in to continue.' },
  FORBIDDEN: {
    status: 403,
    message: 'You do not have permission to do this.',
  },
  NOT_FOUND: {
    status: 404,
    message: 'We could not find what you are looking for.',
  },
  CONFLICT: {
    status: 409,
    message:
      'This change conflicts with the current data. Refresh and try again.',
  },
  PAYLOAD_TOO_LARGE: { status: 413, message: 'The request is too large.' },
  UNSUPPORTED_MEDIA_TYPE: {
    status: 415,
    message: 'Send the request body as JSON.',
  },
  TOO_MANY_REQUESTS: {
    status: 429,
    message: 'Too many attempts. Wait a moment and try again.',
  },
  SERVICE_UNAVAILABLE: {
    status: 503,
    message:
      'The service is temporarily unavailable. Try again in a few minutes.',
  },
  INTERNAL_ERROR: {
    status: 500,
    message:
      'Something went wrong on our side. Try again; if it keeps happening, contact support and share the reference code.',
  },

  // --- Idempotency (keyed writes) -----------------------------------------
  IDEMPOTENCY_IN_PROGRESS: {
    status: 409,
    message:
      'This request is already being processed. Wait a moment and try again.',
  },
  IDEMPOTENCY_KEY_REUSED: {
    status: 422,
    message:
      'This request identifier was already used for a different request. Start the change again.',
  },

  // --- Auth: credentials and session --------------------------------------
  AUTH_INVALID_CREDENTIALS: {
    status: 401,
    message: 'Incorrect email or password.',
  },
  AUTH_SSO_CODE_INVALID: {
    status: 401,
    message:
      'The sign-in did not complete or has expired. Start the sign-in again.',
  },
  AUTH_CHALLENGE_EXPIRED: {
    status: 401,
    message:
      'The password change took too long or is no longer valid. Sign in again to restart it.',
  },
  AUTH_PASSWORD_POLICY: {
    status: 400,
    message:
      'The new password does not meet the password requirements. Choose a stronger password.',
  },
  AUTH_SESSION_MISSING: {
    status: 401,
    message: 'You are not signed in. Sign in to continue.',
  },
  AUTH_SESSION_EXPIRED: {
    status: 401,
    message: 'Your session has expired. Sign in again.',
  },
  AUTH_TOKEN_INVALID: {
    status: 401,
    message: 'Your session is not valid or has expired. Sign in again.',
  },
  AUTH_LOGIN_INCOMPLETE: {
    status: 401,
    message:
      'The sign-in could not be completed. Try again; if it keeps happening, contact support.',
  },
  AUTH_SERVICE_UNAVAILABLE: {
    status: 503,
    message:
      'The sign-in service is not responding. Try again in a few minutes.',
  },

  // --- Auth: admission and access -----------------------------------------
  AUTH_USER_NOT_REGISTERED: {
    status: 403,
    message:
      'Your account is not registered in QA. Ask an administrator for access.',
  },
  AUTH_USER_INACTIVE: {
    status: 403,
    message: 'Your account is deactivated. Contact an administrator.',
  },
  AUTH_NO_ACTIVE_ROLES: {
    status: 403,
    message:
      'Your account has no active role in QA. Ask an administrator to assign one.',
  },
  AUTH_EMAIL_NOT_VERIFIED: {
    status: 403,
    message:
      'Your email address has not been verified. Contact an administrator.',
  },
  AUTH_EMAIL_CONFLICT: {
    status: 409,
    message:
      'This email is already linked to another account. Contact an administrator.',
  },
  AUTH_USER_NOT_ADMITTED: {
    status: 401,
    message:
      'Your access to QA is no longer active. Sign in again or contact an administrator.',
  },
  AUTH_PERMISSION_DENIED: {
    status: 403,
    message: 'You do not have permission to do this.',
  },
  AUTH_ORIGIN_NOT_ALLOWED: {
    status: 403,
    message:
      'This request was blocked because it did not come from the QA app.',
  },
  AUTH_REDIRECT_URI_NOT_ALLOWED: {
    status: 400,
    message: 'The sign-in return address is not allowed.',
  },

  // --- Users and roles -----------------------------------------------------
  USERS_INVALID_EMAIL: { status: 400, message: 'Enter a valid email address.' },
  USERS_DUPLICATE_USER: {
    status: 409,
    message: 'An account with this email already exists.',
  },
  USERS_UNKNOWN_ROLE: { status: 400, message: 'This role does not exist.' },
  USERS_SCOPE_MISMATCH: {
    status: 400,
    message:
      'This role needs a different scope (global, result type or program).',
  },
  USERS_DUPLICATE_ASSIGNMENT: {
    status: 409,
    message: 'This user already has this role in this scope.',
  },
  USERS_ROLE_CONFLICT: {
    status: 409,
    message:
      'A user cannot be both Assessor and Lead Assessor for the same result type. Remove one of the two roles and try again.',
  },
  USERS_ASSIGNMENT_NOT_FOUND: {
    status: 404,
    message: 'This role assignment does not exist.',
  },
  USERS_NOT_FOUND: { status: 404, message: 'This user does not exist.' },
  USERS_EMAIL_TAKEN: {
    status: 409,
    message:
      'A user with this email already exists. Open that user instead, or use a different email.',
  },
  USERS_NICKNAME_TAKEN: {
    status: 409,
    message:
      'This nickname is already used by another user. Choose a different nickname.',
  },
  USERS_NAME_LOCKED: {
    status: 409,
    message:
      'The name comes from the identity provider once the user has signed in, so it can no longer be edited here.',
  },
  USERS_INVITATION_NOT_APPLICABLE: {
    status: 409,
    message:
      'An invitation can only be resent to a custom-account user, invited by QA, who has not signed in yet.',
  },
  USERS_LAST_ADMIN: {
    status: 409,
    message:
      'This change would leave QA without an active administrator. Make another user an administrator first.',
  },
  USERS_EXCLUSION_EXISTS: {
    status: 409,
    message: 'This program is already excluded for this user.',
  },
  USERS_EXCLUSION_NOT_FOUND: {
    status: 404,
    message: 'This program exclusion does not exist or is no longer active.',
  },
  USERS_EXCLUSION_NOT_MANUAL: {
    status: 409,
    message:
      'Only an exclusion added by an administrator can be removed. Dismiss an exclusion that comes from Reporting instead.',
  },
  USERS_EXCLUSION_NOT_REPORTING: {
    status: 409,
    message:
      'Only an exclusion that comes from Reporting can be dismissed. Remove an exclusion added by an administrator instead.',
  },

  // --- Cycles and timelines ------------------------------------------------
  CYCLES_NOT_FOUND: { status: 404, message: 'This cycle does not exist.' },
  CYCLES_YEAR_TAKEN: {
    status: 409,
    message:
      'A cycle for this year already exists. Open that cycle instead, or choose a different year.',
  },
  CYCLES_NOT_DRAFT: {
    status: 409,
    message: 'Only a draft cycle can be activated.',
  },
  CYCLES_CLOSED: {
    status: 409,
    message:
      'This cycle is closed, so its timelines and assignments can no longer change.',
  },
  TIMELINES_NOT_FOUND: {
    status: 404,
    message: 'This timeline does not exist.',
  },
  TIMELINES_NAME_TAKEN: {
    status: 409,
    message:
      'Another timeline in this cycle already has this name. Choose a different name.',
  },
  TIMELINES_VERSION_STALE: {
    status: 409,
    message:
      'Someone else changed this timeline. Reload it and make your change again.',
  },
  TIMELINES_IN_PROGRESS_UNCONFIRMED: {
    status: 409,
    message:
      'This change affects a step that is in progress. Confirm it to save.',
  },
  TIMELINES_USER_NOT_ELIGIBLE: {
    status: 409,
    message:
      'This user is inactive or does not hold the role this step needs. Choose another user.',
  },
  TIMELINES_ASSIGNMENT_NOT_FOUND: {
    status: 404,
    message: 'This assignment does not exist or was already removed.',
  },

  // --- Field configuration -------------------------------------------------
  FIELD_CONFIG_CATALOG_MISSING: {
    status: 409,
    message: "No Reporting catalog exists for this cycle's year.",
  },
  FIELD_CONFIG_REVISION_STALE: {
    status: 409,
    message:
      'The draft changed after you reviewed it. Reload and review the changes again.',
  },
  FIELD_CONFIG_NOTHING_TO_PUBLISH: {
    status: 409,
    message: 'There are no changes to publish.',
  },
} as const satisfies Record<string, { status: number; message: string }>;

export type ErrorCode = keyof typeof ERROR_CATALOG;

export const ERROR_CODES = Object.keys(ERROR_CATALOG) as ErrorCode[];

export const isErrorCode = (value: unknown): value is ErrorCode =>
  typeof value === 'string' && Object.hasOwn(ERROR_CATALOG, value);

/**
 * The body a domain exception passes to its Nest base class:
 * `super(errorBody('AUTH_USER_NOT_REGISTERED'))`. The filter reads `code` and
 * takes status-independent text from the catalog only.
 */
export const errorBody = (code: ErrorCode) => ({
  code,
  message: ERROR_CATALOG[code].message,
});

/** The generic code for a status that no catalog code was given for. */
export function genericCodeFor(status: number): ErrorCode {
  switch (status) {
    case 400:
      return 'BAD_REQUEST';
    case 401:
      return 'UNAUTHENTICATED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 413:
      return 'PAYLOAD_TOO_LARGE';
    case 415:
      return 'UNSUPPORTED_MEDIA_TYPE';
    case 429:
      return 'TOO_MANY_REQUESTS';
    case 503:
      return 'SERVICE_UNAVAILABLE';
    default:
      return status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST';
  }
}

/** Per-field validation codes (`error.fields[].code`) and their messages. */
export const FIELD_ERRORS = {
  REQUIRED: () => 'This field is required.',
  INVALID_TYPE: () => 'This field has the wrong type.',
  INVALID_EMAIL: () => 'Enter a valid email address.',
  TOO_LONG: (max?: number) =>
    max === undefined
      ? 'This value is too long.'
      : `Must be at most ${max} characters.`,
  UNKNOWN_FIELD: () => 'This field is not allowed.',
  INVALID: () => 'This value is not valid.',
  OUT_OF_RANGE: () => 'This value is outside the allowed range.',
  CLOSES_BEFORE_OPENS: () =>
    'The closing date cannot be before the opening date.',
  OVERLAPS_PREVIOUS_STEP: () =>
    'This step must open after the previous step closes.',
  BEFORE_TODAY: () => 'This date cannot be in the past.',
  AUDIENCE_ORDER: () =>
    'Each audience can be used once, in the workflow order.',
  ROUND_SEQUENCE: () =>
    'Rounds start at 1 and either stay the same or go up by one.',
  FIRST_STEP_LOAD: () => 'The first step must require a load.',
  LOCKED: () => 'This can no longer be changed.',
  NOT_ASSESSED: () => 'Core and AI input can only be set on an assessed field.',
} as const;

export type FieldErrorCode = keyof typeof FIELD_ERRORS;
