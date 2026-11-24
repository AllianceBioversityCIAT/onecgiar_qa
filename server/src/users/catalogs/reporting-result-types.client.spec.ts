import { readFileSync } from 'node:fs';
import { Logger } from '@nestjs/common';
import { UpstreamUnavailableError } from './catalogs.errors.js';
import { ReportingResultTypesClient } from './reporting-result-types.client.js';

// Fixture: trimmed real response of Reporting TEST `GET /qa/catalog?phase_year=`
// (2026-10-19): the first 4 of 9 result types, one section and one field.
const FIXTURE: unknown = JSON.parse(
  readFileSync(
    new URL('./fixtures/reporting-qa-catalog.json', import.meta.url),
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

describe('ReportingResultTypesClient', () => {
  const fetchMock = vi.fn<typeof fetch>();
  const client = new ReportingResultTypesClient(config);

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('maps result_types { key, label } to { key, name }, in catalog order', async () => {
    fetchMock.mockResolvedValue(json(FIXTURE));
    await expect(client.list()).resolves.toEqual([
      { key: 'policy_change', name: 'Policy change' },
      { key: 'innovation_use', name: 'Innovation use' },
      { key: 'other_outcome', name: 'Other outcome' },
      { key: 'capacity_sharing', name: 'Capacity sharing for development' },
    ]);
  });

  it('calls GET {base}/qa/catalog?phase_year=<year> with the key in x-api-key only', async () => {
    fetchMock.mockResolvedValue(json(FIXTURE));
    await client.list();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `https://reporting.example.org/api/qa/catalog?phase_year=${new Date().getUTCFullYear()}`,
    );
    expect(init?.headers).toMatchObject({ 'x-api-key': 'unit-test-key' });
    expect(JSON.stringify(init?.headers)).not.toMatch(/authorization/i);
  });

  it('skips entries without a key or a label', async () => {
    fetchMock.mockResolvedValue(
      json({
        result_types: [
          { key: '', label: 'A' },
          { key: 'b', label: '' },
          { label: 'C' },
          { key: 'd', label: 'D' },
        ],
      }),
    );
    await expect(client.list()).resolves.toEqual([{ key: 'd', name: 'D' }]);
  });

  it.each([401, 403, 500, 502, 503])('status %i is unavailable', async (s) => {
    fetchMock.mockResolvedValue(json({ message: 'nope' }, s));
    await expect(client.list()).rejects.toBeInstanceOf(
      UpstreamUnavailableError,
    );
  });

  it('never logs the key', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn');
    fetchMock.mockResolvedValue(json({}, 401));
    await client.list().catch(() => undefined);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('unit-test-key');
  });

  it('a network failure is unavailable', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(client.list()).rejects.toBeInstanceOf(
      UpstreamUnavailableError,
    );
  });

  it.each([[{ result_types: 'x' }], [{ sections: [] }], [[]]])(
    'a body without a result_types array (%j) is unavailable',
    async (body) => {
      fetchMock.mockResolvedValue(json(body));
      await expect(client.list()).rejects.toBeInstanceOf(
        UpstreamUnavailableError,
      );
    },
  );

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
      const result = client.list().then(
        () => 'resolved',
        (err: unknown) => err,
      );
      await vi.advanceTimersByTimeAsync(10_001);
      expect(await result).toBeInstanceOf(UpstreamUnavailableError);
    } finally {
      vi.useRealTimers();
    }
  });
});
