// @akili-spec assessment/ai-suggestions
import { ConflictException } from '@nestjs/common';
import { errorBody } from '../common/error-codes.js';

/** FR-3: the API has no AI queue (`AI_JOBS_QUEUE_URL` unset), so the AI admin routes refuse instead of a silent no-op. */
export class AiJobsDisabledError extends ConflictException {
  constructor() {
    super(errorBody('AI_JOBS_DISABLED'));
  }
}
