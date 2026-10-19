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
} as const;

export type FieldErrorCode = keyof typeof FIELD_ERRORS;
