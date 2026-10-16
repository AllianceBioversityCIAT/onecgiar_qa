import { ApiProperty } from '@nestjs/swagger';
import { applyDecorators } from '@nestjs/common';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

// The shape rules of the auth routes (NFR-3), written once. Every one of them
// is enforced before Cognito is called.

/** `users.email` is a `varchar(255)`. */
export const EMAIL_MAX_LENGTH = 255;

/** Generous bounds: they keep oversized input away from Cognito, they are not policy. */
export const PASSWORD_MAX_LENGTH = 256;
export const CODE_MAX_LENGTH = 2048;
export const SESSION_MAX_LENGTH = 8192;
export const URI_MAX_LENGTH = 2048;

/**
 * An email address no longer than the column that stores it. `IsEmail` already
 * refuses anything over 254 characters; the explicit bound keeps the column
 * limit independent of the validator's own policy.
 */
export const EmailField = (description = 'Email address') =>
  applyDecorators(
    IsString(),
    MaxLength(EMAIL_MAX_LENGTH, { context: { max: EMAIL_MAX_LENGTH } }),
    IsEmail(),
    ApiProperty({
      type: String,
      description,
      format: 'email',
      maxLength: EMAIL_MAX_LENGTH,
      example: 'ada@cgiar.org',
    }),
  );

/** A non-empty string of at most `max` characters, kept exactly as sent. */
export const TextField = (
  max: number,
  docs: { description: string; example?: string; format?: string },
) =>
  applyDecorators(
    IsString(),
    IsNotEmpty(),
    MaxLength(max, { context: { max } }),
    ApiProperty({ type: String, ...docs, minLength: 1, maxLength: max }),
  );
