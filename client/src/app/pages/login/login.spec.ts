import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AuthSession } from '../../core/auth/auth-session';
import { API, err, ok, session, setupAuthTesting, tick } from '../../core/auth/auth-testing';
import { LoginPage } from './login';

async function setup() {
  const http = setupAuthTesting();
  const router = TestBed.inject(Router);
  await router.navigateByUrl('/login');
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
    await tick();
    fixture.detectChanges();
  };
  const settle = async () => {
    await tick();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const text = (selector: string) => host.querySelector(selector)?.textContent?.trim() ?? '';

  return { fixture, host, http, navigate, type, submit, settle, text };
}

describe('LoginPage', () => {
  it('empty submit: no request, both fields required', async () => {
    const { http, submit, text } = await setup();
    await submit();
    http.expectNone(`${API}/auth/login`);
    expect(text('#email-error')).toBe('Enter your email.');
    expect(text('#password-error')).toBe('Enter your password.');
  });

  it('shows the server message for wrong credentials and keeps the values', async () => {
    const { http, type, submit, settle, text, host } = await setup();
    type('email', 'ana@cgiar.org');
    type('password', 'bad');
    await submit();
    http
      .expectOne(`${API}/auth/login`)
      .flush(err(401, 'AUTH_INVALID_CREDENTIALS', 'Incorrect email or password.'), {
        status: 401,
        statusText: 'x',
      });
    await settle();
    expect(text('[data-testid="failure"]')).toBe('Incorrect email or password.');
    expect(host.querySelector<HTMLInputElement>('#email')!.value).toBe('ana@cgiar.org');
  });

  it('double submit makes one request and lands on the pending page', async () => {
    const { http, type, submit, settle, navigate } = await setup();
    sessionStorage.setItem('qa.pendingRedirect', '/fields');
    type('email', 'ana@cgiar.org');
    type('password', 'secret');
    await submit();
    await submit();
    http.expectOne(`${API}/auth/login`).flush(ok(session()));
    await settle();
    expect(TestBed.inject(AuthSession).isSignedIn()).toBe(true);
    expect(navigate).toHaveBeenCalledWith('/fields');
  });

  it('first login asks for a new password', async () => {
    const { http, type, submit, settle, host, text } = await setup();
    type('email', 'new@cgiar.org');
    type('password', 'temp');
    await submit();
    http
      .expectOne(`${API}/auth/login`)
      .flush(ok({ challenge: 'NEW_PASSWORD_REQUIRED', session: 'c1' }));
    await settle();
    expect(host.querySelector('[data-testid="new-password-form"]')).not.toBeNull();
    expect(text('h1')).toBe('Set your password');
  });

  it('a 429 disables the button with a countdown', async () => {
    const { http, type, submit, settle, host } = await setup();
    type('email', 'ana@cgiar.org');
    type('password', 'x');
    await submit();
    http.expectOne(`${API}/auth/login`).flush(
      {
        success: false,
        error: {
          status: 429,
          code: 'TOO_MANY_REQUESTS',
          message: 'Too many attempts.',
          retryAfter: 30,
        },
        meta: { requestId: 'r', timestamp: 't' },
      },
      { status: 429, statusText: 'x' },
    );
    await settle();
    const button = host.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('Try again in 30 s');
  });

  it('the CGIAR button asks the API for the provider URL with this origin callback', async () => {
    const { http, host } = await setup();
    host.querySelector<HTMLButtonElement>('[data-testid="sso"]')!.click();
    const req = http.expectOne((r) => r.url === `${API}/auth/provider-url`);
    expect(req.request.params.get('redirectUri')).toBe(`${location.origin}/auth/callback`);
    req.flush(err(503, 'AUTH_SERVICE_UNAVAILABLE', 'Sign-in is unavailable.'), {
      status: 503,
      statusText: 'x',
    });
  });
});
