// @akili-spec assessment/step-1-assessment
import { ConflictException, type Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AssessmentFinishedError } from './assessment.errors.js';
import { loggedWrite } from './assessment-log.js';

// The one decision line per write (design 7.9, FR-22, NFR-5). The expected
// lines are written out; the HTTP suite (`assessment-privacy.e2e-spec`) checks
// the same shape over every route.

function spyLogger() {
  const lines: Array<[string, Record<string, unknown>]> = [];
  const logger = {
    log: (line: string) => lines.push(['log', JSON.parse(line)]),
    warn: (line: string) => lines.push(['warn', JSON.parse(line)]),
    error: (line: string) => lines.push(['error', JSON.parse(line)]),
  } as unknown as Logger;
  return { logger, lines };
}

const context = {
  action: 'finish' as const,
  actorId: 7,
  requestId: 'req-1',
  timelineId: 3,
};

describe('loggedWrite', () => {
  it('writes one ok line with the ids the work learned and nothing else', async () => {
    const { logger, lines } = spyLogger();
    const result = await loggedWrite(logger, context, (trace) => {
      trace.membershipId = 42;
      return Promise.resolve('answer');
    });
    expect(result).toBe('answer');
    expect(lines).toEqual([
      [
        'log',
        {
          event: 'assessment',
          action: 'finish',
          timelineId: 3,
          membershipId: 42,
          outcome: 'ok',
          requestId: 'req-1',
          actorId: 7,
        },
      ],
    ]);
  });

  it('writes one refused line with the error code word and rethrows the same error', async () => {
    const { logger, lines } = spyLogger();
    const refusal = new AssessmentFinishedError();
    await expect(
      loggedWrite(logger, context, () => Promise.reject(refusal)),
    ).rejects.toBe(refusal);
    expect(lines).toEqual([
      [
        'warn',
        {
          event: 'assessment',
          action: 'finish',
          timelineId: 3,
          outcome: 'refused',
          reason: 'ASSESSMENT_FINISHED',
          requestId: 'req-1',
          actorId: 7,
        },
      ],
    ]);
  });

  it('falls back to the status word when the exception carries no catalog code', async () => {
    const { logger, lines } = spyLogger();
    await expect(
      loggedWrite(logger, context, () =>
        Promise.reject(new ConflictException('free text with a name: Ana')),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(lines[0]![1]['reason']).toBe('http_409');
    expect(JSON.stringify(lines)).not.toContain('Ana');
  });

  it('logs an unexpected error as error with a fixed word, never its message', async () => {
    const { logger, lines } = spyLogger();
    const warn = vi.spyOn(logger, 'warn');
    await expect(
      loggedWrite(logger, context, () =>
        Promise.reject(new Error('db exploded: sk-live-0042')),
      ),
    ).rejects.toThrow('db exploded');
    expect(warn).not.toHaveBeenCalled();
    expect(lines).toEqual([
      [
        'error',
        {
          event: 'assessment',
          action: 'finish',
          timelineId: 3,
          outcome: 'error',
          reason: 'internal_error',
          requestId: 'req-1',
          actorId: 7,
        },
      ],
    ]);
  });
});
