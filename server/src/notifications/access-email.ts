import type { EmailMessage } from './email.client.js';

/**
 * How the person signs in, which decides the instructions of the email:
 * - `sso`: CGIAR account (Microsoft), no password in QA.
 * - `temporary_password`: Cognito just emailed a temporary password (new or recreated account).
 * - `existing_password`: a custom account that already has a password.
 */
export type SignInPath = 'sso' | 'temporary_password' | 'existing_password';

/**
 * - `granted`: the person can now use QA (created, reactivated, account restored).
 * - `updated`: their roles changed; they still have at least one.
 * - `removed`: their last role was taken away (or they were removed from the team).
 */
export type AccessEmailKind = 'granted' | 'updated' | 'removed';

/** One role as the email lists it: its name and, for result-type roles, the types. */
export interface AccessRoleLine {
  role: string;
  /** `null` for a global role; `'all'` or the result type names otherwise. */
  resultTypes: 'all' | string[] | null;
}

export interface AccessEmailInput {
  kind: AccessEmailKind;
  email: string;
  firstName: string | null;
  /** The roles the person holds AFTER the change (empty for `removed`). */
  roles: AccessRoleLine[];
  signIn: SignInPath;
  /** The QA web app origin; `null` = no link and no logo. */
  appUrl: string | null;
}

export const ACCESS_EMAIL_SUBJECTS: Record<AccessEmailKind, string> = {
  granted: 'You have access to the QA Platform',
  updated: 'Your roles in the QA Platform were updated',
  removed: 'Your access to the QA Platform was removed',
};

/**
 * The "JP" palette of the app (client `theme/palettes.ts`, measured from the
 * QA Platform mockup): deep teal header, light page, teal primary, soft chips.
 */
const C = {
  bg: '#0c3a37',
  mutedOnDark: '#a9c7c3',
  page: '#f7f7f9',
  card: '#ffffff',
  line: '#e4e4e7',
  ink: '#18181b',
  mutedInk: '#5b5a66',
  primary: '#0f766e',
  primarySoft: '#d7f2ef',
} as const;
const FONT = "Inter, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const escape = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

function scopeText(line: AccessRoleLine): string | null {
  if (line.resultTypes === null) return null;
  if (line.resultTypes === 'all') return 'All result types';
  return line.resultTypes.join(', ');
}

function instructions(input: AccessEmailInput): string[] {
  switch (input.signIn) {
    case 'sso':
      return [
        'Choose "Sign in with CGIAR" on the sign-in page and use your CGIAR account.',
      ];
    case 'temporary_password':
      return [
        'You will receive a separate email with a temporary password (subject "Your temporary password").',
        'Sign in with this email address and that temporary password, then choose your own password.',
      ];
    case 'existing_password':
      return [
        'Sign in with this email address and your current password.',
        'Forgot it? Choose "Forgot password?" on the sign-in page to set a new one.',
      ];
  }
}

function intro(kind: AccessEmailKind): string {
  switch (kind) {
    case 'granted':
      return 'You have been given access to the One CGIAR QA Platform. These are your roles:';
    case 'updated':
      return 'An administrator updated your roles in the One CGIAR QA Platform. These are your roles now:';
    case 'removed':
      return 'An administrator removed your roles in the One CGIAR QA Platform, so you can no longer sign in. If you think this is a mistake, contact the QA team.';
  }
}

const HEADINGS: Record<AccessEmailKind, string> = {
  granted: 'Welcome to the QA Platform',
  updated: 'Your roles were updated',
  removed: 'Your access was removed',
};

/** The access email (plain text + HTML, table layout for email clients). Pure: no I/O. */
export function buildAccessEmail(input: AccessEmailInput): EmailMessage {
  const subject = ACCESS_EMAIL_SUBJECTS[input.kind];
  const greeting = input.firstName ? `Hello ${input.firstName},` : 'Hello,';
  const showAccess = input.kind !== 'removed';
  const steps = showAccess ? instructions(input) : [];
  const link =
    showAccess && input.appUrl !== null ? `${input.appUrl}/login` : null;
  const logo =
    input.appUrl === null ? null : `${input.appUrl}/logo-qa-white.png`;

  const text = [
    greeting,
    '',
    intro(input.kind),
    ...(showAccess
      ? input.roles.map((r) => {
          const scope = scopeText(r);
          return `- ${r.role}${scope === null ? '' : ` — ${scope}`}`;
        })
      : []),
    ...(steps.length > 0
      ? ['', 'How to sign in:', ...steps.map((s) => `- ${s}`)]
      : []),
    ...(link === null ? [] : ['', `Sign in: ${link}`]),
    '',
    'This is an automatic message from the QA Platform; please do not reply.',
  ].join('\n');

  const roleRows = showAccess
    ? input.roles
        .map((r) => {
          const scope = scopeText(r);
          return `<tr><td style="padding:12px 16px;border-top:1px solid ${C.line};">
<span style="display:inline-block;background:${C.primarySoft};color:${C.primary};font-weight:600;font-size:13px;padding:4px 10px;border-radius:999px;">${escape(r.role)}</span>
${scope === null ? '' : `<div style="margin-top:6px;font-size:13px;color:${C.mutedInk};">${escape(scope)}</div>`}
</td></tr>`;
        })
        .join('')
    : '';

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${C.page};font-family:${FONT};color:${C.ink};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${C.card};border-radius:12px;overflow:hidden;border:1px solid ${C.line};">
<tr><td style="background:${C.bg};padding:24px 32px;">
${logo === null ? `<span style="color:#ffffff;font-size:18px;font-weight:700;">QA Platform</span>` : `<img src="${escape(logo)}" alt="QA Platform" height="32" style="display:block;height:32px;border:0;">`}
<div style="color:${C.mutedOnDark};font-size:12px;margin-top:8px;letter-spacing:.04em;text-transform:uppercase;">One CGIAR · Quality Assurance</div>
</td></tr>
<tr><td style="padding:32px;">
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:${C.ink};">${escape(HEADINGS[input.kind])}</h1>
<p style="margin:0 0 12px;font-size:15px;line-height:1.6;">${escape(greeting)}</p>
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${C.ink};">${escape(intro(input.kind))}</p>
${roleRows === '' ? '' : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.line};border-radius:8px;border-collapse:separate;margin:0 0 24px;"><tr><td style="padding:10px 16px;font-size:12px;font-weight:600;color:${C.mutedInk};text-transform:uppercase;letter-spacing:.04em;">Roles</td></tr>${roleRows}</table>`}
${steps.length === 0 ? '' : `<p style="margin:0 0 8px;font-size:15px;font-weight:600;">How to sign in</p><ul style="margin:0 0 24px;padding-left:20px;font-size:15px;line-height:1.6;color:${C.ink};">${steps.map((s) => `<li style="margin-bottom:4px;">${escape(s)}</li>`).join('')}</ul>`}
${link === null ? '' : `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:${C.primary};border-radius:8px;"><a href="${escape(link)}" style="display:inline-block;padding:12px 24px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">Sign in to QA</a></td></tr></table>`}
</td></tr>
<tr><td style="padding:16px 32px;border-top:1px solid ${C.line};font-size:12px;line-height:1.5;color:${C.mutedInk};">
This is an automatic message from the QA Platform; please do not reply.
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  return { to: input.email, subject, text, html };
}
