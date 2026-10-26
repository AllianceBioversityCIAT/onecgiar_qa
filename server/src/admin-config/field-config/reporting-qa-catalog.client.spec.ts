import { readFileSync } from 'node:fs';
import { Logger } from '@nestjs/common';
import {
  CATALOG_FRESH_MS,
  CATALOG_STALE_LIMIT_MS,
} from '../../users/catalogs/catalog.service.js';
import { UpstreamUnavailableError } from '../../users/catalogs/catalogs.errors.js';
import { FieldCatalogMissingError } from './field-catalog.ports.js';
import { ReportingQaCatalogClient } from './reporting-qa-catalog.client.js';

const FIXTURE: unknown = JSON.parse(
  readFileSync(
    new URL('./fixtures/reporting-qa-catalog-2026.json', import.meta.url),
    'utf8',
  ),
);

const config = {
  reportingApiUrl: 'https://reporting.example.org/api/',
  clarisaApiUrl: 'https://clarisa.example.org/api/',
  apiKey: 'unit-test-key',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const urlOf = (u: Parameters<typeof fetch>[0]): string =>
  typeof u === 'string' ? u : u instanceof URL ? u.href : u.url;

describe('ReportingQaCatalogClient', () => {
  const fetchMock = vi.fn<typeof fetch>();
  let nowMs: number;
  let client: ReportingQaCatalogClient;

  beforeEach(() => {
    // The clock is in 2026; cycle 2027 must still ask for 2027.
    nowMs = Date.UTC(2026, 9, 20, 10, 0, 0);
    client = new ReportingQaCatalogClient(config, () => new Date(nowMs));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('asks for the year it is given, not the clock year, with the key in x-api-key only', async () => {
    fetchMock.mockResolvedValue(json(FIXTURE));
    await client.forYear(2027);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://reporting.example.org/api/qa/catalog?phase_year=2027',
    );
    expect(init?.headers).toMatchObject({ 'x-api-key': 'unit-test-key' });
    expect(JSON.stringify(init?.headers)).not.toMatch(/authorization/i);
  });

  it('returns the shaped catalog', async () => {
    fetchMock.mockResolvedValue(json(FIXTURE));
    const catalog = await client.forYear(2026);
    expect(catalog.catalogVersion).toBe('2026.30');
    expect(catalog.fields).toHaveLength(161);
  });

  it('a 404 is FieldCatalogMissingError carrying the year', async () => {
    fetchMock.mockResolvedValue(
      json({ message: 'No QA catalog available for phase_year 2030' }, 404),
    );
    const err = await client.forYear(2030).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FieldCatalogMissingError);
    expect(err).not.toBeInstanceOf(UpstreamUnavailableError);
    expect((err as FieldCatalogMissingError).year).toBe(2030);
  });

  it.each([400, 401, 500, 503])('status %i is unavailable', async (s) => {
    fetchMock.mockResolvedValue(json({ message: 'nope' }, s));
    await expect(client.forYear(2026)).rejects.toBeInstanceOf(
      UpstreamUnavailableError,
    );
  });

  it('a network failure, bad JSON and a malformed catalog are unavailable', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(client.forYear(2026)).rejects.toBeInstanceOf(
      UpstreamUnavailableError,
    );
    fetchMock.mockResolvedValueOnce(new Response('<html>', { status: 200 }));
    await expect(client.forYear(2026)).rejects.toBeInstanceOf(
      UpstreamUnavailableError,
    );
    fetchMock.mockResolvedValueOnce(json({ result_types: [] }));
    await expect(client.forYear(2026)).rejects.toBeInstanceOf(
      UpstreamUnavailableError,
    );
  });

  it('a call that outlives the 10 s timeout is aborted and unavailable', async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
          }),
      );
      const result = client.forYear(2026).then(
        () => 'resolved',
        (err: unknown) => err,
      );
      await vi.advanceTimersByTimeAsync(10_001);
      expect(await result).toBeInstanceOf(UpstreamUnavailableError);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never logs the key', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn');
    fetchMock.mockResolvedValue(json({}, 401));
    await client.forYear(2026).catch(() => undefined);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('unit-test-key');
  });

  describe('cache, keyed by year', () => {
    const body2027 = () => {
      const raw = structuredClone(FIXTURE) as { catalog_version: string };
      raw.catalog_version = '2027.1';
      return raw;
    };

    it('serves a fresh copy without asking again', async () => {
      fetchMock.mockImplementation(() => Promise.resolve(json(FIXTURE)));
      await client.forYear(2026);
      nowMs += CATALOG_FRESH_MS - 1;
      await client.forYear(2026);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      nowMs += 2;
      await client.forYear(2026);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('keeps 2026 and 2027 apart: neither overwrites the other', async () => {
      fetchMock.mockImplementation((url) =>
        Promise.resolve(
          json(urlOf(url).endsWith('2027') ? body2027() : FIXTURE),
        ),
      );
      const a = await client.forYear(2026);
      const b = await client.forYear(2027);
      expect(a.catalogVersion).toBe('2026.30');
      expect(b.catalogVersion).toBe('2027.1');
      expect(fetchMock).toHaveBeenCalledTimes(2);
      // Both are served from the cache now, each its own.
      expect((await client.forYear(2026)).catalogVersion).toBe('2026.30');
      expect((await client.forYear(2027)).catalogVersion).toBe('2027.1');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('serves a stale copy up to 24 h when Reporting fails, per year', async () => {
      fetchMock.mockImplementation((url) =>
        Promise.resolve(
          json(urlOf(url).endsWith('2027') ? body2027() : FIXTURE),
        ),
      );
      await client.forYear(2026);
      await client.forYear(2027);
      nowMs += CATALOG_STALE_LIMIT_MS;
      fetchMock.mockImplementation(() => Promise.resolve(json({}, 500)));
      expect((await client.forYear(2026)).catalogVersion).toBe('2026.30');
      expect((await client.forYear(2027)).catalogVersion).toBe('2027.1');
      // A year never cached has nothing to fall back on.
      await expect(client.forYear(2028)).rejects.toBeInstanceOf(
        UpstreamUnavailableError,
      );
    });

    it('stops serving a copy older than 24 h', async () => {
      fetchMock.mockImplementation(() => Promise.resolve(json(FIXTURE)));
      await client.forYear(2026);
      nowMs += CATALOG_STALE_LIMIT_MS + 1;
      fetchMock.mockImplementation(() => Promise.resolve(json({}, 500)));
      await expect(client.forYear(2026)).rejects.toBeInstanceOf(
        UpstreamUnavailableError,
      );
    });

    it('does not cache a 404: the next call asks again and can succeed', async () => {
      fetchMock.mockResolvedValueOnce(json({ message: 'none' }, 404));
      await expect(client.forYear(2027)).rejects.toBeInstanceOf(
        FieldCatalogMissingError,
      );
      fetchMock.mockResolvedValueOnce(json(body2027()));
      expect((await client.forYear(2027)).catalogVersion).toBe('2027.1');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('a 404 is not covered by a stale copy of the same year', async () => {
      fetchMock.mockResolvedValueOnce(json(FIXTURE));
      await client.forYear(2026);
      nowMs += CATALOG_FRESH_MS + 1;
      fetchMock.mockResolvedValueOnce(json({ message: 'gone' }, 404));
      await expect(client.forYear(2026)).rejects.toBeInstanceOf(
        FieldCatalogMissingError,
      );
    });

    it('shares one upstream call between concurrent requests for a year', async () => {
      fetchMock.mockImplementation(() => Promise.resolve(json(FIXTURE)));
      await Promise.all([client.forYear(2026), client.forYear(2026)]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
