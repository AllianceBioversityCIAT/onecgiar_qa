// @akili-spec assessment/step-1-assessment
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength, ValidateBy } from 'class-validator';

/** The longest field key the comments table holds (`field_key varchar(200)`). */
const FIELD_KEY_MAX = 200;
/** `body varchar(2000)`: 2,000 CHARACTERS (FR-11), not UTF-16 units. */
export const COMMENT_BODY_MAX = 2000;

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * `POST …/assessment/comments` (design 6, FR-11): the field and the comment.
 * Whether the field is Assessed depends on the pinned configuration, so that
 * 400 is the service's; the shape is this class's. The body is trimmed first,
 * then must hold 1 to 2,000 characters.
 */
export class CreateCommentBody {
  @ApiProperty({
    type: String,
    maxLength: FIELD_KEY_MAX,
    example: 'general.title',
    description:
      'The field to comment on: an Assessed field of the pinned configuration',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(FIELD_KEY_MAX)
  fieldKey!: string;

  @ApiProperty({
    type: String,
    minLength: 1,
    maxLength: COMMENT_BODY_MAX,
    example: 'Please add the evidence link',
    description:
      'The comment, trimmed: 1 to 2,000 characters. Stored as sent after trimming',
  })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  // The name is `maxLength` so the global pipe words it as TOO_LONG; the
  // count is by character (code point), as the column counts.
  @ValidateBy(
    {
      name: 'maxLength',
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' &&
          Array.from(value).length <= COMMENT_BODY_MAX,
      },
    },
    { context: { max: COMMENT_BODY_MAX } },
  )
  body!: string;
}
