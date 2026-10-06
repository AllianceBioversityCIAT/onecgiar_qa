import { AuthError, AuthProvider, AuthUser, Credentials } from './auth-provider';

/** Email the stub always rejects, so the failure path can be tried by hand and in tests. */
export const STUB_FAILING_EMAIL = 'fail@stub.local';
export const STUB_DELAY_MS = 400;

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Development provider: accepts any well-formed credentials, never calls a network. */
export class StubAuthProvider extends AuthProvider {
  readonly isStub = true;

  async signIn({ email, password }: Credentials): Promise<AuthUser> {
    const normalized = email.trim().toLowerCase();
    if (!EMAIL_SHAPE.test(normalized) || password.length === 0) {
      throw new AuthError('invalid', 'Enter a valid email and password.');
    }
    await new Promise((resolve) => setTimeout(resolve, STUB_DELAY_MS));
    if (normalized === STUB_FAILING_EMAIL) {
      throw new AuthError('rejected', 'The email or password is incorrect.');
    }
    return { email: normalized };
  }
}
