import { Logger } from '@nestjs/common';
import { getJson } from './catalog-http.js';
import { UpstreamUnavailableError } from './catalogs.errors.js';

describe('getJson', () => {
  const fetchMock = vi.fn<typeof fetch>();
  const logger = new Logger('test');

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('refuses redirects (redirect: error), so the key is never forwarded to another host', async () => {
    fetchMock.mockImplementation((_url, init) => {
      // What fetch does with `redirect: 'error'` on a 3xx; with 'follow' it would resend headers.
      if (init?.redirect === 'error')
        return Promise.reject(new TypeError('redirect'));
      return Promise.resolve(
        new Response('{}', {
          status: 302,
          headers: { location: 'https://evil.example/' },
        }),
      );
    });

    await expect(
      getJson(
        'reporting',
        'https://reporting.example.org/x',
        { 'x-api-key': 'k' },
        logger,
      ),
    ).rejects.toBeInstanceOf(UpstreamUnavailableError);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.redirect).toBe('error');
    expect(fetchMock.mock.calls[0][0]).toBe('https://reporting.example.org/x');
  });
});
