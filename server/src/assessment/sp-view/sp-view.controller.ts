// P2-3911: the Science Program view, under /sp. Every route is an SP session
// route (`@SpSession()`): the Cognito guards skip it and SpSessionGuard
// requires a live SP session. Scope and the 404 live in the services.
import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponses, ApiOkEnvelope } from '../../common/api-response.js';
import {
  SpProgramQuery,
  SpResultParams,
  SpResultsQuery,
  SpTimelineParams,
} from './dto/sp-view.query.js';
import { SpMeModel } from './models/sp-access.model.js';
import {
  SpResultModel,
  SpResultsModel,
  SpTimelinesModel,
} from './models/sp-view.model.js';
import { SpAccessService, type SpMe } from './sp-access.service.js';
import type { SpSessionPrincipal } from './sp-access.store.js';
import { CurrentSpSession, SpSession } from './sp-session.decorator.js';
import {
  SpViewService,
  type SpResultResponse,
  type SpResultsResponse,
  type SpTimelinesResponse,
} from './sp-view.service.js';

@ApiTags('sp-view')
@SpSession()
@Controller('sp')
export class SpViewController {
  constructor(
    @Inject(SpAccessService) private readonly access: SpAccessService,
    @Inject(SpViewService) private readonly view: SpViewService,
  ) {}

  @ApiOperation({
    summary: 'Read the SP session: user name, admin flag and programs',
  })
  @ApiOkEnvelope(SpMeModel)
  @ApiErrorResponses({
    401: ['SP_SESSION_INVALID'],
    503: ['SERVICE_UNAVAILABLE'],
  })
  @Get('me')
  me(@CurrentSpSession() session: SpSessionPrincipal): Promise<SpMe> {
    return this.access.me(session);
  }

  @ApiOperation({
    summary: "List the active cycle's timelines of a program",
    description:
      "The official timeline and the additional ones whose scope covers the program, each with its programs step and that step's state now (upcoming, in_progress, closed). An admin session must pass `programId`.",
  })
  @ApiOkEnvelope(SpTimelinesModel)
  @ApiErrorResponses({
    400: ['VALIDATION_FAILED'],
    401: ['SP_SESSION_INVALID'],
    404: ['SP_NOT_FOUND'],
    503: ['SERVICE_UNAVAILABLE'],
  })
  @Get('timelines')
  timelines(
    @CurrentSpSession() session: SpSessionPrincipal,
    @Query() query: SpProgramQuery,
  ): Promise<SpTimelinesResponse> {
    return this.view.timelines(session, query.programId);
  }

  @ApiOperation({
    summary: "List the program's results of a timeline",
    description:
      "Round-1 results of the program in the timeline, with the QA comments visible to the program (none before the programs step starts) and how many it answered. Filters by status and result type are applied by the server; there is no paging. A timeline that is not the program's is a 404.",
  })
  @ApiOkEnvelope(SpResultsModel)
  @ApiErrorResponses({
    400: ['VALIDATION_FAILED'],
    401: ['SP_SESSION_INVALID'],
    404: ['SP_NOT_FOUND'],
    503: ['SERVICE_UNAVAILABLE'],
  })
  @Get('timelines/:timelineId/results')
  results(
    @CurrentSpSession() session: SpSessionPrincipal,
    @Param() params: SpTimelineParams,
    @Query() query: SpResultsQuery,
  ): Promise<SpResultsResponse> {
    return this.view.results(session, params.timelineId, query.programId, {
      statuses: query.status ?? [],
      resultTypeKeys: query.resultTypeKey ?? [],
    });
  }

  @ApiOperation({
    summary: 'Read one result with its QA comments, for the program',
    description:
      'The result as reported, by section, with the QA comments visible to the program on each field and their responses and clarifications. Never names the assessor. `writable` is true while the programs step is in progress. A result of another program, of another timeline, or that does not exist is the same 404.',
  })
  @ApiOkEnvelope(SpResultModel)
  @ApiErrorResponses({
    400: ['VALIDATION_FAILED'],
    401: ['SP_SESSION_INVALID'],
    404: ['SP_NOT_FOUND'],
    409: ['ASSESSMENT_NO_FIELD_CONFIG'],
    503: ['SERVICE_UNAVAILABLE'],
  })
  @Get('timelines/:timelineId/results/:resultCode')
  result(
    @CurrentSpSession() session: SpSessionPrincipal,
    @Param() params: SpResultParams,
    @Query() query: SpProgramQuery,
  ): Promise<SpResultResponse> {
    return this.view.result(
      session,
      params.timelineId,
      params.resultCode,
      query.programId,
    );
  }
}
