// @akili-spec assessment/ai-suggestions
import type { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { Entity } from 'electrodb';

/**
 * `aiSuggestion` (design § 2): written by the AI worker (boto3), read here. The
 * keys, `casing: 'none'` and the model must match the worker's contract
 * (`ai-suggestions/contract/`), or ElectroDB silently drops its items. The
 * worker writes `__edb_e__` / `__edb_v__` as constants for that reason.
 * Nullable attributes are optional: the worker writes `null` for them.
 */
export function createAiSuggestionEntity(
  client: DynamoDBClient,
  table: string,
) {
  return new Entity(
    {
      model: { entity: 'aiSuggestion', version: '1', service: 'qa' },
      attributes: {
        resultCode: { type: 'number', required: true },
        snapKey: { type: 'string', required: true },
        fieldKey: { type: 'string', required: true },
        promptVersion: { type: 'string', required: true },
        suggestionId: { type: 'string', required: true },
        runId: { type: 'string', required: true },
        status: { type: ['available', 'unavailable'] as const, required: true },
        createdAt: { type: 'string', required: true },
        unavailableReason: { type: 'string' },
        signal: { type: 'string' },
        suggestedValue: { type: 'number' },
        reportedValue: { type: 'number' },
        explanation: { type: 'string' },
        evidenceQuote: { type: 'string' },
        evidenceSource: { type: 'string' },
        evidenceSourceIndex: { type: 'number' },
        evidenceHash: { type: 'string' },
        quoteVerified: { type: 'boolean' },
        partialEvidence: { type: 'boolean' },
        modelId: { type: 'string' },
      },
      indexes: {
        suggestion: {
          pk: {
            field: 'pk',
            casing: 'none',
            composite: ['resultCode'],
            template: 'RESULT#${resultCode}',
          },
          sk: {
            field: 'sk',
            casing: 'none',
            composite: ['snapKey', 'fieldKey', 'promptVersion'],
            template: 'AI#${snapKey}#${fieldKey}#${promptVersion}',
          },
        },
      },
    },
    { client, table },
  );
}

export type AiSuggestionEntity = ReturnType<typeof createAiSuggestionEntity>;
