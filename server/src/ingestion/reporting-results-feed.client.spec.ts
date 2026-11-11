// @akili-spec ingestion/step-1-loads
import { readFileSync } from 'node:fs';
import { LogSpy } from '../../test/support/log-spy.js';
import { ReportingResultsFeedClient } from './reporting-results-feed.client.js';
import { FeedError } from './results-feed.port.js';

// Fixtures: the JSON examples of `qa-catalog.en.md` v1.29 (Reporting repo,
// 654cbab4d), copied by script, not typed: § Results feed (list, details) and
// § Intake and release (intake, release).
const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'),
  );

const KEY = 'test-key-SHOULD-NOT-LEAK';
const config = {
  reportingApiUrl: 'https://reporting.example.org/api/',
  clarisaApiUrl: 'https://clarisa.example.org/api/',
  apiKey: KEY,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

type Call = (c: ReportingResultsFeedClient) => Promise<unknown>;
const OPS: Array<[string, Call]> = [
  ['list', (c) => c.list({ phaseYear: 2026 })],
  ['details', (c) => c.details({ phaseYear: 2026, resultIds: [900001] })],
  ['intake', (c) => c.intake({ phaseYear: 2026, resultIds: [900001] })],
  [
    'release',
    (c) =>
      c.release({
        phaseYear: 2026,
        items: [{ resultId: 900001, outcome: 'qaed' }],
      }),
  ],
];

const kindOf = async (p: Promise<unknown>): Promise<FeedError> => {
  try {
    await p;
  } catch (err) {
    if (err instanceof FeedError) return err;
    throw err;
  }
  throw new Error('expected a FeedError');
};

describe('ReportingResultsFeedClient', () => {
  const fetchMock = vi.fn<typeof fetch>();
  const client = new ReportingResultsFeedClient(config);
  const spy = new LogSpy();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    spy.attach();
  });
  afterEach(() => {
    spy.detach();
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
    spy.lines.length = 0;
  });

  describe('parsing the contract examples', () => {
    it('list: GET /qa/results with the query and the key in x-api-key only', async () => {
      fetchMock.mockResolvedValue(json(fixture('results-list')));
      const page = await client.list({
        phaseYear: 2026,
        programIds: [5, 7],
        resultTypeKeys: ['policy_change'],
        page: 1,
        pageSize: 100,
      });
      expect(page).toEqual({
        phase: 2026,
        page: 1,
        pageSize: 100,
        total: 1,
        breakdown: {
          byProgram: [{ clarisaId: 5, code: 'SP05', count: 1 }],
          byResultType: [{ key: 'policy_change', count: 1 }],
        },
        items: [
          {
            resultId: 900001,
            resultCode: 5120,
            program: { clarisaId: 5, code: 'SP05' },
            resultTypeKey: 'policy_change',
            submittedAt: '2026-09-30T14:03:12.000Z',
          },
        ],
      });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(
        'https://reporting.example.org/api/qa/results?phase_year=2026&program_ids=5%2C7&result_type_keys=policy_change&page=1&page_size=100',
      );
      expect(init?.method).toBe('GET');
      expect(init?.headers).toMatchObject({ 'x-api-key': KEY });
      expect(JSON.stringify(init?.headers)).not.toMatch(/authorization/i);
    });

    it('list: a null submitted_at is kept as null', async () => {
      const body = fixture('results-list') as {
        items: Array<Record<string, unknown>>;
      };
      body.items[0].submitted_at = null;
      fetchMock.mockResolvedValue(json(body));
      const page = await client.list({ phaseYear: 2026 });
      expect(page.items[0].submittedAt).toBeNull();
    });

    it('details: POST /qa/results/details with the snake_case body', async () => {
      fetchMock.mockResolvedValue(json(fixture('results-details')));
      const details = await client.details({
        phaseYear: 2026,
        resultIds: [900001, 900003],
        fieldKeys: ['general.title'],
      });
      expect(details).toEqual({
        phase: 2026,
        catalogVersion: '2026.31',
        results: [
          {
            resultId: 900001,
            resultCode: 5120,
            resultTypeKey: 'capacity_sharing',
            values: {
              'capacity_sharing.length_of_training': { value: 4, degree: 2 },
            },
            // Synthetic (not in the contract example): one named id, one id with no row.
            labels: { countries: { '170': 'Colombia', '999': null } },
          },
        ],
        notEligible: [{ resultId: 900003, reason: 'not_submitted' }],
      });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://reporting.example.org/api/qa/results/details');
      expect(init?.method).toBe('POST');
      expect(JSON.parse(init?.body as string)).toEqual({
        phase_year: 2026,
        result_ids: [900001, 900003],
        field_keys: ['general.title'],
      });
      expect(init?.headers).toMatchObject({
        'x-api-key': KEY,
        'content-type': 'application/json',
      });
    });

    describe('details: labels (FR-20, DD-6)', () => {
      const withLabels = (labels: unknown, present = true) => {
        const body = fixture('results-details') as {
          results: Array<Record<string, unknown>>;
        };
        if (present) body.results[0].labels = labels;
        else delete body.results[0].labels;
        fetchMock.mockResolvedValue(json(body));
        return client.details({ phaseYear: 2026, resultIds: [900001] });
      };

      it('present: kept as sent, a null label included', async () => {
        const { results } = await withLabels({
          countries: { '170': 'Colombia', '999': null },
          regions: {},
        });
        expect(results[0].labels).toEqual({
          countries: { '170': 'Colombia', '999': null },
          regions: {},
        });
        expect(spy.lines.join('\n')).not.toContain('labels_malformed');
      });

      it('absent: no labels key and no log line', async () => {
        const { results } = await withLabels(undefined, false);
        expect(results[0]).not.toHaveProperty('labels');
        expect(spy.lines.join('\n')).not.toContain('labels_malformed');
      });

      it.each([
        ['an array', [1, 2]],
        ['a number', 7],
        ['null', null],
        ['a list that is an array', { countries: ['Colombia'] }],
        ['a list that is a string', { countries: 'Colombia' }],
        ['number values', { countries: { '170': 170 } }],
        [
          'one bad list among good ones',
          { ok: { '1': 'One' }, bad: { '2': 2 } },
        ],
      ])(
        'malformed (%s): dropped, the load does not fail, the values stay, only the reason word is logged',
        async (_name, labels) => {
          const { results } = await withLabels(labels);
          expect(results[0]).not.toHaveProperty('labels');
          expect(results[0].values).toEqual({
            'capacity_sharing.length_of_training': { value: 4, degree: 2 },
          });
          const logged = spy.lines.filter((l) =>
            l.includes('labels_malformed'),
          );
          expect(logged).toHaveLength(1);
          expect(logged[0]).toBe(
            'upstream_bad_labels source=reporting reason=labels_malformed',
          );
        },
      );

      it('never puts a label in a log line', async () => {
        await withLabels({ countries: { '170': 'SECRET-LABEL', '2': 2 } });
        expect(spy.lines.join('\n')).not.toContain('SECRET-LABEL');
      });
    });

    it('details: omits field_keys when none are given', async () => {
      fetchMock.mockResolvedValue(json(fixture('results-details')));
      await client.details({ phaseYear: 2026, resultIds: [1] });
      expect(
        JSON.parse(fetchMock.mock.calls[0][1]?.body as string),
      ).not.toHaveProperty('field_keys');
    });

    it('intake: POST /qa/results/intake', async () => {
      fetchMock.mockResolvedValue(json(fixture('intake')));
      await expect(
        client.intake({ phaseYear: 2026, resultIds: [900001, 900002] }),
      ).resolves.toEqual({
        phaseYear: 2026,
        taken: [{ resultId: 900001, resultCode: 5001, changed: true }],
        notTaken: [
          { resultId: 900002, resultCode: 5002, reason: 'not_submitted' },
        ],
      });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://reporting.example.org/api/qa/results/intake');
      expect(JSON.parse(init?.body as string)).toEqual({
        phase_year: 2026,
        result_ids: [900001, 900002],
      });
    });

    it('release: POST /qa/results/release with { result_id, outcome } items', async () => {
      fetchMock.mockResolvedValue(json(fixture('release')));
      await expect(
        client.release({
          phaseYear: 2026,
          items: [
            { resultId: 900001, outcome: 'qaed' },
            { resultId: 900002, outcome: 'not_qaed' },
          ],
        }),
      ).resolves.toEqual({
        phaseYear: 2026,
        released: [{ resultId: 900001, resultCode: 5001, outcome: 'qaed' }],
        notReleased: [
          { resultId: 900002, resultCode: 5002, reason: 'not_in_qa' },
        ],
      });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://reporting.example.org/api/qa/results/release');
      expect(JSON.parse(init?.body as string)).toEqual({
        phase_year: 2026,
        items: [
          { result_id: 900001, outcome: 'qaed' },
          { result_id: 900002, outcome: 'not_qaed' },
        ],
      });
    });

    it('intake: a null result_code on not_found is accepted', async () => {
      const body = fixture('intake') as {
        not_taken: Array<Record<string, unknown>>;
      };
      body.not_taken[0] = {
        result_id: 9,
        result_code: null,
        reason: 'not_found',
      };
      fetchMock.mockResolvedValue(json(body));
      const out = await client.intake({ phaseYear: 2026, resultIds: [9] });
      expect(out.notTaken[0].resultCode).toBeNull();
    });
  });

  describe.each(OPS)('%s error kinds', (_name, call) => {
    it('401 is unauthorized', async () => {
      fetchMock.mockResolvedValue(json({ message: 'no' }, 401));
      const err = await kindOf(call(client));
      expect(err.kind).toBe('unauthorized');
    });

    it.each([400, 403, 404, 409, 422])(
      '%i is rejected with its status',
      async (s) => {
        fetchMock.mockResolvedValue(json({ message: 'no' }, s));
        const err = await kindOf(call(client));
        expect([err.kind, err.status]).toEqual(['rejected', s]);
      },
    );

    it.each([500, 502, 503])('%i is unavailable', async (s) => {
      fetchMock.mockResolvedValue(json({ message: 'no' }, s));
      const err = await kindOf(call(client));
      expect(err.kind).toBe('unavailable');
    });

    it('a network failure is unavailable', async () => {
      fetchMock.mockRejectedValue(new TypeError('fetch failed'));
      const err = await kindOf(call(client));
      expect(err.kind).toBe('unavailable');
    });

    it('a body that is not JSON is unavailable', async () => {
      fetchMock.mockResolvedValue(new Response('<html>', { status: 200 }));
      const err = await kindOf(call(client));
      expect(err.kind).toBe('unavailable');
    });

    it('a malformed body is unavailable', async () => {
      fetchMock.mockResolvedValue(json({ unexpected: true }));
      const err = await kindOf(call(client));
      expect(err.kind).toBe('unavailable');
    });
  });

  it('a wrong field type inside an item is unavailable', async () => {
    const body = fixture('results-list') as {
      items: Array<Record<string, unknown>>;
    };
    body.items[0].result_id = '900001';
    fetchMock.mockResolvedValue(json(body));
    const err = await kindOf(client.list({ phaseYear: 2026 }));
    expect(err.kind).toBe('unavailable');
  });

  it('an unknown release outcome is unavailable', async () => {
    const body = fixture('release') as {
      released: Array<Record<string, unknown>>;
    };
    body.released[0].outcome = 'maybe';
    fetchMock.mockResolvedValue(json(body));
    const err = await kindOf(
      client.release({
        phaseYear: 2026,
        items: [{ resultId: 900001, outcome: 'qaed' }],
      }),
    );
    expect(err.kind).toBe('unavailable');
  });

  it('aborts at 10 s and is unavailable', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    const pending = kindOf(client.list({ phaseYear: 2026 }));
    await vi.advanceTimersByTimeAsync(9_999);
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect((await pending).kind).toBe('unavailable');
  });

  it('refuses redirects, so the key is never forwarded', async () => {
    fetchMock.mockResolvedValue(json(fixture('intake')));
    await client.intake({ phaseYear: 2026, resultIds: [1] });
    expect(fetchMock.mock.calls[0][1]?.redirect).toBe('error');
  });

  describe('NFR-1: the key is in no sink', () => {
    const seen = (extra: string[] = []) =>
      [...spy.lines, ...extra].filter((l) => l.includes(KEY));

    it('a 401, a 500 and a timeout leave no trace of the key in any log line or error', async () => {
      const messages: string[] = [];
      const record = async (p: Promise<unknown>) => {
        const err = await kindOf(p);
        messages.push(err.message, String(err), JSON.stringify(err));
      };

      fetchMock.mockResolvedValueOnce(json({ message: 'no' }, 401));
      await record(client.intake({ phaseYear: 2026, resultIds: [1] }));

      fetchMock.mockResolvedValueOnce(json({ message: 'boom' }, 500));
      await record(client.list({ phaseYear: 2026 }));

      vi.useFakeTimers();
      fetchMock.mockImplementationOnce(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
          }),
      );
      const timeout = record(
        client.details({ phaseYear: 2026, resultIds: [1] }),
      );
      await vi.advanceTimersByTimeAsync(10_000);
      await timeout;

      // The key did travel (the test is not vacuous) and the sinks saw lines.
      expect(
        fetchMock.mock.calls.every(
          ([, init]) =>
            (init?.headers as Record<string, string> | undefined)?.[
              'x-api-key'
            ] === KEY,
        ),
      ).toBe(true);
      expect(spy.lines.length).toBeGreaterThanOrEqual(3);
      expect(seen(messages)).toEqual([]);
    });
  });
});
