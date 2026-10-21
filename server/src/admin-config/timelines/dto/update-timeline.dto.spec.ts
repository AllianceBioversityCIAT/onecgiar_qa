import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { toFieldErrors } from '../../../common/validation.js';
import { UpdateTimelineDto } from './update-timeline.dto.js';

// The same options as the global ValidationPipe.
async function fieldsOf(body: Record<string, unknown>) {
  const errors = await validate(plainToInstance(UpdateTimelineDto, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return toFieldErrors(errors).map(({ field, code }) => ({ field, code }));
}

describe('UpdateTimelineDto (the pipe judges the shape only)', () => {
  it('requires version (FR-9)', async () => {
    expect(await fieldsOf({ name: 'July' })).toEqual([
      { field: 'version', code: 'REQUIRED' },
    ]);
  });

  it('requires version to be an integer of at least 1', async () => {
    expect(await fieldsOf({ version: 0 })).toEqual([
      expect.objectContaining({ field: 'version' }),
    ]);
    expect(await fieldsOf({ version: 1.5 })).toEqual([
      expect.objectContaining({ field: 'version' }),
    ]);
  });

  it('requires steps[].position', async () => {
    expect(await fieldsOf({ version: 1, steps: [{ name: 'x' }] })).toEqual([
      { field: 'steps[0].position', code: 'REQUIRED' },
    ]);
  });

  it('accepts a rename-only request: no opensOn, closesOn or scope needed', async () => {
    expect(
      await fieldsOf({ version: 3, steps: [{ position: 2, name: 'Review' }] }),
    ).toEqual([]);
    expect(await fieldsOf({ version: 3, name: 'July' })).toEqual([]);
  });

  it.each(['audience', 'round', 'requiresLoad'])(
    'refuses the structural key %s on a step (NFR-2)',
    async (key) => {
      const fields = await fieldsOf({
        version: 1,
        steps: [{ position: 1, [key]: 'x' }],
      });
      expect(fields).toEqual([
        { field: `steps[0].${key}`, code: 'UNKNOWN_FIELD' },
      ]);
    },
  );

  it('refuses kind and any unknown top-level key', async () => {
    expect(await fieldsOf({ version: 1, kind: 'official' })).toEqual([
      { field: 'kind', code: 'UNKNOWN_FIELD' },
    ]);
  });

  it('refuses a null name instead of treating it as left out', async () => {
    expect(await fieldsOf({ version: 1, name: null })).toEqual([
      expect.objectContaining({ field: 'name' }),
    ]);
  });
});
