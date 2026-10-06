import { AuthError } from './auth-provider';
import { STUB_DELAY_MS, STUB_FAILING_EMAIL, StubAuthProvider } from './stub-auth-provider';

describe('StubAuthProvider', () => {
  let provider: StubAuthProvider;

  beforeEach(() => {
    vi.useFakeTimers();
    provider = new StubAuthProvider();
  });

  afterEach(() => vi.useRealTimers());

  it('is marked as a stub', () => {
    expect(provider.isStub).toBe(true);
  });

  it('accepts well-formed credentials and normalizes the email', async () => {
    const attempt = provider.signIn({ email: '  Ana@CGIAR.org ', password: 'x' });
    await vi.advanceTimersByTimeAsync(STUB_DELAY_MS);
    await expect(attempt).resolves.toEqual({ email: 'ana@cgiar.org' });
  });

  it('rejects the reserved failing email', async () => {
    const attempt = provider.signIn({ email: STUB_FAILING_EMAIL, password: 'x' });
    const outcome = expect(attempt).rejects.toMatchObject({ reason: 'rejected' });
    await vi.advanceTimersByTimeAsync(STUB_DELAY_MS);
    await outcome;
  });

  it.each([
    { email: 'not-an-email', password: 'x' },
    { email: 'ana@cgiar.org', password: '' },
  ])('rejects malformed input %o without waiting', async (credentials) => {
    await expect(provider.signIn(credentials)).rejects.toBeInstanceOf(AuthError);
    await expect(provider.signIn(credentials)).rejects.toMatchObject({ reason: 'invalid' });
  });
});
