// @akili-spec admin-config/field-configuration
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { toFieldErrors } from '../../../common/validation.js';
import { PublishFieldConfigDto } from './publish-field-config.dto.js';
import { UpdateFieldConfigDraftDto } from './update-field-config-draft.dto.js';

// The same options as the global ValidationPipe.
async function fieldsOf(type: new () => object, body: Record<string, unknown>) {
  const errors = await validate(plainToInstance(type, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return toFieldErrors(errors).map(({ field, code }) => ({ field, code }));
}
const draft = (body: Record<string, unknown>) =>
  fieldsOf(UpdateFieldConfigDraftDto, body);
const publish = (body: Record<string, unknown>) =>
  fieldsOf(PublishFieldConfigDto, body);
const item = (extra: Record<string, unknown> = {}) => ({
  resultTypeKey: 'KP',
  fieldKey: 'title',
  visibility: 'assessed',
  ...extra,
});

describe('UpdateFieldConfigDraftDto (the pipe judges the shape only)', () => {
  it('requires items', async () => {
    expect(await draft({})).toEqual([{ field: 'items', code: 'REQUIRED' }]);
  });

  it('refuses an empty list', async () => {
    expect(await draft({ items: [] })).toEqual([
      expect.objectContaining({ field: 'items' }),
    ]);
  });

  it('refuses more than 2,000 items and accepts exactly 2,000', async () => {
    const many = (n: number) => Array.from({ length: n }, () => item());
    expect(await draft({ items: many(2001) })).toEqual([
      expect.objectContaining({ field: 'items' }),
    ]);
    expect(await draft({ items: many(2000) })).toEqual([]);
  });

  it('accepts a visibility-only item: the flags are optional (FR-4)', async () => {
    expect(await draft({ items: [item()] })).toEqual([]);
    expect(
      await draft({ items: [item({ isCore: true, isAiInput: false })] }),
    ).toEqual([]);
  });

  it.each(['hidden', 'view_only', 'assessed'])(
    'accepts visibility %s',
    async (v) => {
      expect(await draft({ items: [item({ visibility: v })] })).toEqual([]);
    },
  );

  it('refuses a visibility outside the enum', async () => {
    expect(await draft({ items: [item({ visibility: 'editable' })] })).toEqual([
      expect.objectContaining({ field: 'items[0].visibility' }),
    ]);
  });

  it('requires resultTypeKey, fieldKey and visibility on each item', async () => {
    expect(await draft({ items: [{}] })).toEqual([
      { field: 'items[0].resultTypeKey', code: 'REQUIRED' },
      { field: 'items[0].fieldKey', code: 'REQUIRED' },
      { field: 'items[0].visibility', code: 'REQUIRED' },
    ]);
  });

  it('refuses a flag that is not a boolean, null included', async () => {
    expect(await draft({ items: [item({ isCore: 'yes' })] })).toEqual([
      expect.objectContaining({ field: 'items[0].isCore' }),
    ]);
    expect(await draft({ items: [item({ isAiInput: null })] })).toEqual([
      expect.objectContaining({ field: 'items[0].isAiInput' }),
    ]);
  });

  it('refuses an unknown key at the top and on an item (NFR-2)', async () => {
    expect(await draft({ items: [item()], revision: 1 })).toEqual([
      { field: 'revision', code: 'UNKNOWN_FIELD' },
    ]);
    expect(await draft({ items: [item({ label: 'x' })] })).toEqual([
      { field: 'items[0].label', code: 'UNKNOWN_FIELD' },
    ]);
  });
});

describe('PublishFieldConfigDto', () => {
  it('requires revision', async () => {
    expect(await publish({})).toEqual([
      { field: 'revision', code: 'REQUIRED' },
    ]);
  });

  it('accepts revision 0 and a positive integer', async () => {
    expect(await publish({ revision: 0 })).toEqual([]);
    expect(await publish({ revision: 12 })).toEqual([]);
  });

  it.each([-1, 1.5, '3', 4_294_967_296])('refuses revision %s', async (v) => {
    expect(await publish({ revision: v })).toEqual([
      expect.objectContaining({ field: 'revision' }),
    ]);
  });

  it('refuses an unknown key (NFR-2)', async () => {
    expect(await publish({ revision: 1, force: true })).toEqual([
      { field: 'force', code: 'UNKNOWN_FIELD' },
    ]);
  });
});
