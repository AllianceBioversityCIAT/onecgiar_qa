// @akili-spec assessment/ai-suggestions
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ReadAccess } from '../auth/decorators/read-access.decorator.js';
import { RequirePermission } from '../auth/decorators/require-permission.decorator.js';
import { ApiErrorResponses, ApiOkEnvelope } from '../common/api-response.js';
import { ACCESS_TOKEN_SCHEME } from '../common/openapi.js';
import type { AuthenticatedUser } from '../users/current-user.cache.js';
import { Permission } from '../users/permissions.js';
import type { AiSuggestionView } from './ai-suggestions-rules.js';
import { AiSuggestionsService } from './ai-suggestions.service.js';
import type { MissingReasonsRow } from './ai-usage.store.js';
import {
  AiSuggestionEventBody,
  AiSuggestionParams,
} from './dto/ai-suggestion-event.body.js';
import { AssessmentParams } from './dto/assessment-params.js';
import {
  AiMissingReasonsModel,
  AiSuggestionViewModel,
} from './models/ai-suggestion.model.js';

/** The AI suggestions of a result and the record of their use (ai-suggestions FR-4, FR-8). */
@ApiTags('ai-suggestions')
@ApiBearerAuth(ACCESS_TOKEN_SCHEME)
@ReadAccess()
@Controller('timelines/:timelineId/results/:resultCode/ai-suggestions')
export class AiSuggestionsController {
  constructor(
    @Inject(AiSuggestionsService)
    private readonly service: AiSuggestionsService,
  ) {}

  @ApiOperation({
    summary: 'Read the AI suggestions of a result',
    description:
      'One entry per AI-input field of the result: `available` (signal, suggested value, explanation, quote), `unavailable` (with the reason) or `pending` (not produced yet). Assessors and Lead Assessors see every suggestion; a Third-Party Broker sees them read-only with whether a reviewer copied each one; an Admin sees them read-only without that mark; a PPU never sees them. The same 404 as the assessment view for a result outside the caller scope. A 503 means the suggestions could not be read: assess the field as usual.',
  })
  @ApiOkEnvelope(
    { type: 'array', items: { $ref: getSchemaPath(AiSuggestionViewModel) } },
    { extraModels: [AiSuggestionViewModel] },
  )
  @ApiErrorResponses({
    400: ['VALIDATION_FAILED'],
    401: ['AUTH_TOKEN_INVALID', 'AUTH_USER_NOT_ADMITTED'],
    403: ['AI_SUGGESTIONS_FORBIDDEN'],
    404: ['ASSESSMENT_NOT_FOUND'],
    409: ['ASSESSMENT_NO_FIELD_CONFIG'],
    503: ['SERVICE_UNAVAILABLE'],
  })
  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: AssessmentParams,
  ): Promise<AiSuggestionView[]> {
    return this.service.list(user, params.timelineId, params.resultCode);
  }

  @ApiOperation({
    summary: 'Record how a reviewer used an AI suggestion',
    description:
      '`shown`, `copied`, `comment_saved` (with the comment id; the API works out whether the text was edited and never keeps it) and `validated_above_ai` (IRL/IUL validated 2 or more levels above the AI, with a one-line reason; the levels must match the stored suggestion and the reported value). Assessors and Lead Assessors only. `shown`, `copied` and `validated_above_ai` are recorded once per result and step, `comment_saved` once per comment: a repeat succeeds and changes nothing. These records measure the AI, never the reviewers.',
  })
  @ApiNoContentResponse({ description: 'Recorded, or already recorded' })
  @ApiErrorResponses({
    400: ['VALIDATION_FAILED', 'MALFORMED_JSON', 'AI_EVENT_INVALID'],
    401: ['AUTH_TOKEN_INVALID', 'AUTH_USER_NOT_ADMITTED'],
    403: ['ASSESSMENT_READ_ONLY', 'AI_SUGGESTIONS_FORBIDDEN'],
    404: ['ASSESSMENT_NOT_FOUND', 'AI_SUGGESTION_NOT_FOUND'],
    409: ['ASSESSMENT_NO_FIELD_CONFIG'],
    413: ['PAYLOAD_TOO_LARGE'],
    503: ['SERVICE_UNAVAILABLE'],
  })
  @HttpCode(204)
  @Post(':suggestionId/events')
  async record(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: AiSuggestionParams,
    @Body() body: AiSuggestionEventBody,
  ): Promise<void> {
    await this.service.record(
      user,
      params.timelineId,
      params.resultCode,
      params.suggestionId,
      body,
    );
  }
}

/** FR-11: how many IRL/IUL validations 2+ above the AI have no reason (OQ-3). Admin only. */
@ApiTags('ai-suggestions')
@ApiBearerAuth(ACCESS_TOKEN_SCHEME)
@RequirePermission(Permission.ADMIN_ACCESS)
@Controller('ai-suggestions/analysis')
export class AiAnalysisController {
  constructor(
    @Inject(AiSuggestionsService)
    private readonly service: AiSuggestionsService,
  ) {}

  @ApiOperation({
    summary: 'Count the IRL/IUL validations above the AI without a reason',
    description:
      'Per field and prompt version: how many IRL/IUL fields were validated with the reported level 2 or more above the AI suggestion, with and without the one-line reason. Counts only, never per reviewer. Based on the suggestions that were shown. Admin only.',
  })
  @ApiOkEnvelope(AiMissingReasonsModel)
  @ApiErrorResponses({
    401: ['AUTH_TOKEN_INVALID', 'AUTH_USER_NOT_ADMITTED'],
    403: ['AUTH_PERMISSION_DENIED'],
    503: ['SERVICE_UNAVAILABLE'],
  })
  @Get('missing-reasons')
  missingReasons(): Promise<{ basis: 'shown'; fields: MissingReasonsRow[] }> {
    return this.service.missingReasons();
  }
}
