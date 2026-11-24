// @akili-spec ingestion/step-1-loads
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { snapshotSortSuffix } from '../database/dynamodb/entities/result-snapshot.entity.js';
import { createFakeDynamoClient } from '../../test/support/fake-dynamodb-client.js';
import { FakeSnapshotStore } from '../../test/support/fake-snapshot-store.js';
import { DynamoSnapshotStore } from './dynamo-snapshot-store.js';
import {
  SnapshotConflictError,
  type ResultSnapshotRecord,
  type SnapshotStore,
} from './snapshot-store.port.js';

const snap = (
  over: Partial<ResultSnapshotRecord> = {},
): ResultSnapshotRecord => ({
  resultCode: 5120,
  resultId: 77,
  phaseYear: 2026,
  cycleId: 1,
  timelineId: 2,
  loadId: 10,
  resultTypeKey: 'KP',
  programClarisaId: 3,
  catalogVersion: '1.29',
  hash: 'h1',
  loadedAt: '2026-11-04T10:00:00.000Z',
  values: { title: 'A', list: [1, null, { x: 'y' }], gone: null },
  ...over,
});

describe('snapshot sort key', () => {
  it('pads so a numeric order is the string order', () => {
    const a = snapshotSortSuffix({
      phaseYear: 2026,
      cycleId: 1,
      timelineId: 2,
      loadId: 10,
    });
    const b = snapshotSortSuffix({
      phaseYear: 2026,
      cycleId: 1,
      timelineId: 10,
      loadId: 1,
    });
    expect(a).toBe('2026#000001#00000002#0000000010');
    expect(b).toBe('2026#000001#00000010#0000000001');
    expect(a < b).toBe(true);
  });

  it('refuses a part wider than its field', () => {
    expect(() =>
      snapshotSortSuffix({
        phaseYear: 2026,
        cycleId: 1_000_000,
        timelineId: 1,
        loadId: 1,
      }),
    ).toThrow(RangeError);
  });
});

function contract(
  name: string,
  make: () => { store: SnapshotStore; size: () => number },
) {
  describe(name, () => {
    it('put twice with the same hash leaves one item and succeeds', async () => {
      const { store, size } = make();
      await store.put(snap());
      await expect(store.put(snap())).resolves.toBeUndefined();
      expect(size()).toBe(1);
    });

    it('put with a different hash for the same key is an error', async () => {
      const { store, size } = make();
      await store.put(snap());
      await expect(store.put(snap({ hash: 'h2' }))).rejects.toBeInstanceOf(
        SnapshotConflictError,
      );
      expect(size()).toBe(1);
    });

    it('get returns the record at the exact (resultCode, sk) key', async () => {
      const { store } = make();
      await store.put(snap());
      await store.put(snap({ loadId: 11, hash: 'h2', values: { other: 1 } }));
      const sk = snapshotSortSuffix(snap());
      expect(await store.get(5120, sk)).toEqual(snap());
    });

    it('get returns null for a near-miss key', async () => {
      const { store } = make();
      await store.put(snap());
      const near = snapshotSortSuffix(snap({ loadId: 11 }));
      expect(await store.get(5120, near)).toBeNull();
      expect(await store.get(5121, snapshotSortSuffix(snap()))).toBeNull();
    });

    it('history is ordered by year, cycle, timeline and load', async () => {
      const { store } = make();
      await store.put(snap({ phaseYear: 2027, timelineId: 7, loadId: 3 }));
      await store.put(snap({ timelineId: 10, loadId: 1 }));
      await store.put(snap({ timelineId: 2, loadId: 10 }));
      await store.put(snap({ resultCode: 99999 }));
      const h = await store.history(5120);
      expect(h.map((r) => [r.phaseYear, r.timelineId, r.loadId])).toEqual([
        [2026, 2, 10],
        [2026, 10, 1],
        [2027, 7, 3],
      ]);
      expect(h[0]).toEqual(snap({ timelineId: 2, loadId: 10 }));
    });
  });
}

contract('FakeSnapshotStore', () => {
  const store = new FakeSnapshotStore();
  return { store, size: () => store.size };
});

contract('DynamoSnapshotStore (in-memory DynamoDB)', () => {
  const { client, items } = createFakeDynamoClient();
  return {
    store: new DynamoSnapshotStore(client, 'test-table'),
    size: () => items.size,
  };
});

describe('DynamoSnapshotStore gzip', () => {
  it('round-trips a 300 KB value through gzip and keeps small ones plain', async () => {
    const { client, items } = createFakeDynamoClient();
    const store = new DynamoSnapshotStore(client, 'test-table');
    const big = { blob: randomBytes(150 * 1024).toString('hex') };
    await store.put(snap({ values: big }));
    await store.put(snap({ loadId: 11, values: { small: 1 } }));
    const stored = [...items.values()];
    const bigItem = stored.find((i) => 'valuesGz' in i)!;
    expect(bigItem.values).toBeUndefined();
    expect(stored.filter((i) => 'values' in i)).toHaveLength(1);
    const h = await store.history(5120);
    expect(h[0].values).toEqual(big);
    expect(h[1].values).toEqual({ small: 1 });
    const sk = snapshotSortSuffix(snap({ values: big }));
    expect((await store.get(5120, sk))?.values).toEqual(big);
  });
});
