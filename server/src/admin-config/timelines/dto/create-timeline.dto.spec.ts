import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { toFieldErrors } from '../../../common/validation.js';
import { CreateTimelineDto } from './create-timeline.dto.js';

// The same options as the global ValidationPipe.
async function fieldsOf(body: Record<string, unknown>) {
  const errors = await validate(plainToInstance(CreateTimelineDto, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return toFieldErrors(errors).map(({ field, code }) => ({ field, code }));
}

const step = (fields: Record<string, unknown>) => ({
  name: 'Step',
  audience: 'assessors',
  round: 1,
  requiresLoad: true,
  ...fields,
});

const body = (steps: unknown[]) => ({
  name: 'July 2026',
  allPrograms: true,
  allResultTypes: true,
  steps,
});

describe('CreateTimelineDto steps (the pipe judges the shape only, timeline-step-times FR-1, FR-9)', () => {
  it('accepts a step written with moments', async () => {
    expect(
      await fieldsOf(
        body([
          step({ opensAt: '2026-11-10T14:00', closesAt: '2026-11-12T17:30' }),
        ]),
      ),
    ).toEqual([]);
  });

  it('accepts a step written day-only, as old clients send it', async () => {
    expect(
      await fieldsOf(
        body([step({ opensOn: '2026-11-10', closesOn: '2026-11-12' })]),
      ),
    ).toEqual([]);
  });

  it('accepts both forms of one boundary: the rules name that, not the pipe', async () => {
    expect(
      await fieldsOf(
        body([
          step({
            opensAt: '2026-11-10T14:00',
            opensOn: '2026-11-10',
            closesAt: '2026-11-12T17:30',
          }),
        ]),
      ),
    ).toEqual([]);
  });

  it('accepts a step with no boundary key at all: the rules name it REQUIRED', async () => {
    expect(await fieldsOf(body([step({})]))).toEqual([]);
  });

  it.each(['opensAt', 'closesAt'])(
    'a %s that is not a string is a shape problem on that key',
    async (key) => {
      expect(await fieldsOf(body([step({ [key]: 5 })]))).toEqual([
        expect.objectContaining({ field: `steps[0].${key}` }),
      ]);
    },
  );
});
