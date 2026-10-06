export interface AuthUser {
  readonly email: string;
}

export interface Credentials {
  readonly email: string;
  readonly password: string;
}

export type AuthErrorReason = 'invalid' | 'rejected' | 'unavailable';

export class AuthError extends Error {
  constructor(
    readonly reason: AuthErrorReason,
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * Contract every authentication provider implements. The real provider is not
 * decided yet; swap the binding in `app.config.ts` to replace the stub.
 */
export abstract class AuthProvider {
  /** True while the provider is a development stand-in (shown on the login screen). */
  abstract readonly isStub: boolean;
  abstract signIn(credentials: Credentials): Promise<AuthUser>;
}
