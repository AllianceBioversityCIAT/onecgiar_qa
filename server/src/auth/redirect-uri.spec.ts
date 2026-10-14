import { RedirectUriNotAllowedError } from './auth.errors.js';
import {
  assertAllowedRedirectUri,
  isAllowedRedirectUri,
} from './redirect-uri.js';

// FR-6 / FR-7: the redirect URI must start with an allowed origin. The HTTP
// tests cover the same rule through the routes; this table adds the edge cases.

const ALLOWED = ['https://qa.cgiar.org', 'http://localhost:4200'];

describe('isAllowedRedirectUri', () => {
  it.each([
    'https://qa.cgiar.org',
    'https://qa.cgiar.org/',
    'https://qa.cgiar.org/auth/callback',
    'https://qa.cgiar.org/auth/callback?next=%2Fhome',
    'https://qa.cgiar.org?x=1',
    'https://qa.cgiar.org/#/cb',
    'http://localhost:4200/auth/callback',
  ])('accepts %s', (uri) => {
    expect(isAllowedRedirectUri(uri, ALLOWED)).toBe(true);
  });

  it.each([
    [
      'a host that only starts like the allowed one',
      'https://qa.cgiar.org.evil.com/cb',
    ],
    ['a longer host label', 'https://qa.cgiar.orgx/cb'],
    ['a subdomain', 'https://evil.qa.cgiar.org/cb'],
    ['userinfo hiding another host', 'https://qa.cgiar.org@evil.com/cb'],
    ['userinfo on the allowed host', 'https://user@qa.cgiar.org/cb'],
    ['a backslash after the origin', 'https://qa.cgiar.org\\@evil.com/cb'],
    [
      'the allowed origin inside the query',
      'https://evil.com/?u=https://qa.cgiar.org',
    ],
    ['another scheme', 'http://qa.cgiar.org/cb'],
    ['another port', 'https://qa.cgiar.org:8443/cb'],
    ['the default port spelled out', 'https://qa.cgiar.org:443/cb'],
    ['another localhost port', 'http://localhost:4201/cb'],
    ['localhost without its port', 'http://localhost/cb'],
    ['upper-case scheme and host (fail closed)', 'HTTPS://QA.CGIAR.ORG/cb'],
    ['a leading space', ' https://qa.cgiar.org/cb'],
    ['a protocol-relative URL', '//qa.cgiar.org/cb'],
    ['a relative path', '/auth/callback'],
    ['a javascript URL', 'javascript:alert(1)'],
    ['a data URL', 'data:text/html,x'],
    ['an empty string', ''],
    ['not a URL at all', 'not a url'],
  ])('rejects %s', (_name, uri) => {
    expect(isAllowedRedirectUri(uri, ALLOWED)).toBe(false);
  });

  it('rejects everything when no origin is allowed', () => {
    expect(isAllowedRedirectUri('https://qa.cgiar.org/cb', [])).toBe(false);
  });
});

describe('assertAllowedRedirectUri', () => {
  it('returns for an allowed URI', () => {
    expect(() =>
      assertAllowedRedirectUri('https://qa.cgiar.org/cb', ALLOWED),
    ).not.toThrow();
  });

  it('throws the 400 error for any other', () => {
    expect(() =>
      assertAllowedRedirectUri('https://evil.com/cb', ALLOWED),
    ).toThrow(RedirectUriNotAllowedError);
  });
});
