// @akili-spec assessment/step-1-assessment
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsString, ValidateBy } from 'class-validator';
import { COMMENT_BODY_MAX } from './create-comment.body.js';
import { QUICK_COMMENT_ROLES } from '../quick-comments.service.js';

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** `GET /quick-comments?role=` (design 6): the role whose list is read. */
export class QuickCommentsQuery {
  @ApiProperty({
    type: String,
    enum: QUICK_COMMENT_ROLES,
    example: 'ASSESSOR',
    description:
      'The role whose quick comments are listed. The caller must hold a live grant of it',
  })
  @IsIn(QUICK_COMMENT_ROLES)
  role!: string;
}

/** `POST /quick-comments` (design 6, FR-12): the role and the text, trimmed, 1 to 2,000 characters. */
export class CreateQuickCommentBody {
  @ApiProperty({
    type: String,
    enum: QUICK_COMMENT_ROLES,
    example: 'ASSESSOR',
    description:
      'The role the text is saved for. The caller must hold a live grant of it',
  })
  @IsIn(QUICK_COMMENT_ROLES)
  role!: string;

  @ApiProperty({
    type: String,
    minLength: 1,
    maxLength: COMMENT_BODY_MAX,
    example: 'Please add the evidence link',
    description:
      'The text, trimmed: 1 to 2,000 characters. The same text (case-sensitive) saved twice for a role is one entry',
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
