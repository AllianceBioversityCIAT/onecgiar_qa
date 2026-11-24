import { Logger } from '@nestjs/common';
import { CATALOG_NOT_FOUND, getJson } from './catalog-http.js';
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
  describe('notFound: outcome (opt-in)', () => {
    const call = (options?: { notFound?: 'outcome' }) =>
      getJson(
        'reporting',
        'https://reporting.example.org/x',
        { 'x-api-key': 'k' },
        logger,
        options,
      );

    it('returns the not-found outcome on a 404 when the caller opts in', async () => {
      fetchMock.mockResolvedValue(new Response('{}', { status: 404 }));
      await expect(call({ notFound: 'outcome' })).resolves.toBe(
        CATALOG_NOT_FOUND,
      );
    });

    it('keeps a 404 as unavailable without the opt-in', async () => {
      fetchMock.mockResolvedValue(new Response('{}', { status: 404 }));
      await expect(call()).rejects.toBeInstanceOf(UpstreamUnavailableError);
    });

    it('keeps every other non-2xx as unavailable even with the opt-in', async () => {
      for (const status of [400, 401, 403, 500, 503]) {
        fetchMock.mockResolvedValueOnce(new Response('{}', { status }));
        await expect(call({ notFound: 'outcome' })).rejects.toBeInstanceOf(
          UpstreamUnavailableError,
        );
      }
    });
  });
});
