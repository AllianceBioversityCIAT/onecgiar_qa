import { frameAncestorsSources, frameHeadersFor, isSpPath, spFrameAncestorsPolicy, toFrameOrigin } from './sp-frame-ancestors';

describe('SP frame-ancestors (P2-3911)', () => {
  it('unset, empty or blank means nobody may frame /sp', () => {
    expect(spFrameAncestorsPolicy(undefined)).toBe("frame-ancestors 'none'");
    expect(spFrameAncestorsPolicy('')).toBe("frame-ancestors 'none'");
    expect(spFrameAncestorsPolicy('   ')).toBe("frame-ancestors 'none'");
  });

  it('lists the exact origins, space-separated, without duplicates', () => {
    expect(spFrameAncestorsPolicy('https://reporting.example.org  http://localhost:4200 https://reporting.example.org')).toBe(
      'frame-ancestors https://reporting.example.org http://localhost:4200',
    );
  });

  it('ignores anything that is not a bare http(s) origin', () => {
    for (const bad of [
      'https://reporting.example.org/path',
      'https://reporting.example.org?x=1',
      'https://reporting.example.org#x',
      'https://*.example.org',
      'ftp://reporting.example.org',
      'javascript:alert(1)',
      "'self'",
      '*',
      'reporting.example.org',
      'https://user:pw@reporting.example.org',
      "https://a.example.org;script-src 'unsafe-inline'",
    ]) {
      expect(toFrameOrigin(bad), bad).toBeNull();
    }
    expect(frameAncestorsSources("https://ok.example.org https://bad.example.org/x 'unsafe-inline'")).toBe('https://ok.example.org');
    expect(frameAncestorsSources('https://bad.example.org/x')).toBe("'none'");
  });

  it('tolerates one trailing slash and keeps an explicit port', () => {
    expect(toFrameOrigin('https://reporting.example.org/')).toBe('https://reporting.example.org');
    expect(toFrameOrigin('http://localhost:4200')).toBe('http://localhost:4200');
  });

  it('applies to /sp and /sp/* only', () => {
    expect(isSpPath('/sp')).toBe(true);
    expect(isSpPath('/sp/')).toBe(true);
    expect(isSpPath('/sp/timelines/1/results/2')).toBe(true);
    expect(isSpPath('/sp?code=abc')).toBe(true);
    expect(isSpPath('/')).toBe(false);
    expect(isSpPath('/results')).toBe(false);
    expect(isSpPath('/spa')).toBe(false);
    expect(isSpPath('/sports/sp')).toBe(false);
  });
});

describe('who may frame a page of the app', () => {
  const SP_POLICY = 'frame-ancestors https://reporting.example.org';

  it('every page outside /sp cannot be framed at all, static HTML included', () => {
    for (const path of ['/', '/login', '/results', '/results/9792?timeline=34', '/auth/callback', '/index.csr.html', '/spa', '/sports/sp']) {
      expect(frameHeadersFor(path, SP_POLICY), path).toEqual({
        'Content-Security-Policy': "frame-ancestors 'none'",
        'X-Frame-Options': 'DENY',
      });
    }
  });

  it('/sp pages carry the SP policy only: an X-Frame-Options there would lock Reporting out', () => {
    for (const path of ['/sp', '/sp/', '/sp?code=abc', '/sp/timelines/1/results/2']) {
      expect(frameHeadersFor(path, SP_POLICY), path).toEqual({ 'Content-Security-Policy': SP_POLICY });
    }
  });
});
