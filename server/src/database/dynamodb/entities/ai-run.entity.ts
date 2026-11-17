// @akili-spec assessment/ai-suggestions
import type { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { Entity } from 'electrodb';

/**
 * `aiRun` (design § 2): the counters of one run. The worker `ADD`s
 * `produced` / `unavailable` / `failed`; the API only sets `expected` (with a
 * raw UpdateItem, `AiRunStore`), so the two writers compose. Defined here so
 * the contract test reads the worker's items through ElectroDB.
 */
export function createAiRunEntity(client: DynamoDBClient, table: string) {
  return new Entity(
    {
      model: { entity: 'aiRun', version: '1', service: 'qa' },
      attributes: {
        runId: { type: 'string', required: true },
        expected: { type: 'number' },
        produced: { type: 'number' },
        unavailable: { type: 'number' },
        failed: { type: 'number' },
        createdAt: { type: 'string' },
      },
      indexes: {
        run: {
          pk: {
            field: 'pk',
            casing: 'none',
            composite: ['runId'],
            template: 'AIRUN#${runId}',
          },
          sk: { field: 'sk', casing: 'none', composite: [], template: 'RUN' },
        },
      },
    },
    { client, table },
  );
}

export type AiRunEntity = ReturnType<typeof createAiRunEntity>;
