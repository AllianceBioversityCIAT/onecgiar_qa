import { ACCESS_EMAIL_SUBJECTS, buildAccessEmail } from './access-email.js';

const base = {
  email: 'ada@example.org',
  firstName: 'Ada',
  roles: [
    { role: 'Assessor', resultTypes: ['Knowledge product', 'Policy change'] },
    { role: 'TPB', resultTypes: null },
  ],
  signIn: 'temporary_password' as const,
  appUrl: 'https://qatest.ciat.cgiar.org',
};

describe('buildAccessEmail', () => {
  it('granted: subject, roles with their result types, sign-in steps and the login link', () => {
    const email = buildAccessEmail({ ...base, kind: 'granted' });

    expect(email.to).toBe('ada@example.org');
    expect(email.subject).toBe(ACCESS_EMAIL_SUBJECTS.granted);
    expect(email.text).toContain(
      '- Assessor — Knowledge product, Policy change',
    );
    expect(email.text).toContain('- TPB');
    expect(email.text).toContain('temporary password');
    expect(email.text).toContain('https://qatest.ciat.cgiar.org/login');
    expect(email.html).toContain('href="https://qatest.ciat.cgiar.org/login"');
    expect(email.html).toContain(
      'src="https://qatest.ciat.cgiar.org/logo-qa-white.png"',
    );
    // The app palette ("JP"): header and primary.
    expect(email.html).toContain('#0c3a37');
    expect(email.html).toContain('#0f766e');
  });

  it.each([
    ['sso', 'Sign in with CGIAR'],
    ['existing_password', 'Forgot password?'],
  ] as const)('%s: its own instructions', (signIn, phrase) => {
    expect(
      buildAccessEmail({ ...base, kind: 'updated', signIn }).text,
    ).toContain(phrase);
  });

  it('updated: its own subject and the roles held now', () => {
    const email = buildAccessEmail({ ...base, kind: 'updated' });
    expect(email.subject).toBe(ACCESS_EMAIL_SUBJECTS.updated);
    expect(email.text).toContain('These are your roles now');
  });

  it('removed: no roles, no sign-in steps, no link', () => {
    const email = buildAccessEmail({ ...base, kind: 'removed', roles: [] });
    expect(email.subject).toBe(ACCESS_EMAIL_SUBJECTS.removed);
    expect(email.text).not.toContain('How to sign in');
    expect(email.html).not.toContain('/login');
  });

  it('escapes names and roles in the HTML', () => {
    const email = buildAccessEmail({
      ...base,
      kind: 'granted',
      firstName: '<script>x</script>',
      roles: [{ role: 'A & "B"', resultTypes: null }],
    });
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
    expect(email.html).toContain('A &amp; &quot;B&quot;');
  });

  it('no app URL: no link and a text header instead of the logo', () => {
    const email = buildAccessEmail({ ...base, kind: 'granted', appUrl: null });
    expect(email.html).not.toContain('<img');
    expect(email.text).not.toContain('Sign in:');
  });
});
