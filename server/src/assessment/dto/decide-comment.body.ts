// @akili-spec escalation/round-2
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsString, ValidateBy } from 'class-validator';
import { COMMENT_BODY_MAX } from './create-comment.body.js';

/** The decisions a Lead sets on a round-1 comment (round-2 FR-8). TPB and PPU values are not accepted here. */
export const LEAD_DECISIONS = ['agree_program', 'escalate'] as const;

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * `PUT …/assessment/decisions/:commentId` (round-2 design 6, FR-8): the decision
 * and its comment, trimmed first, then 1 to 2,000 characters. Whether the comment
 * can be decided depends on its state, so that 409 is the service's.
 */
export class DecideCommentBody {
  @ApiProperty({
    type: String,
    enum: LEAD_DECISIONS,
    example: 'agree_program',
    description:
      '`agree_program` turns the field green; `escalate` keeps it grey and refuses its validation',
  })
  @IsIn(LEAD_DECISIONS)
  decision!: (typeof LEAD_DECISIONS)[number];

  @ApiProperty({
    type: String,
    minLength: 1,
    maxLength: COMMENT_BODY_MAX,
    example: "The program's figure matches the evidence",
    description: 'Why: trimmed, 1 to 2,000 characters. Stored after trimming',
  })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  // Named `maxLength` so the global pipe words it as TOO_LONG; counted by character, as the column counts.
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
