// @akili-spec ingestion/step-1-loads
// Opt-in: runs only against DynamoDB Local (`DYNAMODB_ENDPOINT`) or, with
// `DYNAMODB_IT=remote`, against the dev table `cgiar-qa-test`. Never in the
// default run. Every item it writes is deleted in `afterAll`.
import { randomBytes } from 'node:crypto';
import { writeSync } from 'node:fs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { afterAll, describe, expect, it } from 'vitest';
import { snapshotSortSuffix } from '../database/dynamodb/entities/result-snapshot.entity.js';
import { createResultSnapshotEntity } from '../database/dynamodb/entities/result-snapshot.entity.js';
import { DynamoSnapshotStore } from './dynamo-snapshot-store.js';
import {
  SnapshotConflictError,
  type ResultSnapshotRecord,
} from './snapshot-store.port.js';

const REMOTE_TABLE = 'cgiar-qa-test';
const local = !!process.env.DYNAMODB_ENDPOINT;
const remote = process.env.DYNAMODB_IT === 'remote';
const enabled = local || remote;
const table = process.env.DYNAMODB_TABLE_NAME ?? '';

describe.skipIf(!enabled)('DynamoSnapshotStore against a real table', () => {
  if (enabled && !local && table !== REMOTE_TABLE)
    throw new Error(`refusing to run against table "${table}"`);

  const accessKeyId = process.env.DYNAMODB_ACCESS_KEY_ID;
  const secretAccessKey = process.env.DYNAMODB_SECRET_ACCESS_KEY;
  const client = new DynamoDBClient({
    region: process.env.AWS_REGION,
    endpoint: process.env.DYNAMODB_ENDPOINT || undefined,
    ...(accessKeyId && secretAccessKey
      ? { credentials: { accessKeyId, secretAccessKey } }
      : {}),
  });
  const entity = createResultSnapshotEntity(client, table);
  const store = new DynamoSnapshotStore(client, table);
  const base = 990_000_000 + Math.floor(Math.random() * 10_000);
  const codes = [base, base + 10_000];
  const written: ResultSnapshotRecord[] = [];

  const snap = (over: Partial<ResultSnapshotRecord>): ResultSnapshotRecord => ({
    resultCode: base,
    resultId: 1,
    phaseYear: 2026,
    cycleId: 1,
    timelineId: 2,
    loadId: 10,
    resultTypeKey: 'KP',
    programClarisaId: 3,
    catalogVersion: 'it',
    hash: 'h1',
    loadedAt: '2026-11-04T10:00:00.000Z',
    values: { a: [1, null], b: null },
    ...over,
  });
  const put = async (s: ResultSnapshotRecord) => {
    written.push(s);
    await store.put(s);
  };

  afterAll(async () => {
    for (const s of written)
      await entity
        .delete({ resultCode: s.resultCode, snapKey: snapshotSortSuffix(s) })
        .go();
    let remaining = 0;
    for (const code of codes) remaining += (await store.history(code)).length;
    writeSync(
      1,
      `\n[dynamo-it] items written: ${written.length}; remaining after cleanup: ${remaining}\n`,
    );
    if (remaining > 0) throw new Error('cleanup left items behind');
  });

  it('is idempotent for the same hash and refuses another', async () => {
    await put(snap({}));
    await put(snap({}));
    await expect(store.put(snap({ hash: 'h2' }))).rejects.toBeInstanceOf(
      SnapshotConflictError,
    );
    expect(await store.history(base)).toHaveLength(1);
  });

  it('returns history ordered, and isolates results', async () => {
    await put(snap({ timelineId: 10, loadId: 1 }));
    await put(snap({ phaseYear: 2027, timelineId: 7, loadId: 3 }));
    await put(snap({ resultCode: base + 10_000 }));
    const h = await store.history(base);
    expect(h.map((r) => [r.phaseYear, r.timelineId, r.loadId])).toEqual([
      [2026, 2, 10],
      [2026, 10, 1],
      [2027, 7, 3],
    ]);
  });

  it('round-trips a gzip item above 256 KB', async () => {
    const big = { blob: randomBytes(150 * 1024).toString('hex') };
    await put(snap({ loadId: 99, values: big }));
    const h = await store.history(base);
    expect(h.find((r) => r.loadId === 99)?.values).toEqual(big);
  });

  it('gets by exact key, null for a near-miss, and inflates gzip', async () => {
    const big = { blob: randomBytes(150 * 1024).toString('hex') };
    await put(snap({ loadId: 98, values: big }));
    const sk = snapshotSortSuffix(snap({ loadId: 98 }));
    expect((await store.get(base, sk))?.values).toEqual(big);
    expect(
      await store.get(base, snapshotSortSuffix(snap({ loadId: 97 }))),
    ).toBeNull();
  });

  it('keeps labels beside the values: the first labels win a same-hash retry, and a labels-less item reads none', async () => {
    const first = { countries: { '170': 'Colombia', '999': null } };
    await put(snap({ loadId: 96, labels: first }));
    await store.put(
      snap({
        loadId: 96,
        labels: { countries: { '170': 'Republic of Colombia' } },
      }),
    );
    const sk = snapshotSortSuffix(snap({ loadId: 96 }));
    expect((await store.get(base, sk))?.labels).toEqual(first);
    await put(snap({ loadId: 95 }));
    expect(
      await store.get(base, snapshotSortSuffix(snap({ loadId: 95 }))),
    ).not.toHaveProperty('labels');
  });

  it('round-trips labels above 256 KB through gzip', async () => {
    const big = { list: { '1': randomBytes(150 * 1024).toString('hex') } };
    await put(snap({ loadId: 94, labels: big }));
    const sk = snapshotSortSuffix(snap({ loadId: 94 }));
    expect((await store.get(base, sk))?.labels).toEqual(big);
  });
});
