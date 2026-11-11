// @akili-spec assessment/step-1-assessment
import { HttpException, type Logger } from '@nestjs/common';

// The decision log of the assessment writes (FR-22, NFR-5; design 7.9): ONE
// `event: 'assessment'` line per write request, success or refusal, with ids
// and fixed words only. Never a title, a value, a label, a comment body or a
// nickname: this file has no way to receive one, which is the point. The
// release dispatcher writes its own `assessment_release` lines.

export type AssessmentWriteAction =
  | 'validate'
  | 'comment'
  | 'withdraw'
  | 'finish'
  | 'quick_comment_save';

export interface WriteLogContext {
  action: AssessmentWriteAction;
  actorId: number;
  requestId: string;
  /** Known from the URL on the result routes; a withdraw learns it from the comment. */
  timelineId?: number;
}

/** What the work learns on its way (ids only): set once the membership is known and inside the caller's scope. */
export interface WriteLogTrace {
  timelineId?: number;
  membershipId?: number;
}

/** The refusal word: the error code of the envelope, else the status, else a fixed word. */
function reasonOf(error: unknown): { reason: string; refused: boolean } {
  if (error instanceof HttpException) {
    const status = error.getStatus();
    const body = error.getResponse() as { code?: unknown };
    const reason =
      typeof body.code === 'string' && /^[A-Z_]{1,64}$/.test(body.code)
        ? body.code
        : `http_${status}`;
    return { reason, refused: status < 500 };
  }
  return { reason: 'internal_error', refused: false };
}

/**
 * Runs a write and logs its one line. The error is rethrown untouched, so the
 * answer is whatever it was without this wrapper.
 */
export async function loggedWrite<T>(
  logger: Logger,
  context: WriteLogContext,
  work: (trace: WriteLogTrace) => Promise<T>,
): Promise<T> {
  const trace: WriteLogTrace = {};
  const line = (outcome: string, reason?: string): string =>
    JSON.stringify({
      event: 'assessment',
      action: context.action,
      timelineId: trace.timelineId ?? context.timelineId,
      membershipId: trace.membershipId,
      outcome,
      ...(reason === undefined ? {} : { reason }),
      requestId: context.requestId,
      actorId: context.actorId,
    });
  try {
    const result = await work(trace);
    logger.log(line('ok'));
    return result;
  } catch (error) {
    const { reason, refused } = reasonOf(error);
    if (refused) logger.warn(line('refused', reason));
    else logger.error(line('error', reason));
    throw error;
  }
}
