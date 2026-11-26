// @akili-spec assessment/step-1-assessment
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  Equals,
  IsArray,
  IsBoolean,
  IsString,
  MaxLength,
  ValidateBy,
  ValidateIf,
} from 'class-validator';

/** The longest field key the validations table holds (`field_key varchar(200)`). */
const FIELD_KEY_MAX = 200;

/**
 * `PUT …/assessment/validations` (design 6): the new state and exactly one
 * selector, `fieldKeys` (1 to 200 keys) or `all: true` (every Assessed field).
 * Which keys are Assessed depends on the pinned configuration, so that part is
 * the service's 400; the shape is this class's.
 */
export class ValidateAssessmentBody {
  @ApiProperty({
    type: Boolean,
    description: 'true sets the fields green, false sets them back to grey',
  })
  @IsBoolean()
  validated!: boolean;

  @ApiPropertyOptional({
    type: [String],
    minItems: 1,
    maxItems: 200,
    example: ['general.title'],
    description:
      'The fields to set, each an Assessed field of the pinned configuration. Exactly one of `fieldKeys` and `all`',
  })
  // Required unless `all` is sent; when both are sent `all` reports the conflict.
  @ValidateIf(
    (body: ValidateAssessmentBody) =>
      body.all === undefined || body.fieldKeys !== undefined,
  )
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(FIELD_KEY_MAX, { each: true })
  fieldKeys?: string[];

  @ApiPropertyOptional({
    type: Boolean,
    enum: [true],
    description:
      'Set every Assessed field ("check all" or "uncheck all"). Exactly one of `fieldKeys` and `all`',
  })
  @ValidateIf(
    (body: ValidateAssessmentBody) =>
      body.fieldKeys === undefined || body.all !== undefined,
  )
  @Equals(true)
  @ValidateBy({
    name: 'exclusiveWithFieldKeys',
    validator: {
      validate: (_value, args) =>
        args === undefined ||
        (args.object as ValidateAssessmentBody).fieldKeys === undefined,
    },
  })
  all?: true;
}
