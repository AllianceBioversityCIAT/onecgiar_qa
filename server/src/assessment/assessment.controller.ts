// @akili-spec assessment/step-1-assessment
import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ReadAccess } from '../auth/decorators/read-access.decorator.js';
import { ApiErrorResponses, ApiOkEnvelope } from '../common/api-response.js';
import { ACCESS_TOKEN_SCHEME } from '../common/openapi.js';
import type { AuthenticatedUser } from '../users/current-user.cache.js';
import {
  AssessmentService,
  type AssessmentViewResponse,
} from './assessment.service.js';
import {
  AssessmentParams,
  AssessmentViewQuery,
} from './dto/assessment-params.js';
import { AssessmentViewModel } from './models/assessment.model.js';

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
}
