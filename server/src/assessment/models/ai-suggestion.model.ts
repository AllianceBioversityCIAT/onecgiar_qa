// @akili-spec assessment/ai-suggestions
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AI_SIGNALS, AI_UNAVAILABLE_REASONS } from '../ai-suggestions-rules.js';

/**
 * One AI suggestion of a field (`ai-suggestion-view.schema.json`, FR-4). The
 * keys present depend on `status`: `available` carries the suggestion,
 * `unavailable` its reason, `pending` only the field key.
 */
export class AiSuggestionViewModel {
  @ApiProperty({ enum: ['available', 'unavailable', 'pending'] })
  status!: string;

  @ApiProperty({ type: String, example: 'general.gender_tag' })
  fieldKey!: string;

  @ApiPropertyOptional({ type: String, description: '`available` only' })
  suggestionId?: string;

  @ApiPropertyOptional({
    enum: AI_SIGNALS,
    description:
      '`available` only. Show red as "Review", never "Incorrect" (FR-6)',
  })
  signal?: string;

  @ApiPropertyOptional({ type: Number, minimum: 0, maximum: 9 })
  suggestedValue?: number;

  @ApiPropertyOptional({ type: String })
  explanation?: string;

  @ApiPropertyOptional({
    type: String,
    description:
      'The quote from the evidence; shown for IRL/IUL only when `quoteVerified`',
  })
  evidenceQuote?: string;

  @ApiPropertyOptional({ type: Boolean })
  quoteVerified?: boolean;

  @ApiPropertyOptional({ type: String, nullable: true })
  evidenceSource?: string | null;

  @ApiPropertyOptional({ type: String, example: 'v2-1.0.0' })
  promptVersion?: string;

  @ApiPropertyOptional({ type: String })
  modelId?: string;

  @ApiPropertyOptional({
    type: Boolean,
    nullable: true,
    description:
      'Third-Party Broker only: whether a reviewer copied the suggestion',
  })
  copiedByReviewer?: boolean | null;

  @ApiPropertyOptional({
    type: Boolean,
    nullable: true,
    description:
      'Third-Party Broker only: whether the last comment saved from the copy was edited; null when none was saved',
  })
  editedByReviewer?: boolean | null;

  @ApiPropertyOptional({
    enum: AI_UNAVAILABLE_REASONS,
    description: '`unavailable` only',
  })
  unavailableReason?: string;
}

/** FR-11: one field and prompt version of the missing-reason count. */
export class AiMissingReasonsFieldModel {
  @ApiProperty({ type: String, example: 'innovation_dev.readiness_level' })
  fieldKey!: string;

  @ApiProperty({ type: String, example: 'v2-1.0.0' })
  promptVersion!: string;

  @ApiProperty({
    type: Number,
    description: 'Validated 2+ above the AI with a recorded reason',
  })
  withReason!: number;

  @ApiProperty({
    type: Number,
    description: 'Validated 2+ above the AI with no recorded reason',
  })
  withoutReason!: number;
}

export class AiMissingReasonsModel {
  @ApiProperty({
    enum: ['shown'],
    description:
      'The levels come from the `shown` row: a suggestion never shown is not counted',
  })
  basis!: 'shown';

  @ApiProperty({ type: [AiMissingReasonsFieldModel] })
  fields!: AiMissingReasonsFieldModel[];
}
