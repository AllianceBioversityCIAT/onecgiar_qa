// @akili-spec ingestion/step-1-loads
import { gunzipSync, gzipSync } from 'node:zlib';
import { Inject, Injectable } from '@nestjs/common';
import type { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DYNAMODB_CLIENT,
  DYNAMODB_TABLE_NAME,
} from '../database/dynamodb/dynamodb.constants.js';
import {
  createResultSnapshotEntity,
  snapshotSortSuffix,
  type ResultSnapshotEntity,
} from '../database/dynamodb/entities/result-snapshot.entity.js';
import {
  SnapshotConflictError,
  type ResultSnapshotRecord,
  type SnapshotStore,
} from './snapshot-store.port.js';

/** `values` above this many bytes of JSON is stored gzipped (DD-12, NFR-7). */
export const GZIP_THRESHOLD_BYTES = 256 * 1024;

@Injectable()
export class DynamoSnapshotStore implements SnapshotStore {
  private readonly entity: ResultSnapshotEntity;

  constructor(
    @Inject(DYNAMODB_CLIENT) client: DynamoDBClient,
    @Inject(DYNAMODB_TABLE_NAME) table: string,
  ) {
    this.entity = createResultSnapshotEntity(client, table);
  }

  async put(s: ResultSnapshotRecord): Promise<void> {
    const json = JSON.stringify(s.values);
    const big = Buffer.byteLength(json) > GZIP_THRESHOLD_BYTES;
    const snapKey = snapshotSortSuffix(s);
    try {
      await this.entity
        .put({
          resultCode: s.resultCode,
          snapKey,
          resultId: s.resultId,
          phaseYear: s.phaseYear,
          cycleId: s.cycleId,
          timelineId: s.timelineId,
          loadId: s.loadId,
          resultTypeKey: s.resultTypeKey,
          programClarisaId: s.programClarisaId,
          catalogVersion: s.catalogVersion,
          hash: s.hash,
          loadedAt: s.loadedAt,
          ...(big ? { valuesGz: gzipSync(json) } : { values: json }),
        })
        .where(({ resultCode }, { notExists }) => notExists(resultCode))
        .go();
    } catch (error) {
      if (!isConditionFailure(error)) throw error;
      const existing = await this.entity
        .get({ resultCode: s.resultCode, snapKey })
        .go();
      if (existing.data?.hash === s.hash) return;
      throw new SnapshotConflictError();
    }
  }

  async history(resultCode: number): Promise<ResultSnapshotRecord[]> {
    const rows: ResultSnapshotRecord[] = [];
    let cursor: string | null | undefined;
    do {
      const page = await this.entity.query
        .snapshot({ resultCode })
        .go({ cursor, pages: 1 });
      for (const r of page.data) {
        const json = r.valuesGz
          ? gunzipSync(Buffer.from(r.valuesGz as Uint8Array)).toString('utf8')
          : (r.values ?? 'null');
        rows.push({
          resultCode: r.resultCode,
          resultId: r.resultId,
          phaseYear: r.phaseYear,
          cycleId: r.cycleId,
          timelineId: r.timelineId,
          loadId: r.loadId,
          resultTypeKey: r.resultTypeKey,
          programClarisaId: r.programClarisaId,
          catalogVersion: r.catalogVersion,
          hash: r.hash,
          loadedAt: r.loadedAt,
          values: JSON.parse(json) as Record<string, unknown>,
        });
      }
      cursor = page.cursor;
    } while (cursor);
    return rows;
  }
}

function isConditionFailure(error: unknown): boolean {
  const e = error as {
    name?: string;
    cause?: { name?: string };
    code?: number;
    message?: string;
  };
  return (
    e?.name === 'ConditionalCheckFailedException' ||
    e?.cause?.name === 'ConditionalCheckFailedException' ||
    /ConditionalCheckFailed/.test(e?.message ?? '')
  );
}
