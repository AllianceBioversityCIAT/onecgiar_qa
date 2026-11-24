// @akili-spec ingestion/step-1-loads
/**
 * Port over the immutable per-result snapshot (design § 5.4, DD-1). A snapshot
 * is written before its membership and never changed afterwards.
 */
export const SNAPSHOT_STORE = Symbol('SNAPSHOT_STORE');

export interface ResultSnapshotRecord {
  resultCode: number;
  resultId: number;
  phaseYear: number;
  cycleId: number;
  timelineId: number;
  loadId: number;
  resultTypeKey: string;
  programClarisaId: number;
  catalogVersion: string;
  /** Hash of the values; the idempotency check compares it. */
  hash: string;
  /** The load's `started_at` (ISO), so a retry writes identical content. */
  loadedAt: string;
  values: Record<string, unknown>;
}

export interface SnapshotStore {
  /**
   * Idempotent: the same key with the same hash succeeds without a second item;
   * the same key with another hash throws `SnapshotConflictError`.
   */
  put(snapshot: ResultSnapshotRecord): Promise<void>;
  /** One GetItem by the exact key (`sk` is `snapshotSortSuffix`); null on a miss. */
  get(resultCode: number, sk: string): Promise<ResultSnapshotRecord | null>;
  /** Every snapshot of the result, ordered by year, cycle, timeline, load. */
  history(resultCode: number): Promise<ResultSnapshotRecord[]>;
}

/** The key exists with different content. The runner maps it to `INTERNAL`. */
export class SnapshotConflictError extends Error {
  constructor() {
    super('snapshot_conflict');
    this.name = 'SnapshotConflictError';
  }
}
