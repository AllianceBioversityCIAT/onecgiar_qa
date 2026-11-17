// @akili-spec assessment/ai-suggestions
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateBy,
  ValidateIf,
  type ValidationArguments,
} from 'class-validator';
import { AssessmentParams } from './assessment-params.js';

export const AI_EVENT_ACTIONS = [
  'shown',
  'copied',
  'comment_saved',
  'validated_above_ai',
] as const;
export type AiEventAction = (typeof AI_EVENT_ACTIONS)[number];

const ABOVE = 'validated_above_ai';

/** A key of one variant sent with the other variant is a 400, as the schema's `additionalProperties: false` says. */
const onlyWhen = (above: boolean) =>
  ValidateBy({
    name: above ? 'onlyForValidatedAboveAi' : 'onlyForUsageEvents',
    validator: {
      validate: (_value: unknown, args?: ValidationArguments) =>
        ((args?.object as { action?: string } | undefined)?.action ===
          ABOVE) ===
        above,
      defaultMessage: () =>
        above
          ? 'only allowed when action is validated_above_ai'
          : 'not allowed when action is validated_above_ai',
    },
  });

/**
 * `POST …/ai-suggestions/:suggestionId/events`: `ai-suggestion-event.schema.json`
 * as one class, discriminated by `action` (FR-8). The levels are checked
 * against the stored suggestion by the service, never trusted from here.
 */
export class AiSuggestionEventBody {
  @ApiProperty({ enum: AI_EVENT_ACTIONS, example: 'copied' })
  @IsIn(AI_EVENT_ACTIONS)
  action!: AiEventAction;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '7012',
    description:
      '`comment_saved` only: the id of the comment the copied text was saved in',
  })
  @ValidateIf((o: AiSuggestionEventBody) => o.commentId != null)
  @IsString()
  @Matches(/^[1-9]\d{0,15}$/)
  @onlyWhen(false)
  commentId?: string | null;

  @ApiPropertyOptional({
    type: Number,
    minimum: 0,
    maximum: 9,
    description: '`validated_above_ai`: the level the AI suggested',
  })
  @ValidateIf(
    (o: AiSuggestionEventBody) => o.action === ABOVE || o.aiLevel !== undefined,
  )
  @IsInt()
  @Min(0)
  @Max(9)
  @onlyWhen(true)
  aiLevel?: number;

  @ApiPropertyOptional({
    type: Number,
    minimum: 0,
    maximum: 9,
    description: '`validated_above_ai`: the reported level being validated',
  })
  @ValidateIf(
    (o: AiSuggestionEventBody) =>
      o.action === ABOVE || o.validatedLevel !== undefined,
  )
  @IsInt()
  @Min(0)
  @Max(9)
  @onlyWhen(true)
  validatedLevel?: number;

  @ApiPropertyOptional({
    type: String,
    minLength: 1,
    maxLength: 200,
    description:
      '`validated_above_ai`: why the reported level is validated, one line',
  })
  @ValidateIf(
    (o: AiSuggestionEventBody) => o.action === ABOVE || o.reason !== undefined,
  )
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @Matches(/^[^\r\n]+$/)
  @onlyWhen(true)
  reason?: string;
}

/**
 * `…/ai-suggestions/:suggestionId/…`: the worker's id, 32 lowercase hex
 * characters; the dashed UUID form of the same id is accepted too (older items).
 */
export class AiSuggestionParams extends AssessmentParams {
  @ApiProperty({ type: String, example: '0f1e2d3c4b5a69788796a5b4c3d2e1f0' })
  @Matches(
    /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/,
  )
  suggestionId!: string;
}
