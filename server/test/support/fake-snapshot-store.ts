import { snapshotSortSuffix } from '../../src/database/dynamodb/entities/result-snapshot.entity.js';
import {
  SnapshotConflictError,
  type ResultSnapshotRecord,
  type SnapshotStore,
} from '../../src/ingestion/snapshot-store.port.js';

/** In-memory `SnapshotStore` with the same idempotency and ordering rules. */
export class FakeSnapshotStore implements SnapshotStore {
  private readonly items = new Map<string, ResultSnapshotRecord>();

  put(s: ResultSnapshotRecord): Promise<void> {
    const key = `${s.resultCode}|${snapshotSortSuffix(s)}`;
    const existing = this.items.get(key);
    if (existing)
      return existing.hash === s.hash
        ? Promise.resolve()
        : Promise.reject(new SnapshotConflictError());
    this.items.set(key, structuredClone(s));
    return Promise.resolve();
  }

  history(resultCode: number): Promise<ResultSnapshotRecord[]> {
    const rows = [...this.items.entries()]
      .filter(([k]) => k.startsWith(`${resultCode}|`))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, v]) => structuredClone(v));
    return Promise.resolve(rows);
  }

  get size(): number {
    return this.items.size;
  }
}
