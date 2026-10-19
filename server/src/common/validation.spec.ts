import { plainToInstance, Type } from 'class-transformer';
import { IsString, ValidateNested, validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { LoginDto } from '../auth/dto/login.dto.js';
import { toFieldErrors, validationExceptionFactory } from './validation.js';

// The same options as the global ValidationPipe.
async function fieldErrorsOf<T extends object>(
  type: new () => T,
  body: Record<string, unknown>,
) {
  const errors = await validate(plainToInstance(type, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return toFieldErrors(errors);
}

class Outer {
  @ValidateNested()
  @Type(() => LoginDto)
  login!: LoginDto;
}

describe('validation → field errors in our words', () => {
  it('reports a missing field as REQUIRED', async () => {
    expect(await fieldErrorsOf(LoginDto, { email: 'ada@cgiar.org' })).toEqual([
      {
        field: 'password',
        code: 'REQUIRED',
        message: 'This field is required.',
      },
    ]);
  });

  it('reports an empty string as REQUIRED', async () => {
    const fields = await fieldErrorsOf(LoginDto, {
      email: 'ada@cgiar.org',
      password: '',
    });
    expect(fields).toEqual([
      expect.objectContaining({ field: 'password', code: 'REQUIRED' }),
    ]);
  });

  it('reports a malformed email as INVALID_EMAIL', async () => {
    expect(
      await fieldErrorsOf(LoginDto, { email: 'not-an-email', password: 'x' }),
    ).toEqual([
      {
        field: 'email',
        code: 'INVALID_EMAIL',
        message: 'Enter a valid email address.',
      },
    ]);
  });

  it('reports a wrong type as INVALID_TYPE', async () => {
    expect(
      await fieldErrorsOf(LoginDto, { email: 'ada@cgiar.org', password: 42 }),
    ).toEqual([
      expect.objectContaining({ field: 'password', code: 'INVALID_TYPE' }),
    ]);
  });

  it('reports a too-long value with its limit', async () => {
    expect(
      await fieldErrorsOf(LoginDto, {
        email: 'ada@cgiar.org',
        password: 'x'.repeat(257),
      }),
    ).toEqual([
      {
        field: 'password',
        code: 'TOO_LONG',
        message: 'Must be at most 256 characters.',
      },
    ]);
  });

  it('reports an extra field as UNKNOWN_FIELD', async () => {
    expect(
      await fieldErrorsOf(LoginDto, {
        email: 'ada@cgiar.org',
        password: 'x',
        isAdmin: true,
      }),
    ).toEqual([
      {
        field: 'isAdmin',
        code: 'UNKNOWN_FIELD',
        message: 'This field is not allowed.',
      },
    ]);
  });

  it('names nested fields with a dotted path', async () => {
    const fields = await fieldErrorsOf(Outer, { login: { email: 'nope' } });
    expect(fields.map((f) => [f.field, f.code])).toEqual([
      ['login.email', 'INVALID_EMAIL'],
      ['login.password', 'REQUIRED'],
    ]);
  });

  it('names an item of a list with its index in brackets, as the service does', async () => {
    class Item {
      @IsString()
      name!: string;
    }
    class List {
      @ValidateNested({ each: true })
      @Type(() => Item)
      items!: Item[];
    }
    expect(
      await fieldErrorsOf(List, { items: [{ name: 'a' }, { name: 5 }] }),
    ).toEqual([
      {
        field: 'items[1].name',
        code: 'INVALID_TYPE',
        message: 'This field has the wrong type.',
      },
    ]);
  });

  it('never carries class-validator texts', async () => {
    const fields = await fieldErrorsOf(LoginDto, {
      email: 'x',
      password: 1,
      extra: 1,
    });
    const text = JSON.stringify(fields);
    expect(text).not.toMatch(/must be|should not|property/i);
  });

  it('builds a 400 VALIDATION_FAILED carrying the fields', async () => {
    const errors = await validate(plainToInstance(LoginDto, {}));
    const exception = validationExceptionFactory(errors);
    expect(exception.getStatus()).toBe(400);
    expect(exception.getResponse()).toMatchObject({
      code: 'VALIDATION_FAILED',
      fields: [
        expect.objectContaining({ field: 'email', code: 'REQUIRED' }),
        expect.objectContaining({ field: 'password', code: 'REQUIRED' }),
      ],
    });
  });
});
