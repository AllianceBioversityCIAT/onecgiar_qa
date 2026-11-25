// P2-3911: the assessor side of the program threads (Cognito session): the
// answer to a clarification the program requested, and the read of the
// program's responses on a result (also what the Lead Assessor reads, P2-3912).
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { ReadAccess } from '../../auth/decorators/read-access.decorator.js';
import { ApiErrorResponses, ApiOkEnvelope } from '../../common/api-response.js';
import { ACCESS_TOKEN_SCHEME } from '../../common/openapi.js';
import { requestIdOf, type RequestWithId } from '../../common/request-id.js';
import type { AuthenticatedUser } from '../../users/current-user.cache.js';
import { AssessmentParams, CommentParams } from '../dto/assessment-params.js';
import { ClarificationAnswerBody } from './dto/sp-response.body.js';
import {
  AssessorThreadModel,
  AssessorThreadsModel,
} from './models/sp-view.model.js';
import { SpResponseService } from './sp-response.service.js';
import type { AssessorThreadView } from './sp-thread.js';

@ApiTags('assessment')
@ApiBearerAuth(ACCESS_TOKEN_SCHEME)
@ReadAccess()
@Controller()
export class SpAssessorController {
  constructor(
    @Inject(SpResponseService) private readonly service: SpResponseService,
  ) {}

  @ApiOperation({
    summary: 'Answer the clarification a program requested on your comment',
    description:
      "The comment's author only, while the programs step is in progress and a clarification is pending. The comment goes back to `open`, so the program can respond again. Answers the comment's program thread.",
  })
  @ApiOkEnvelope(AssessorThreadModel)
  @ApiErrorResponses({
    400: ['VALIDATION_FAILED', 'MALFORMED_JSON'],
    401: ['AUTH_TOKEN_INVALID', 'AUTH_USER_NOT_ADMITTED'],
    403: ['ASSESSMENT_READ_ONLY', 'ASSESSMENT_NOT_COMMENT_AUTHOR'],
    404: ['ASSESSMENT_NOT_FOUND'],
    409: ['ASSESSMENT_STEP_CLOSED', 'CLARIFICATION_NOT_PENDING'],
    413: ['PAYLOAD_TOO_LARGE'],
  })
  @HttpCode(200)
  @Post('assessment-comments/:commentId/clarification-answer')
  answer(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: CommentParams,
    @Body() body: ClarificationAnswerBody,
    @Req() request: RequestWithId,
  ): Promise<AssessorThreadView> {
    return this.service.answerClarification(
      user,
      params.commentId,
      body.body,
      requestIdOf(request),
    );
  }

  @ApiOperation({
    summary: "Read the program's responses on a result",
    description:
      "Every QA comment visible to the program, with the program's latest response (who responded, name and email, and when), the history and the clarifications. The same 404 as the assessment view for a result outside the caller's scope.",
  })
  @ApiOkEnvelope(AssessorThreadsModel)
  @ApiErrorResponses({
    400: ['VALIDATION_FAILED'],
    401: ['AUTH_TOKEN_INVALID', 'AUTH_USER_NOT_ADMITTED'],
    404: ['ASSESSMENT_NOT_FOUND'],
    409: ['ASSESSMENT_NO_FIELD_CONFIG'],
  })
  @Get('timelines/:timelineId/results/:resultCode/sp-responses')
  threads(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: AssessmentParams,
  ): Promise<{ comments: AssessorThreadView[] }> {
    return this.service.threadsFor(user, params.timelineId, params.resultCode);
  }
}
