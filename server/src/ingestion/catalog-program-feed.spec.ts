// @akili-spec ingestion/step-1-loads
import { describe, expect, it, vi } from 'vitest';
import { CatalogProgramResultsFeed } from './catalog-program-feed.js';
import type { ReportingResultsFeedClient } from './reporting-results-feed.client.js';
import {
  FeedError,
  type FeedListQuery,
  type FeedPage,
} from './results-feed.port.js';

const CATALOG = [
  { id: 441, code: 'SP01', name: 'Breeding for Tomorrow' },
  { id: 442, code: 'SP02', name: 'Sustainable Farming' },
];

const page = (): FeedPage => ({
  phase: 1,
  page: 1,
  pageSize: 100,
  total: 2,
  breakdown: {
    byProgram: [
      { clarisaId: 50, code: 'SP01', count: 1 },
      { clarisaId: 99, code: 'SPX', count: 1 },
    ],
    byResultType: [{ key: 'innovation_use', count: 2 }],
  },
  items: [
    {
      resultId: 1,
      resultCode: 3580,
      program: { clarisaId: 50, code: 'SP01' },
      resultTypeKey: 'innovation_use',
      submittedAt: null,
    },
    {
      resultId: 2,
      resultCode: 3581,
      program: { clarisaId: 99, code: 'SPX' },
      resultTypeKey: 'innovation_use',
      submittedAt: null,
    },
  ],
});

function setup(list = vi.fn(() => Promise.resolve(CATALOG))) {
  const calls: FeedListQuery[] = [];
  const inner = {
    list: vi.fn((q: FeedListQuery) => {
      calls.push(q);
      return Promise.resolve(page());
    }),
  } as unknown as ReportingResultsFeedClient;
  const feed = new CatalogProgramResultsFeed(inner, { list });
  return { feed, calls, list };
}

describe('CatalogProgramResultsFeed', () => {
  it('puts the QA catalog id on items and byProgram, matched by code', async () => {
    const { feed } = setup();
    const read = await feed.list({ phaseYear: 2026 });
    expect(read.items.map((i) => i.program)).toEqual([
      { clarisaId: 441, code: 'SP01' },
      { clarisaId: 99, code: 'SPX' },
    ]);
    expect(read.breakdown.byProgram.map((r) => r.clarisaId)).toEqual([441, 99]);
  });

  it('sends a program filter as codes, never as Reporting ids', async () => {
    const { feed, calls } = setup();
    await feed.list({ phaseYear: 2026, programIds: [441, 442] });
    expect(calls[0]).toEqual({
      phaseYear: 2026,
      programCodes: ['SP01', 'SP02'],
    });
  });

  it('fails rather than widen the scope when a filter id is not in the catalog', async () => {
    const { feed, calls } = setup();
    await expect(
      feed.list({ phaseYear: 2026, programIds: [441, 999] }),
    ).rejects.toBeInstanceOf(FeedError);
    expect(calls).toHaveLength(0);
  });

  it('reads the catalog once across pages', async () => {
    const { feed, list } = setup();
    await feed.list({ phaseYear: 2026, page: 1 });
    await feed.list({ phaseYear: 2026, page: 2 });
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('fails the call when the catalog cannot be read and none is cached', async () => {
    const { feed } = setup(vi.fn(() => Promise.reject(new Error('down'))));
    await expect(feed.list({ phaseYear: 2026 })).rejects.toBeInstanceOf(
      FeedError,
    );
  });
});
