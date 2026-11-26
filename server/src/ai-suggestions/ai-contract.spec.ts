// @akili-spec assessment/ai-suggestions
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PutItemCommand } from '@aws-sdk/client-dynamodb';
import { describe, expect, it } from 'vitest';
import {
  AI_CONTRACT_DIR,
  aiExamples,
  aiSchema,
  assertAiSchema,
  toAttributeMap,
} from '../../test/support/ai-contract.js';
import { createFakeDynamoClient } from '../../test/support/fake-dynamodb-client.js';
import { createAiRunEntity } from '../database/dynamodb/entities/ai-run.entity.js';
import { DynamoAiRunStore } from './ai-run.store.js';
import { DynamoAiSuggestionStore } from './ai-suggestion.store.js';
import { toSuggestionViews } from '../assessment/ai-suggestions-rules.js';
import { AI_LEVEL_FIELDS, productionFieldOf } from './ai-config.js';
import type { AiSuggestionItem } from './ai-suggestion.store.js';
import { AI_PRODUCTION } from './production.js';

const productionVersion = (fieldKey: string) =>
  productionFieldOf(fieldKey)?.promptVersion;

const TABLE = 'cgiar-qa-test';

interface Manifest {
  commit: string;
  files: Record<string, string>;
}
const manifest = JSON.parse(
  readFileSync(join(AI_CONTRACT_DIR, 'manifest.json'), 'utf8'),
) as Manifest;

describe('AI worker contract copy (T-2, NFR-4)', () => {
  it('every copied file matches the manifest of the synced worker commit', () => {
    expect(manifest.commit).toMatch(/^[0-9a-f]{7,}$/);
    for (const [file, sha] of Object.entries(manifest.files)) {
      const actual = createHash('sha256')
        .update(readFileSync(join(AI_CONTRACT_DIR, file)))
        .digest('hex');
      expect({ file, sha: actual }).toEqual({ file, sha });
    }
  });

  it('production.ts equals the copied production.json', () => {
    const json = JSON.parse(
      readFileSync(join(AI_CONTRACT_DIR, 'production.json'), 'utf8'),
    ) as unknown;
    expect(AI_PRODUCTION).toEqual(json);
  });

  it('every schema carries the contract version production.json names', () => {
    for (const file of Object.keys(manifest.files).filter((f) =>
      f.startsWith('schema/'),
    )) {
      const schema = JSON.parse(
        readFileSync(join(AI_CONTRACT_DIR, file), 'utf8'),
      ) as { 'x-contractVersion'?: string };
      expect({ file, v: schema['x-contractVersion'] }).toEqual({
        file,
        v: AI_PRODUCTION.contractVersion,
      });
    }
  });

  it('IRL and IUL are scored level fields; the indicative ones are the two confirmed keys', () => {
    for (const key of AI_LEVEL_FIELDS) {
      expect(productionFieldOf(key)).toMatchObject({
        valueKind: 'level',
        signal: 'scored',
      });
    }
    expect(productionFieldOf('general.result_type')).toMatchObject({
      valueKind: 'category',
      signal: 'indicative',
    });
    expect(
      productionFieldOf('innovation_use.current_use.actors'),
    ).toMatchObject({
      valueKind: 'use_numbers',
      signal: 'indicative',
      coversFieldKeys: [
        'innovation_use.current_use.organizations',
        'innovation_use.current_use.measures',
      ],
    });
  });

  it("every example is on its field's production prompt version", () => {
    for (const item of Object.values(aiExamples())) {
      expect({ f: item.fieldKey, v: item.promptVersion }).toEqual({
        f: item.fieldKey,
        v: productionVersion(item.fieldKey as string),
      });
    }
  });

  /**
   * Examples the worker published that fail its own item schema. Each must
   * stay invalid (so this list goes stale loudly once the worker fixes it)
   * and our view must still turn it into a schema-valid view.
   */
  const KNOWN_DEFECTS: Record<string, string> = {
    'ai-suggestion-item.use-numbers.json':
      'worker b3d4bbf: UseNumberRow rows omit the nullable keys its Pydantic model requires',
  };

  it('every example is a valid item of the worker schema (known defects excepted)', () => {
    const examples = aiExamples();
    expect(Object.keys(examples).length).toBeGreaterThanOrEqual(4);
    for (const [file, item] of Object.entries(examples)) {
      if (file in KNOWN_DEFECTS) {
        expect(aiSchema('ai-suggestion-item')(item), file).toBe(false);
        continue;
      }
      assertAiSchema('ai-suggestion-item', item);
    }
  });

  it('every available example becomes a schema-valid view', () => {
    for (const item of Object.values(aiExamples())) {
      const [view] = toSuggestionViews(
        [item.fieldKey as string],
        [item as unknown as AiSuggestionItem],
      );
      assertAiSchema('ai-suggestion-view', view);
      expect(view.status).toBe(item.status);
    }
  });
});

describe('ElectroDB reads the worker items (T-2)', () => {
  it('returns each example through the snapshot query, attributes intact', async () => {
    const { client } = createFakeDynamoClient();
    const examples = Object.values(aiExamples());
    for (const item of examples) {
      await client.send(
        new PutItemCommand({
          TableName: TABLE,
          Item: toAttributeMap(item) as never,
        }),
      );
    }
    const store = new DynamoAiSuggestionStore(client, TABLE);
    for (const item of examples) {
      const found = await store.listForSnapshot(
        item.resultCode as number,
        item.snapKey as string,
        productionVersion,
      );
      const match = found.find((f) => f.suggestionId === item.suggestionId);
      expect(match).toBeDefined();
      for (const [key, value] of Object.entries(item)) {
        if (key === 'pk' || key === 'sk' || key.startsWith('__edb')) continue;
        if (value === null) continue;
        expect({ key, value: (match as Record<string, unknown>)[key] }).toEqual(
          { key, value },
        );
      }
    }
  });

  it('ignores another prompt version and another snapshot of the same result', async () => {
    const { client } = createFakeDynamoClient();
    const [item] = Object.values(aiExamples());
    const other = (over: Record<string, unknown>) => {
      const next: Record<string, unknown> = {
        ...item,
        ...over,
        suggestionId: `x${String(over.snapKey ?? over.promptVersion)}`,
      };
      next.sk = `AI#${String(next.snapKey)}#${String(next.fieldKey)}#${String(next.promptVersion)}`;
      return next;
    };
    for (const row of [
      item,
      other({ promptVersion: 'v1-1.0.0' }),
      other({ snapKey: `${String(item.snapKey)}9` }),
    ]) {
      await client.send(
        new PutItemCommand({
          TableName: TABLE,
          Item: toAttributeMap(row) as never,
        }),
      );
    }
    const found = await new DynamoAiSuggestionStore(
      client,
      TABLE,
    ).listForSnapshot(
      item.resultCode as number,
      item.snapKey as string,
      productionVersion,
    );
    expect(found.map((f) => f.suggestionId)).toEqual([item.suggestionId]);
  });

  it('sets `expected` without touching the counters the worker added first', async () => {
    const { client } = createFakeDynamoClient();
    // The worker's first write may come before ours (C-6).
    await client.send(
      new PutItemCommand({
        TableName: TABLE,
        Item: toAttributeMap({
          pk: 'AIRUN#load-7',
          sk: 'RUN',
          __edb_e__: 'aiRun',
          __edb_v__: '1',
          runId: 'load-7',
          produced: 3,
          createdAt: '2026-11-20T10:00:00.000Z',
        }) as never,
      }),
    );
    const runs = new DynamoAiRunStore(client, TABLE);
    await runs.setExpected('load-7', 12, new Date('2026-11-20T11:00:00Z'));
    await runs.setExpected('load-7', 12, new Date('2026-11-20T12:00:00Z'));
    const { data } = await createAiRunEntity(client, TABLE)
      .get({ runId: 'load-7' })
      .go();
    expect(data).toMatchObject({
      runId: 'load-7',
      expected: 12,
      produced: 3,
      createdAt: '2026-11-20T10:00:00.000Z',
    });
  });

  it('creates the run item when ours comes first, readable as a worker item', async () => {
    const { client, items } = createFakeDynamoClient();
    await new DynamoAiRunStore(client, TABLE).setExpected(
      'load-8',
      5,
      new Date('2026-11-20T11:00:00Z'),
    );
    const raw = items.get('AIRUN#load-8|RUN')!;
    expect(raw).toMatchObject({
      __edb_e__: { S: 'aiRun' },
      __edb_v__: { S: '1' },
      expected: { N: '5' },
    });
  });
});
