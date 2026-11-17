// @akili-spec assessment/ai-suggestions
import { Inject, Injectable } from '@nestjs/common';
import {
  UpdateItemCommand,
  type DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import {
  createAiRunEntity,
  type AiRunEntity,
} from '../database/dynamodb/entities/ai-run.entity.js';
import {
  DYNAMODB_CLIENT,
  DYNAMODB_TABLE_NAME,
} from '../database/dynamodb/dynamodb.constants.js';

export const AI_RUN_STORE = Symbol('AI_RUN_STORE');

/** The counters of a run; a missing item reads as zeros. */
export interface AiRunCounters {
  expected: number;
  produced: number;
  unavailable: number;
  failed: number;
}

export interface AiRunStore {
  /** FR-2: SET (never ADD) the jobs a run expects, so a lot retry does not double it. */
  setExpected(runId: string, expected: number, now: Date): Promise<void>;
  /** FR-3 status: one GetItem; `null` when neither side wrote the run yet. */
  get(runId: string): Promise<AiRunCounters | null>;
}

/**
 * A raw UpdateItem, not ElectroDB: the worker may create the item first with
 * `ADD` on its counters (C-6), and an ElectroDB `put` or `upsert` would replace
 * them. The identity attributes are `if_not_exists`, the same as the worker's.
 */
@Injectable()
export class DynamoAiRunStore implements AiRunStore {
  private readonly entity: AiRunEntity;

  constructor(
    @Inject(DYNAMODB_CLIENT) private readonly client: DynamoDBClient,
    @Inject(DYNAMODB_TABLE_NAME) private readonly table: string,
  ) {
    this.entity = createAiRunEntity(client, table);
  }

  async get(runId: string): Promise<AiRunCounters | null> {
    const { data } = await this.entity.get({ runId }).go();
    if (data === null) return null;
    return {
      expected: data.expected ?? 0,
      produced: data.produced ?? 0,
      unavailable: data.unavailable ?? 0,
      failed: data.failed ?? 0,
    };
  }

  async setExpected(runId: string, expected: number, now: Date): Promise<void> {
    await this.client.send(
      new UpdateItemCommand({
        TableName: this.table,
        Key: { pk: { S: `AIRUN#${runId}` }, sk: { S: 'RUN' } },
        UpdateExpression:
          'SET #x = :x, #c = if_not_exists(#c, :c), #e = if_not_exists(#e, :e), #v = if_not_exists(#v, :v), #r = if_not_exists(#r, :r)',
        ExpressionAttributeNames: {
          '#x': 'expected',
          '#c': 'createdAt',
          '#e': '__edb_e__',
          '#v': '__edb_v__',
          '#r': 'runId',
        },
        ExpressionAttributeValues: {
          ':x': { N: String(expected) },
          ':c': { S: now.toISOString() },
          ':e': { S: 'aiRun' },
          ':v': { S: '1' },
          ':r': { S: runId },
        },
      }),
    );
  }
}
