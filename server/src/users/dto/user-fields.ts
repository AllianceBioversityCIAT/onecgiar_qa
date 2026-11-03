import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateBy,
} from 'class-validator';
import { UNSIGNED_INT_MAX } from '../users-admin.service.js';

// The shape rules of the user-management bodies, written once. The service
// re-checks what a DTO cannot know (catalog references, role/scope rules,
// uniqueness); these keep malformed JSON out of it and name each bad field.

/** `users.email` is a `varchar(255)`. */
export const EMAIL_MAX_LENGTH = 255;

/** A non-empty string of at most `max` characters; the service trims it. */
export const TextProp = (
  max: number,
  docs: { description: string; example?: string },
  options: { optional?: boolean } = {},
) =>
  applyDecorators(
    ...(options.optional ? [IsOptional()] : []),
    IsString(),
    IsNotEmpty(),
    MaxLength(max, { context: { max } }),
    ApiProperty({
      type: String,
      ...docs,
      required: !options.optional,
      minLength: 1,
      maxLength: max,
    }),
  );

export const EmailProp = () =>
  applyDecorators(
    IsString(),
    MaxLength(EMAIL_MAX_LENGTH, { context: { max: EMAIL_MAX_LENGTH } }),
    IsEmail(),
    ApiProperty({
      type: String,
      format: 'email',
      maxLength: EMAIL_MAX_LENGTH,
      description: 'Stored in lowercase; it never changes afterwards',
      example: 'ada@cgiar.org',
    }),
  );

const isPositiveInt = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 1 &&
  value <= UNSIGNED_INT_MAX;

/**
 * `'all'` or a non-empty list of items that pass `item` (design 6:
 * `programs`, `resultTypes`). An empty list is refused: it would silently
 * mean "all" (T-6 forward pointer 4).
 */
export const IsAllOrList = (kind: 'id' | 'text') =>
  ValidateBy({
    name: 'isAllOrList',
    validator: {
      validate: (value: unknown) =>
        value === 'all' ||
        (Array.isArray(value) &&
          value.length > 0 &&
          value.every((entry: unknown) =>
            kind === 'id'
              ? isPositiveInt(entry)
              : typeof entry === 'string' && entry.length > 0,
          )),
    },
  });

/** OpenAPI schema of `'all' | number[]` / `'all' | string[]`, minItems 1. */
export const allOrListSchema = (kind: 'id' | 'text') => ({
  oneOf: [
    { type: 'string', enum: ['all'] },
    {
      type: 'array',
      minItems: 1,
      items:
        kind === 'id'
          ? { type: 'integer', minimum: 1 }
          : { type: 'string', minLength: 1 },
    },
  ],
});
