// @akili-spec ingestion/step-1-loads
import type { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { Entity } from 'electrodb';

export interface SnapshotKeyParts {
  phaseYear: number;
  cycleId: number;
  timelineId: number;
  loadId: number;
}

const pad = (n: number, width: number): string => {
  if (!Number.isInteger(n) || n < 0 || String(n).length > width)
    throw new RangeError(`snapshot key part out of range: ${n}`);
  return String(n).padStart(width, '0');
};

/**
 * The part of the sort key after `SNAP#` (design § 5.4). Zero-padded so a
 * Query on one pk sorts by year, cycle, timeline, load (FR-6).
 */
export function snapshotSortSuffix(p: SnapshotKeyParts): string {
  return `${p.phaseYear}#${pad(p.cycleId, 6)}#${pad(p.timelineId, 8)}#${pad(p.loadId, 10)}`;
}

/**
 * `ResultSnapshot` (design § 5.4). The sort key composite is the pre-padded
 * `snapKey` because ElectroDB templates cannot pad numbers.
 */
export function createResultSnapshotEntity(
  client: DynamoDBClient,
  table: string,
) {
  return new Entity(
    {
      model: { entity: 'resultSnapshot', version: '1', service: 'qa' },
      attributes: {
        resultCode: { type: 'number', required: true },
        snapKey: { type: 'string', required: true },
        resultId: { type: 'number', required: true },
        phaseYear: { type: 'number', required: true },
        cycleId: { type: 'number', required: true },
        timelineId: { type: 'number', required: true },
        loadId: { type: 'number', required: true },
        resultTypeKey: { type: 'string', required: true },
        programClarisaId: { type: 'number', required: true },
        catalogVersion: { type: 'string', required: true },
        hash: { type: 'string', required: true },
        loadedAt: { type: 'string', required: true },
        values: { type: 'string' },
        valuesGz: { type: 'any' },
        labels: { type: 'string' },
        labelsGz: { type: 'any' },
      },
      indexes: {
        snapshot: {
          pk: {
            field: 'pk',
            casing: 'none',
            composite: ['resultCode'],
            template: 'RESULT#${resultCode}',
          },
          sk: {
            field: 'sk',
            casing: 'none',
            composite: ['snapKey'],
            template: 'SNAP#${snapKey}',
          },
        },
      },
    },
    { client, table },
  );
}

export type ResultSnapshotEntity = ReturnType<
  typeof createResultSnapshotEntity
>;
