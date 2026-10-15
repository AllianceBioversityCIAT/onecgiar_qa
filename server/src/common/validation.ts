import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import type { ValidationError } from 'class-validator';
import type { ApiFieldError } from './api-response.js';
import { errorBody, FIELD_ERRORS, type FieldErrorCode } from './error-codes.js';

/**
 * class-validator constraint → our field code, most important first: a field
 * reports only its first problem, so "required" wins over "wrong type", which
 * wins over format and length. The constraint names are class-validator's;
 * its message texts are never used.
 */
const CONSTRAINT_CODES: ReadonlyArray<readonly [string, FieldErrorCode]> = [
  ['whitelistValidation', 'UNKNOWN_FIELD'],
  ['isDefined', 'REQUIRED'],
  ['isNotEmpty', 'REQUIRED'],
  ['isString', 'INVALID_TYPE'],
  ['isNumber', 'INVALID_TYPE'],
  ['isInt', 'INVALID_TYPE'],
  ['isBoolean', 'INVALID_TYPE'],
  ['isEmail', 'INVALID_EMAIL'],
  ['maxLength', 'TOO_LONG'],
];

/** The validation errors of a request, one entry per field, in our words. */
export function toFieldErrors(
  errors: readonly ValidationError[],
  parent = '',
): ApiFieldError[] {
  return errors.flatMap((error) => {
    const field = parent ? `${parent}.${error.property}` : error.property;
    const nested = toFieldErrors(error.children ?? [], field);
    const constraints = Object.keys(error.constraints ?? {});
    if (constraints.length === 0) return nested;

    // A missing value is "required" whatever else failed on it.
    const missing =
      error.value === undefined ||
      error.value === null ||
      (typeof error.value === 'string' &&
        error.value === '' &&
        constraints.includes('isNotEmpty'));
    const code: FieldErrorCode =
      missing && !constraints.includes('whitelistValidation')
        ? 'REQUIRED'
        : (CONSTRAINT_CODES.find(([name]) => constraints.includes(name))?.[1] ??
          'INVALID');
    const max =
      code === 'TOO_LONG'
        ? (error.contexts?.maxLength as { max?: number } | undefined)?.max
        : undefined;
    return [{ field, code, message: FIELD_ERRORS[code](max) }, ...nested];
  });
}

/**
 * The global `ValidationPipe`'s `exceptionFactory`: a 400 `VALIDATION_FAILED`
 * carrying `fields`, never class-validator's own messages.
 */
export const validationExceptionFactory = (errors: ValidationError[]) =>
  new BadRequestException({
    ...errorBody('VALIDATION_FAILED'),
    fields: toFieldErrors(errors),
  });

/**
 * Express error middleware placed right after the JSON parser: body-parser
 * reports a broken or oversized body as an error with a `type`; turn it into
 * a coded exception so the filter answers `MALFORMED_JSON` /
 * `PAYLOAD_TOO_LARGE` (never the parser's text). Anything else passes on.
 */
export function bodyParserErrors(
  error: unknown,
  _request: Request,
  _response: Response,
  next: NextFunction,
): void {
  const type = (error as { type?: unknown } | null)?.type;
  if (type === 'entity.parse.failed') {
    next(new BadRequestException(errorBody('MALFORMED_JSON')));
  } else if (type === 'entity.too.large') {
    next(new PayloadTooLargeException(errorBody('PAYLOAD_TOO_LARGE')));
  } else {
    next(error);
  }
}
