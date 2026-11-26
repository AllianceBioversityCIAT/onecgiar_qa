// P2-3911: the bodies of a program response and of an assessor's
// clarification answer.
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsString, ValidateBy } from 'class-validator';
import {
  spResponseKinds,
  type SpResponseKind,
} from '../../../database/drizzle/schema/sp-comment-responses.js';

/** `body varchar(2000)`: 2,000 CHARACTERS, as the column counts. */
export const SP_TEXT_MAX = 2000;

const isAccept = (object: unknown): boolean =>
  (object as { kind?: unknown } | undefined)?.kind === 'accept';

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** The global pipe words a `maxLength` constraint as TOO_LONG; counted by code point. */
const maxChars = () =>
  ValidateBy(
    {
      name: 'maxLength',
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' && Array.from(value).length <= SP_TEXT_MAX,
      },
    },
    { context: { max: SP_TEXT_MAX } },
  );

/** `PUT /sp/comments/:commentId/response`. */
export class SpRespondBody {
  @ApiProperty({
    type: String,
    enum: spResponseKinds,
    description:
      '`accept` (no text), `accept_with_comment`, `disagree` or `request_clarification` (each with a text)',
  })
  @IsIn(spResponseKinds)
  kind!: SpResponseKind;

  @ApiPropertyOptional({
    type: String,
    minLength: 1,
    maxLength: SP_TEXT_MAX,
    nullable: true,
    description:
      'Trimmed, 1 to 2,000 characters. Required for every kind except `accept`, which refuses it',
  })
  @Transform(trimmed)
  // A plain accept carries no text: any body (even empty) is refused.
  @ValidateBy({
    name: 'bodyNotAllowed',
    validator: {
      validate: (value: unknown, args) =>
        !isAccept(args?.object) || value === undefined || value === null,
    },
  })
  // Every other kind needs the text (a missing one reads REQUIRED).
  @ValidateBy({
    name: 'isString',
    validator: {
      validate: (value: unknown, args) =>
        isAccept(args?.object) || typeof value === 'string',
    },
  })
  @ValidateBy({
    name: 'isNotEmpty',
    validator: {
      validate: (value: unknown, args) =>
        isAccept(args?.object) || value !== '',
    },
  })
  @ValidateBy(
    {
      name: 'maxLength',
      validator: {
        validate: (value: unknown, args) =>
          isAccept(args?.object) ||
          (typeof value === 'string' &&
            Array.from(value).length <= SP_TEXT_MAX),
      },
    },
    { context: { max: SP_TEXT_MAX } },
  )
  body?: string | null;
}

/** `POST /assessment-comments/:commentId/clarification-answer`. */
export class ClarificationAnswerBody {
  @ApiProperty({
    type: String,
    minLength: 1,
    maxLength: SP_TEXT_MAX,
    description: 'The answer to the program, trimmed: 1 to 2,000 characters',
  })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @maxChars()
  body!: string;
}
