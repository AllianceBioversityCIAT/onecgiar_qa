// @akili-spec ingestion/step-1-loads
import { gunzipSync, gzipSync } from 'node:zlib';
import { Inject, Injectable } from '@nestjs/common';
import type { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import type { EntityItem } from 'electrodb';
import {
  DYNAMODB_CLIENT,
  DYNAMODB_TABLE_NAME,
} from '../database/dynamodb/dynamodb.constants.js';
import {
  createResultSnapshotEntity,
  snapshotSortSuffix,
  type ResultSnapshotEntity,
} from '../database/dynamodb/entities/result-snapshot.entity.js';
import type { FeedLabels } from './results-feed.port.js';
import {
  SnapshotConflictError,
  type ResultSnapshotRecord,
  type SnapshotStore,
} from './snapshot-store.port.js';

/** `values` or `labels` above this many bytes of JSON is stored gzipped (DD-12, NFR-7, P-6). */
export const GZIP_THRESHOLD_BYTES = 256 * 1024;

/** One JSON attribute: plain below the threshold, gzipped above it. */
function packJson<P extends string, G extends string>(
  json: string,
  plain: P,
  gz: G,
): { [K in P]: string } | { [K in G]: Buffer } {
  return Buffer.byteLength(json) > GZIP_THRESHOLD_BYTES
    ? ({ [gz]: gzipSync(json) } as { [K in G]: Buffer })
    : ({ [plain]: json } as { [K in P]: string });
}

type StoredRow = EntityItem<ResultSnapshotEntity>;

const unpackJson = (
  plain: string | undefined,
  gz: unknown,
  fallback: string,
): string =>
  gz
    ? gunzipSync(Buffer.from(gz as Uint8Array)).toString('utf8')
    : (plain ?? fallback);

function toRecord(r: StoredRow): ResultSnapshotRecord {
  const hasLabels = Boolean(r.labelsGz) || r.labels !== undefined;
  return {
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
    values: JSON.parse(unpackJson(r.values, r.valuesGz, 'null')) as Record<
      string,
      unknown
    >,
    ...(hasLabels
      ? {
          labels: JSON.parse(
            unpackJson(r.labels, r.labelsGz, 'null'),
          ) as FeedLabels,
        }
      : {}),
  };
}

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
          ...packJson(JSON.stringify(s.values), 'values', 'valuesGz'),
          ...(s.labels
            ? packJson(JSON.stringify(s.labels), 'labels', 'labelsGz')
            : {}),
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

  async get(
    resultCode: number,
    sk: string,
  ): Promise<ResultSnapshotRecord | null> {
    const { data: r } = await this.entity.get({ resultCode, snapKey: sk }).go();
    return r ? toRecord(r) : null;
  }

  async history(resultCode: number): Promise<ResultSnapshotRecord[]> {
    const rows: ResultSnapshotRecord[] = [];
    let cursor: string | null | undefined;
    do {
      const page = await this.entity.query
        .snapshot({ resultCode })
        .go({ cursor, pages: 1 });
      for (const r of page.data) rows.push(toRecord(r));
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
