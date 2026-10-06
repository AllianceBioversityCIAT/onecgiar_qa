import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AuthError, AuthProvider, AuthUser, Credentials } from '../../auth/auth-provider';
import { LoginPage } from './login';

class FakeProvider extends AuthProvider {
  readonly isStub = true;
  calls = 0;
  outcome: () => Promise<AuthUser> = () => Promise.resolve({ email: 'ana@cgiar.org' });

  signIn(_credentials: Credentials): Promise<AuthUser> {
    this.calls++;
    return this.outcome();
  }
}

async function setup(url = '/login') {
  sessionStorage.clear();
  const provider = new FakeProvider();
  TestBed.configureTestingModule({
    imports: [LoginPage],
    providers: [
      provideRouter([{ path: 'login', component: LoginPage }]),
      { provide: AuthProvider, useValue: provider },
    ],
  });
  const router = TestBed.inject(Router);
  await router.navigateByUrl(url);
  const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
  const fixture = TestBed.createComponent(LoginPage);
  await fixture.whenStable();
  const host = fixture.nativeElement as HTMLElement;

  const type = (id: string, value: string) => {
    const input = host.querySelector<HTMLInputElement>(`#${id}`)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };
  const submit = async () => {
    host.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();
  };
  const text = (selector: string) => host.querySelector(selector)?.textContent?.trim() ?? '';

  return { fixture, host, provider, navigate, type, submit, text };
}

describe('LoginPage', () => {
  it('shows the development stub notice', async () => {
    const { text } = await setup();
    expect(text('[data-testid="stub-notice"]')).toContain('Development stub');
  });

  it('empty submit: no attempt, both fields required', async () => {
    const { provider, submit, text, host } = await setup();
    await submit();
    expect(provider.calls).toBe(0);
    expect(text('#email-error')).toBe('Enter your email.');
    expect(text('#password-error')).toBe('Enter your password.');
    expect(host.querySelector('#email')!.getAttribute('aria-describedby')).toBe('email-error');
    expect(host.querySelector('#email')!.getAttribute('aria-invalid')).toBe('true');
  });

  it('malformed email: no attempt, invalid-email message', async () => {
    const { provider, type, submit, text } = await setup();
    type('email', 'not-an-email');
    type('password', 'secret');
    await submit();
    expect(provider.calls).toBe(0);
    expect(text('#email-error')).toContain('valid email');
  });

  it('double submit: one attempt, button busy meanwhile', async () => {
    const { provider, type, submit, host, fixture, navigate } = await setup();
    let release!: (user: AuthUser) => void;
    provider.outcome = () => new Promise((resolve) => (release = resolve));
    type('email', 'ana@cgiar.org');
    type('password', 'secret');

    const form = host.querySelector('form')!;
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await Promise.resolve();
    fixture.detectChanges();

    const button = host.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('Signing in');

    release({ email: 'ana@cgiar.org' });
    await submit();
    expect(provider.calls).toBe(1);
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('failure: message announced, email kept, can retry', async () => {
    const { provider, type, submit, text, host } = await setup();
    provider.outcome = () =>
      Promise.reject(new AuthError('rejected', 'The email or password is incorrect.'));
    type('email', 'ana@cgiar.org');
    type('password', 'wrong');
    await submit();

    expect(host.querySelector('[role="alert"]')?.textContent).toContain('incorrect');
    expect(host.querySelector<HTMLInputElement>('#email')!.value).toBe('ana@cgiar.org');
    expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);

    provider.outcome = () => Promise.resolve({ email: 'ana@cgiar.org' });
    await submit();
    expect(provider.calls).toBe(2);
    expect(text('[role="alert"]')).toBe('');
  });

  it('returns to the requested page after sign-in', async () => {
    const { type, submit, navigate } = await setup('/login?returnUrl=%2Fbatches%2F7');
    type('email', 'ana@cgiar.org');
    type('password', 'secret');
    await submit();
    expect(navigate).toHaveBeenCalledWith('/batches/7');
  });

  it('ignores an external returnUrl', async () => {
    const { type, submit, navigate } = await setup('/login?returnUrl=%2F%2Fevil.example');
    type('email', 'ana@cgiar.org');
    type('password', 'secret');
    await submit();
    expect(navigate).toHaveBeenCalledWith('/');
  });
});
