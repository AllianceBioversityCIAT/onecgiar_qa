// @akili-spec admin-config/field-configuration
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsString,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { fieldConfigVisibilities } from '../../../database/drizzle/schema/field-config-draft-items.js';
import type { DraftEditItem, FieldVisibility } from '../field-config-rules.js';

/** The most items one draft edit carries (design 6): about 9 result types by a few hundred fields. */
export const MAX_DRAFT_ITEMS = 2000;

// A flag left out is `undefined` and stays optional (FR-4: the service stores it
// off); `null` is a value, not a way to leave it out, so it is refused here.
const sentOnly = ValidateIf((_, value) => value !== undefined);

/**
 * One item of `PATCH /cycles/:id/field-config/draft` (design 6). The pipe judges
 * the shape only; which types and fields exist, repeats and `isCore` on a field
 * that is not assessed are rules, listed together in one 400 (design 7.1).
 */
export class DraftItemDto implements DraftEditItem {
  @ApiProperty({
    type: String,
    maxLength: 64,
    example: 'innovation_development',
    description: 'Result type key, as the Reporting catalog spells it',
  })
  @IsString()
  @MaxLength(64)
  resultTypeKey!: string;

  @ApiProperty({
    type: String,
    maxLength: 128,
    example: 'general.title',
    description:
      'Top-level field key of that result type, as the Reporting catalog spells it',
  })
  @IsString()
  @MaxLength(128)
  fieldKey!: string;

  @ApiProperty({
    type: String,
    enum: fieldConfigVisibilities,
    example: 'assessed',
    description: 'What the assessor sees of the field',
  })
  @IsIn(fieldConfigVisibilities)
  visibility!: FieldVisibility;

  @ApiProperty({
    type: Boolean,
    required: false,
    example: true,
    description:
      'Core field. Left out is stored as false. True needs `visibility` `assessed`',
  })
  @sentOnly
  @IsBoolean()
  isCore?: boolean;

  @ApiProperty({
    type: Boolean,
    required: false,
    example: false,
    description:
      'The field feeds the AI check. Left out is stored as false. True needs `visibility` `assessed`',
  })
  @sentOnly
  @IsBoolean()
  isAiInput?: boolean;
}

/**
 * Body of `PATCH /cycles/:id/field-config/draft` (design 6): 1 to 2,000 items.
 * Any key outside the two classes, at any level, is a 400 `UNKNOWN_FIELD`
 * (NFR-2).
 */
export class UpdateFieldConfigDraftDto {
  @ApiProperty({
    type: [DraftItemDto],
    minItems: 1,
    maxItems: MAX_DRAFT_ITEMS,
    description:
      'The fields to classify. A field not listed keeps what the draft has; a field listed twice is a 400',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_DRAFT_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => DraftItemDto)
  items!: DraftItemDto[];
}
