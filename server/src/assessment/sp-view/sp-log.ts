// P2-3911: the decision log of the SP view. One fixed-shape JSON line per
// decision, with ids and fixed words only: never an email, a name, a code, a
// token, the API key or a body. This file has no way to receive one.
import { HttpException, Logger } from '@nestjs/common';

const logger = new Logger('SpView');

export type SpAccessAction = 'issue' | 'exchange';
export type SpResponseAction = 'respond' | 'clarification_answer';

/** The refusal word: the catalog code of the error, else the status, else a fixed word. */
export function reasonOf(error: unknown): { reason: string; refused: boolean } {
  if (error instanceof HttpException) {
    const status = error.getStatus();
    const body = error.getResponse() as { code?: unknown };
    const reason =
      typeof body === 'object' &&
      body !== null &&
      typeof body.code === 'string' &&
      /^[A-Z_]{1,64}$/.test(body.code)
        ? body.code
        : `http_${status}`;
    return { reason, refused: status < 500 };
  }
  return { reason: 'internal_error', refused: false };
}

/** `event: 'sp_access'`: a code issue or a code exchange (or a refused session). */
export function logSpAccess(entry: {
  action: SpAccessAction;
  outcome: 'ok' | 'refused' | 'error';
  reason?: string;
  requestId: string;
}): void {
  const line = JSON.stringify({
    event: 'sp_access',
    action: entry.action,
    outcome: entry.outcome,
    ...(entry.reason === undefined ? {} : { reason: entry.reason }),
    requestId: entry.requestId,
  });
  if (entry.outcome === 'ok') logger.log(line);
  else if (entry.outcome === 'refused') logger.warn(line);
  else logger.error(line);
}

/** `event: 'sp_response'`: a program response or an assessor's clarification answer. */
export function logSpResponse(entry: {
  action: SpResponseAction;
  commentId: number;
  outcome: 'ok' | 'refused' | 'error';
  reason?: string;
  kind?: string;
  sessionId?: number;
  actorId?: number;
  requestId: string;
}): void {
  const line = JSON.stringify({
    event: 'sp_response',
    action: entry.action,
    commentId: entry.commentId,
    ...(entry.kind === undefined ? {} : { kind: entry.kind }),
    outcome: entry.outcome,
    ...(entry.reason === undefined ? {} : { reason: entry.reason }),
    ...(entry.sessionId === undefined ? {} : { sessionId: entry.sessionId }),
    ...(entry.actorId === undefined ? {} : { actorId: entry.actorId }),
    requestId: entry.requestId,
  });
  if (entry.outcome === 'ok') logger.log(line);
  else if (entry.outcome === 'refused') logger.warn(line);
  else logger.error(line);
}

/** Runs `work` and logs its one line; the error is rethrown untouched. */
export async function withSpLog<T>(
  write: (outcome: 'ok' | 'refused' | 'error', reason?: string) => void,
  work: () => Promise<T>,
): Promise<T> {
  try {
    const result = await work();
    write('ok');
    return result;
  } catch (error) {
    const { reason, refused } = reasonOf(error);
    write(refused ? 'refused' : 'error', reason);
    throw error;
  }
}
