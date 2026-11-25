import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AuthSession } from '../../core/auth/auth-session';
import { API, err, ok, session, setupAuthTesting, tick } from '../../core/auth/auth-testing';
import { LoginPage, PASSWORD_CHANGED_NOTICE } from './login';
import { PASSWORD_RULES_MESSAGE } from './password-policy';
import { CODE_SENT_NOTICE } from './password-recovery';

async function setup() {
  const http = setupAuthTesting();
  const router = TestBed.inject(Router);
  await router.navigateByUrl('/login');
  const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
  const fixture = TestBed.createComponent(LoginPage);
  await fixture.whenStable();
  const host = fixture.nativeElement as HTMLElement;

  const openPasswordSignIn = () => {
    host.querySelector<HTMLButtonElement>('[data-testid="password-sign-in"]')?.click();
    fixture.detectChanges();
  };
  const type = (id: string, value: string) => {
    openPasswordSignIn();
    const input = host.querySelector<HTMLInputElement>(`#${id}`)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };
  const submit = async () => {
    openPasswordSignIn();
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
  const click = (selector: string) => {
    host.querySelector<HTMLButtonElement>(selector)!.click();
    fixture.detectChanges();
  };
  /** Fills a field of whatever view is showing (no unfolding of the sign-in form). */
  const fill = (id: string, value: string) => {
    const input = host.querySelector<HTMLInputElement>(`#${id}`)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };
  const submitForm = async (testid: string) => {
    host
      .querySelector(`[data-testid="${testid}"]`)!
      .dispatchEvent(new Event('submit', { cancelable: true }));
    await tick();
    fixture.detectChanges();
  };

  return {
    fixture,
    host,
    http,
    navigate,
    openPasswordSignIn,
    type,
    submit,
    settle,
    text,
    click,
    fill,
    submitForm,
  };
}

describe('LoginPage', () => {
  it('SSO comes first and the email form stays folded until asked for', async () => {
    const { fixture, host, openPasswordSignIn } = await setup();
    const buttons = [...host.querySelectorAll<HTMLButtonElement>('main button')];
    expect(buttons[0].dataset['testid']).toBe('sso');
    expect(host.querySelector('#email')).toBeNull();
    openPasswordSignIn();
    await fixture.whenStable();
    expect(host.querySelector('#email')).not.toBeNull();
    expect(host.querySelector('[data-testid="password-sign-in"]')).toBeNull();
    expect(document.activeElement?.id).toBe('email');
  });

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

  it('sends email and password without the spaces a paste leaves at either end', async () => {
    const { http, type, submit } = await setup();
    type('email', ' ana@cgiar.org ');
    type('password', ' n08fL*eG ');
    await submit();
    const req = http.expectOne(`${API}/auth/login`);
    expect(req.request.body).toEqual({ email: 'ana@cgiar.org', password: 'n08fL*eG' });
    req.flush(ok(session()));
  });

  it('the new-password step lists the requirements, ticks them live and blocks a weak password', async () => {
    const { http, type, submit, settle, host, fixture, text } = await setup();
    type('email', 'new@cgiar.org');
    type('password', 'temp');
    await submit();
    http
      .expectOne(`${API}/auth/login`)
      .flush(ok({ challenge: 'NEW_PASSWORD_REQUIRED', session: 'c1' }));
    await settle();

    const met = () =>
      Object.fromEntries(
        [...host.querySelectorAll<HTMLElement>('#new-password-rules li')].map((li) => [
          li.dataset['rule'],
          li.dataset['met'] === 'true',
        ]),
      );
    expect(host.querySelector('#new-password')!.getAttribute('aria-describedby')).toContain(
      'new-password-rules',
    );
    expect(met()).toEqual({
      length: false,
      upper: false,
      lower: false,
      number: false,
      symbol: false,
    });

    const fillNew = (id: string, value: string) => {
      const input = host.querySelector<HTMLInputElement>(`#${id}`)!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    };
    fillNew('new-password', 'weakpass1');
    fillNew('confirm-password', 'weakpass1');
    expect(met()).toEqual({ length: true, upper: false, lower: true, number: true, symbol: false });

    host
      .querySelector('[data-testid="new-password-form"]')!
      .dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
    http.expectNone(`${API}/auth/complete-new-password`);
    expect(text('#new-password-error')).toBe(PASSWORD_RULES_MESSAGE);

    fillNew('new-password', ' Str0ng!pass ');
    fillNew('confirm-password', 'Str0ng!pass');
    expect(Object.values(met()).every(Boolean)).toBe(true);
    host
      .querySelector('[data-testid="new-password-form"]')!
      .dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
    const req = http.expectOne(`${API}/auth/complete-new-password`);
    expect(req.request.body.newPassword).toBe('Str0ng!pass');
    req.flush(ok(session()));
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

  it('a 429 on SSO shows the countdown on the CGIAR button while the form is folded', async () => {
    const { http, host, settle } = await setup();
    host.querySelector<HTMLButtonElement>('[data-testid="sso"]')!.click();
    http
      .expectOne((r) => r.url === `${API}/auth/provider-url`)
      .flush(
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
    const sso = host.querySelector<HTMLButtonElement>('[data-testid="sso"]')!;
    expect(host.querySelector('#email')).toBeNull();
    expect(sso.disabled).toBe(true);
    expect(sso.textContent).toContain('Try again in 30 s');
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

  describe('show/hide password', () => {
    it('toggles the input type and the button state without submitting', async () => {
      const { fixture, host, http, openPasswordSignIn } = await setup();
      openPasswordSignIn();
      const input = host.querySelector<HTMLInputElement>('#password')!;
      const toggle = host.querySelector<HTMLButtonElement>('app-password-toggle button')!;
      expect(toggle.type).toBe('button');
      expect(input.type).toBe('password');
      expect(toggle.getAttribute('aria-label')).toBe('Show password');
      expect(toggle.getAttribute('aria-pressed')).toBe('false');
      expect(toggle.getAttribute('aria-controls')).toBe('password');

      toggle.click();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(input.type).toBe('text');
      expect(toggle.getAttribute('aria-label')).toBe('Hide password');
      expect(toggle.getAttribute('aria-pressed')).toBe('true');
      http.expectNone(`${API}/auth/login`);

      toggle.click();
      await fixture.whenStable();
      fixture.detectChanges();
      expect(input.type).toBe('password');
      expect(toggle.getAttribute('aria-label')).toBe('Show password');
    });

    it('every password field of the new-password challenge has its own toggle', async () => {
      const { http, type, submit, settle, host } = await setup();
      type('email', 'new@cgiar.org');
      type('password', 'temp');
      await submit();
      http
        .expectOne(`${API}/auth/login`)
        .flush(ok({ challenge: 'NEW_PASSWORD_REQUIRED', session: 'c1' }));
      await settle();
      const controls = [...host.querySelectorAll('app-password-toggle button')].map((b) =>
        b.getAttribute('aria-controls'),
      );
      expect(controls).toEqual(['new-password', 'confirm-password']);
    });
  });

  describe('password recovery', () => {
    async function openReset() {
      const t = await setup();
      t.type('email', 'ana@partner.org');
      t.click('[data-testid="forgot-password"]');
      await t.fixture.whenStable();
      await t.submitForm('forgot-form');
      const req = t.http.expectOne(`${API}/auth/forgot-password`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ email: 'ana@partner.org' });
      req.flush(ok({ accepted: true }), { status: 202, statusText: 'Accepted' });
      await t.settle();
      return t;
    }

    it('forgot -> reset -> back to sign in with a notice and the email filled in', async () => {
      const { host, http, text, type, click, fill, submitForm, settle, fixture } = await setup();
      type('email', 'ana@partner.org');
      click('[data-testid="forgot-password"]');
      await fixture.whenStable();
      expect(text('h1')).toBe('Reset your password');
      expect(document.activeElement?.tagName).toBe('H1');
      expect(host.querySelector<HTMLInputElement>('#recovery-email')!.value).toBe(
        'ana@partner.org',
      );
      expect(text('[data-testid="cgiar-note"]')).toContain('CGIAR account');

      await submitForm('forgot-form');
      http
        .expectOne(`${API}/auth/forgot-password`)
        .flush(ok({ accepted: true }), { status: 202, statusText: 'Accepted' });
      await settle();
      expect(text('h1')).toBe('Choose a new password');
      expect(document.activeElement?.tagName).toBe('H1');
      expect(text('[data-testid="recovery-notice"]')).toBe(CODE_SENT_NOTICE);
      expect(host.querySelector('[data-testid="recovery-notice"]')!.getAttribute('role')).toBe(
        'status',
      );
      expect(host.querySelector('#reset-code')!.getAttribute('autocomplete')).toBe('one-time-code');
      expect(host.querySelectorAll('app-password-toggle').length).toBe(2);

      fill('reset-code', ' 123456 ');
      fill('reset-new-password', 'NewSecret1!');
      fill('reset-confirm-password', 'NewSecret1!');
      await submitForm('reset-form');
      const req = http.expectOne(`${API}/auth/reset-password`);
      expect(req.request.body).toEqual({
        email: 'ana@partner.org',
        code: '123456',
        newPassword: 'NewSecret1!',
      });
      req.flush(null, { status: 204, statusText: 'No Content' });
      await settle();
      await fixture.whenStable();

      expect(text('h1')).toBe('Sign in');
      expect(text('[data-testid="notice"]')).toBe(PASSWORD_CHANGED_NOTICE);
      expect(host.querySelector<HTMLInputElement>('#email')!.value).toBe('ana@partner.org');
      expect(host.querySelector<HTMLInputElement>('#password')!.value).toBe('');
      expect(host.querySelector('#password-error')).toBeNull();
      expect(document.activeElement?.id).toBe('password');
    });

    it('a wrong or expired code shows on the code field', async () => {
      const { host, http, text, fill, submitForm, settle } = await openReset();
      fill('reset-code', '000000');
      fill('reset-new-password', 'NewSecret1!');
      fill('reset-confirm-password', 'NewSecret1!');
      await submitForm('reset-form');
      http
        .expectOne(`${API}/auth/reset-password`)
        .flush(err(400, 'AUTH_RESET_CODE_INVALID', 'The code is wrong or expired.'), {
          status: 400,
          statusText: 'Bad Request',
        });
      await settle();
      expect(text('#reset-code-error')).toBe('The code is wrong or expired.');
      expect(host.querySelector('#reset-code')!.getAttribute('aria-describedby')).toBe(
        'reset-code-error',
      );
      expect(text('[data-testid="recovery-failure"]')).toBe('');
      expect(text('h1')).toBe('Choose a new password');
    });

    it('a password Cognito still refuses shows its message on the new password field', async () => {
      const { http, text, fill, submitForm, settle } = await openReset();
      fill('reset-code', '123456');
      fill('reset-new-password', 'NewSecret1!');
      fill('reset-confirm-password', 'NewSecret1!');
      await submitForm('reset-form');
      http
        .expectOne(`${API}/auth/reset-password`)
        .flush(err(400, 'AUTH_PASSWORD_POLICY', 'Use a stronger password.'), {
          status: 400,
          statusText: 'Bad Request',
        });
      await settle();
      expect(text('#reset-new-password-error')).toBe('Use a stronger password.');
    });

    it('a mismatched confirmation blocks the request', async () => {
      const { http, text, fill, submitForm, settle } = await openReset();
      fill('reset-code', '123456');
      fill('reset-new-password', 'NewSecret1!');
      fill('reset-confirm-password', 'Different1!');
      await submitForm('reset-form');
      await settle();
      http.expectNone(`${API}/auth/reset-password`);
      expect(text('#reset-confirm-password-error')).toBe('The passwords do not match.');
    });

    it('resend asks for another code; a 429 shows the server message', async () => {
      const { http, text, click, settle } = await openReset();
      click('[data-testid="resend-code"]');
      http
        .expectOne(`${API}/auth/forgot-password`)
        .flush(err(429, 'TOO_MANY_REQUESTS', 'Too many attempts.'), {
          status: 429,
          statusText: 'x',
        });
      await settle();
      expect(text('[data-testid="recovery-failure"]')).toBe('Too many attempts.');
    });

    it('back to sign in keeps the email and returns focus to the link', async () => {
      const { host, click, fixture } = await openReset();
      click('[data-testid="recovery-back"]');
      await fixture.whenStable();
      expect(host.querySelector<HTMLInputElement>('#email')!.value).toBe('ana@partner.org');
      expect(document.activeElement?.getAttribute('data-testid')).toBe('forgot-password');
    });
  });
});
