// @akili-spec assessment/step-1-assessment
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ReadAccess } from '../auth/decorators/read-access.decorator.js';
import { ApiErrorResponses, ApiOkEnvelope } from '../common/api-response.js';
import { idempotencyHandleOf } from '../common/idempotency/idempotency.context.js';
import {
  IDEMPOTENCY_REPLAYED_HEADERS,
  withIdempotencyErrors,
} from '../common/idempotency/idempotency.openapi.js';
import { Idempotent } from '../common/idempotency/idempotent.decorator.js';
import { ACCESS_TOKEN_SCHEME } from '../common/openapi.js';
import { requestIdOf, type RequestWithId } from '../common/request-id.js';
import type { AuthenticatedUser } from '../users/current-user.cache.js';
import {
  AssessmentService,
  type AssessmentViewResponse,
  type ValidationSummary,
} from './assessment.service.js';
import type { ViewComment } from './assessment-view.js';
import {
  AssessmentParams,
  AssessmentViewQuery,
  CommentParams,
} from './dto/assessment-params.js';
import { CreateCommentBody } from './dto/create-comment.body.js';
import { ValidateAssessmentBody } from './dto/validate-assessment.body.js';
import {
  AssessmentCommentModel,
  AssessmentViewModel,
  ValidationSummaryModel,
} from './models/assessment.model.js';

/**
 * The assessment routes (design 6). A thin HTTP layer over `AssessmentService`,
 * which owns the scope, the 404 that tells nothing, the 409 / 503 of an
 * unreadable structure, and the removal of Hidden fields (FR-9): nothing is
 * filtered here.
 */
@ApiTags('assessment')
@ApiBearerAuth(ACCESS_TOKEN_SCHEME)
@ReadAccess()
@Controller()
export class AssessmentController {
  constructor(
    @Inject(AssessmentService) private readonly assessments: AssessmentService,
  ) {}

  @ApiOperation({
    summary: 'Open the assessment view of a result',
    description:
      'The header, the sections and fields in the order of the cycle catalog (only those that apply to the result type and are not Hidden), each with its value, labels, configuration, validation and comments; the snapshot keys the catalog lacks under `other`; and whether the caller may write and why not. A result outside the caller scope is the same 404 as a code that does not exist. `round` is for an ADMIN, who reads the latest round by default. A read never creates the assessment.',
  })
  @ApiOkEnvelope(AssessmentViewModel)
  @ApiErrorResponses({
    400: ['VALIDATION_FAILED'],
    401: ['AUTH_TOKEN_INVALID', 'AUTH_USER_NOT_ADMITTED'],
    404: ['ASSESSMENT_NOT_FOUND'],
    409: ['ASSESSMENT_NO_FIELD_CONFIG'],
    503: ['SERVICE_UNAVAILABLE'],
  })
  @Get('timelines/:timelineId/results/:resultCode/assessment')
  open(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: AssessmentParams,
    @Query() query: AssessmentViewQuery,
  ): Promise<AssessmentViewResponse> {
    return this.assessments.open(
      user,
      params.timelineId,
      params.resultCode,
      query.round,
    );
  }

  @ApiOperation({
    summary: 'Set Assessed fields green or grey, or check all',
    description:
      'Send `validated` and exactly one of `fieldKeys` (1 to 200 Assessed fields of the pinned configuration) and `all: true` (every Assessed field). Setting a field to the state it already has succeeds and changes nothing. Only the fields that change are written, with one audit row. A View only, Hidden or unknown key is a 400 naming it. The assessment row is created at the first write. A write that leaves every core field green ends the assessment as `quality_assessed` in the same transaction, with the caller as "Assessed by" (an assessment with no core field never ends this way). Refused with 409 once the step is not open or the assessment ended.',
  })
  @ApiOkEnvelope(ValidationSummaryModel)
  @ApiErrorResponses({
    400: ['VALIDATION_FAILED', 'MALFORMED_JSON'],
    401: ['AUTH_TOKEN_INVALID', 'AUTH_USER_NOT_ADMITTED'],
    403: ['ASSESSMENT_READ_ONLY'],
    404: ['ASSESSMENT_NOT_FOUND'],
    409: [
      'ASSESSMENT_STEP_CLOSED',
      'ASSESSMENT_FINISHED',
      'ASSESSMENT_NO_FIELD_CONFIG',
    ],
    413: ['PAYLOAD_TOO_LARGE'],
    503: ['SERVICE_UNAVAILABLE'],
  })
  @Put('timelines/:timelineId/results/:resultCode/assessment/validations')
  validate(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: RequestWithId,
    @Param() params: AssessmentParams,
    @Body() body: ValidateAssessmentBody,
  ): Promise<ValidationSummary> {
    return this.assessments.validate(
      user,
      params.timelineId,
      params.resultCode,
      {
        validated: body.validated,
        ...(body.fieldKeys === undefined ? {} : { fieldKeys: body.fieldKeys }),
        ...(body.all === undefined ? {} : { all: true }),
      },
      requestIdOf(request),
    );
  }

  @ApiOperation({
    summary: 'Comment on an Assessed field',
    description:
      'Adds a comment of 1 to 2,000 characters (trimmed) to an Assessed field of the pinned configuration. The comment copies the field value, and its labels when the snapshot had them, from the snapshot of the membership it is written on, so it keeps what its author saw; a value over 64 KiB is stored cut, with `valueTruncated`. The assessment row is created at the first write. Refused with 409 once the step is not open or the assessment ended. Safe to retry with the same `Idempotency-Key`. One audit row per comment.',
  })
  @ApiOkEnvelope(AssessmentCommentModel, {
    status: 201,
    headers: IDEMPOTENCY_REPLAYED_HEADERS,
  })
  @ApiErrorResponses(
    withIdempotencyErrors({
      400: ['VALIDATION_FAILED', 'MALFORMED_JSON'],
      401: ['AUTH_TOKEN_INVALID', 'AUTH_USER_NOT_ADMITTED'],
      403: ['ASSESSMENT_READ_ONLY'],
      404: ['ASSESSMENT_NOT_FOUND'],
      409: [
        'ASSESSMENT_STEP_CLOSED',
        'ASSESSMENT_FINISHED',
        'ASSESSMENT_NO_FIELD_CONFIG',
      ],
      413: ['PAYLOAD_TOO_LARGE'],
      503: ['SERVICE_UNAVAILABLE'],
    }),
  )
  @Idempotent()
  @Post('timelines/:timelineId/results/:resultCode/assessment/comments')
  comment(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: RequestWithId,
    @Param() params: AssessmentParams,
    @Body() body: CreateCommentBody,
  ): Promise<ViewComment> {
    return this.assessments.comment(
      user,
      params.timelineId,
      params.resultCode,
      { fieldKey: body.fieldKey, body: body.body },
      requestIdOf(request),
      idempotencyHandleOf(request),
    );
  }

  @ApiOperation({
    summary: 'Finish the assessment',
    description:
      'Ends a pending assessment with the caller as "Assessed by". With no grey core field (or no core field at all) it becomes `quality_assessed`; if every grey core field carries a non-withdrawn comment it becomes `returned`; otherwise it is a 409 `ASSESSMENT_CORE_UNCOMMENTED` whose `error.fields` are the core field keys still to validate or comment on. The end queues one release to Reporting and makes every non-withdrawn comment visible to the program. Of several concurrent finishes exactly one succeeds and the others get 409 `ASSESSMENT_FINISHED`. One audit row.',
  })
  @ApiOkEnvelope(ValidationSummaryModel)
  @ApiErrorResponses({
    400: ['VALIDATION_FAILED'],
    401: ['AUTH_TOKEN_INVALID', 'AUTH_USER_NOT_ADMITTED'],
    403: ['ASSESSMENT_READ_ONLY'],
    404: ['ASSESSMENT_NOT_FOUND'],
    409: [
      'ASSESSMENT_CORE_UNCOMMENTED',
      'ASSESSMENT_FINISHED',
      'ASSESSMENT_STEP_CLOSED',
      'ASSESSMENT_NO_FIELD_CONFIG',
    ],
    503: ['SERVICE_UNAVAILABLE'],
  })
  @HttpCode(200)
  @Post('timelines/:timelineId/results/:resultCode/assessment/finish')
  finish(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: RequestWithId,
    @Param() params: AssessmentParams,
  ): Promise<ValidationSummary> {
    return this.assessments.finish(
      user,
      params.timelineId,
      params.resultCode,
      requestIdOf(request),
    );
  }

  @ApiOperation({
    summary: 'Withdraw your own comment',
    description:
      'The author withdraws a comment while it is still open (the program has not answered) and step 1 or step 2 of the timeline is open. A withdrawn comment leaves the counts and the program view and stays in the audit and the comment events. Allowed after the assessment ended. A comment of someone else is a 403; a comment that does not exist or is outside the caller scope is the same 404.',
  })
  @ApiOkEnvelope(AssessmentCommentModel)
  @ApiErrorResponses({
    400: ['VALIDATION_FAILED'],
    401: ['AUTH_TOKEN_INVALID', 'AUTH_USER_NOT_ADMITTED'],
    403: ['ASSESSMENT_NOT_COMMENT_AUTHOR'],
    404: ['ASSESSMENT_NOT_FOUND'],
    409: ['ASSESSMENT_COMMENT_NOT_OPEN', 'ASSESSMENT_STEP_CLOSED'],
    503: ['SERVICE_UNAVAILABLE'],
  })
  @HttpCode(200)
  @Post('assessment-comments/:commentId/withdraw')
  withdraw(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: RequestWithId,
    @Param() params: CommentParams,
  ): Promise<ViewComment> {
    return this.assessments.withdraw(
      user,
      params.commentId,
      requestIdOf(request),
    );
  }
}
