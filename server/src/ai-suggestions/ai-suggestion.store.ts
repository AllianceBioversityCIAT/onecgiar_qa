// @akili-spec assessment/ai-suggestions
import { Inject, Injectable } from '@nestjs/common';
import type { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import type { EntityItem } from 'electrodb';
import {
  DYNAMODB_CLIENT,
  DYNAMODB_TABLE_NAME,
} from '../database/dynamodb/dynamodb.constants.js';
import {
  createAiSuggestionEntity,
  type AiSuggestionEntity,
} from '../database/dynamodb/entities/ai-suggestion.entity.js';

export type AiSuggestionItem = EntityItem<AiSuggestionEntity>;

export const AI_SUGGESTION_STORE = Symbol('AI_SUGGESTION_STORE');

export interface AiSuggestionStore {
  /**
   * FR-4: the suggestions of one snapshot, in ONE Query (NFR-5), keeping for
   * each field only the prompt version `versionOf` names (contract 2.0.0: the
   * version is per field). A field `versionOf` does not know is dropped.
   */
  listForSnapshot(
    resultCode: number,
    snapKey: string,
    versionOf: (fieldKey: string) => string | undefined,
  ): Promise<AiSuggestionItem[]>;
}

@Injectable()
export class DynamoAiSuggestionStore implements AiSuggestionStore {
  private readonly entity: AiSuggestionEntity;

  constructor(
    @Inject(DYNAMODB_CLIENT) client: DynamoDBClient,
    @Inject(DYNAMODB_TABLE_NAME) table: string,
  ) {
    this.entity = createAiSuggestionEntity(client, table);
  }

  async listForSnapshot(
    resultCode: number,
    snapKey: string,
    versionOf: (fieldKey: string) => string | undefined,
  ): Promise<AiSuggestionItem[]> {
    // `fieldKey` and `promptVersion` never contain `#`, so `begins_with
    // AI#<snapKey>#` is exactly this snapshot (worker README). The version is
    // filtered here, per field: another version's items are ignored (OQ-4).
    const { data } = await this.entity.query
      .suggestion({ resultCode })
      .begins({ snapKey })
      .go({ pages: 'all' });
    return data.filter(
      (item) =>
        item.snapKey === snapKey &&
        item.promptVersion === versionOf(item.fieldKey),
    );
  }
}
