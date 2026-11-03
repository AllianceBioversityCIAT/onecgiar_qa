import { readFileSync } from 'node:fs';
import { Logger } from '@nestjs/common';
import { UpstreamUnavailableError } from './catalogs.errors.js';
import { ClarisaScienceProgramsClient } from './clarisa-science-programs.client.js';

// Fixture: trimmed real response of CLARISA TEST
// `GET /cgiar-entities/by-portfolio?portfolioId=2,3&version=2` (2026-10-19):
// a Science Program, an Accelerator (both active) and an inactive program.
const FIXTURE: unknown = JSON.parse(
  readFileSync(
    new URL('./fixtures/clarisa-entities-by-portfolio.json', import.meta.url),
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

describe('ClarisaScienceProgramsClient', () => {
  const fetchMock = vi.fn<typeof fetch>();
  const client = new ClarisaScienceProgramsClient(config);

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('maps active rows to { id, code, name } with the CLARISA id, ordered by id', async () => {
    fetchMock.mockResolvedValue(json([...(FIXTURE as unknown[])].reverse()));
    await expect(client.list()).resolves.toEqual([
      { id: 441, code: 'SP01', name: 'Breeding for Tomorrow' },
      { id: 452, code: 'SP12', name: 'Digital Transformation' },
    ]);
  });

  it('calls GET {base}/initiatives with no credential', async () => {
    fetchMock.mockResolvedValue(json(FIXTURE));
    await client.list();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://clarisa.example.org/api/cgiar-entities/by-portfolio?portfolioId=2,3&version=2',
    );
    expect(init?.method ?? 'GET').toBe('GET');
    expect(JSON.stringify(init?.headers)).not.toMatch(/authorization|key/i);
  });

  it('skips rows without a numeric id, a code or a name', async () => {
    fetchMock.mockResolvedValue(
      json([
        { id: 'x', code: 'A', name: 'A', is_active: 1 },
        { id: 2, code: '', name: 'B', is_active: 1 },
        { id: 3, code: 'C', name: '', is_active: 1 },
        { id: 4, code: 'D', name: 'D', is_active: 1 },
      ]),
    );
    await expect(client.list()).resolves.toEqual([
      { id: 4, code: 'D', name: 'D' },
    ]);
  });

  it.each([500, 502, 503, 401, 404])('status %i is unavailable', async (s) => {
    fetchMock.mockResolvedValue(json({ message: 'nope' }, s));
    await expect(client.list()).rejects.toBeInstanceOf(
      UpstreamUnavailableError,
    );
  });

  it('a network failure is unavailable', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(client.list()).rejects.toBeInstanceOf(
      UpstreamUnavailableError,
    );
  });

  it('a body that is not an array is unavailable', async () => {
    fetchMock.mockResolvedValue(json({ data: [] }));
    await expect(client.list()).rejects.toBeInstanceOf(
      UpstreamUnavailableError,
    );
  });

  it('a body that is not JSON is unavailable', async () => {
    fetchMock.mockResolvedValue(new Response('<html>', { status: 200 }));
    await expect(client.list()).rejects.toBeInstanceOf(
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
