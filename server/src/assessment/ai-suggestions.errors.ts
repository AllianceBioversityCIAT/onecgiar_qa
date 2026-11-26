// @akili-spec assessment/ai-suggestions
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { errorBody } from '../common/error-codes.js';
import type { AboveAiRefusal } from './ai-suggestions-rules.js';

/** FR-5: the PPU never sees a suggestion. */
export class AiSuggestionsForbiddenError extends ForbiddenException {
  constructor() {
    super(errorBody('AI_SUGGESTIONS_FORBIDDEN'));
  }
}

/** FR-8: no stored suggestion with this id for the result's snapshot, or it is not `available`. */
export class AiSuggestionNotFoundError extends NotFoundException {
  constructor() {
    super(errorBody('AI_SUGGESTION_NOT_FOUND'));
  }
}

/** FR-8: an event the stored suggestion does not support. `rule` is for logs and tests only. */
export class AiEventInvalidError extends BadRequestException {
  constructor(
    readonly rule:
      | AboveAiRefusal
      | 'comment_not_of_field'
      | 'comment_id_required'
      | 'fields_of_other_action',
  ) {
    super(errorBody('AI_EVENT_INVALID'));
  }
}

/** NFR-1: DynamoDB could not be read; the client shows "Suggestion not available". */
export class AiSuggestionsUnavailableError extends ServiceUnavailableException {
  constructor(cause?: unknown) {
    super(errorBody('SERVICE_UNAVAILABLE'), { cause });
  }
}
