// @akili-spec assessment/step-1-assessment
import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ReadAccess } from '../auth/decorators/read-access.decorator.js';
import {
  ApiErrorResponses,
  ApiOkEnvelope,
  Paged,
} from '../common/api-response.js';
import type { ErrorCode } from '../common/error-codes.js';
import { ACCESS_TOKEN_SCHEME } from '../common/openapi.js';
import type { AuthenticatedUser } from '../users/current-user.cache.js';
import { WorklistTimelineParams } from './dto/worklist-params.js';
import { ListWorklistQuery } from './dto/worklist.query.js';
import {
  WorklistOptionsModel,
  WorklistPageModel,
  WorklistTimelinesModel,
} from './models/worklist.model.js';
import {
  WorklistService,
  type WorklistOptions,
  type WorklistPage,
  type WorklistTimelines,
} from './worklist.service.js';

const UNAUTHENTICATED: Record<401, ErrorCode[]> = {
  401: ['AUTH_TOKEN_INVALID', 'AUTH_USER_NOT_ADMITTED'],
};

// The scope is the service's, not the guard's: any authenticated caller may
// ask, and a timeline that is not offered to them answers like a missing one.
const TIMELINE_ERRORS: Record<401 | 404, ErrorCode[]> = {
  ...UNAUTHENTICATED,
  404: ['TIMELINES_NOT_FOUND'],
};

/**
 * The worklist routes (design 6, first three rows; FR-1, FR-3, FR-7, FR-22):
 * a thin HTTP layer over `WorklistService`, which owns the scope, the
 * validation of `limit` and `cursor`, and the 404.
 */
@ApiTags('assessment')
@ApiBearerAuth(ACCESS_TOKEN_SCHEME)
@ReadAccess()
@Controller()
export class WorklistController {
  constructor(
    @Inject(WorklistService) private readonly worklist: WorklistService,
  ) {}

  @ApiOperation({
    summary: 'List the timelines the caller can open a worklist on',
    description:
      'The timelines of the active cycle the caller is assigned to with an enabled reviewer role, or all of them for an ADMIN, each with the caller roles on it (an ADMIN also carries `ADMIN`) and the step of their role. `defaultTimelineId` is the official timeline when offered, else the earliest step-1 opening. Never a 404: a caller with none gets an empty list.',
  })
  @ApiOkEnvelope(WorklistTimelinesModel)
  @ApiErrorResponses(UNAUTHENTICATED)
  @Get('worklist/timelines')
  timelines(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WorklistTimelines> {
    return this.worklist.timelines(user);
  }

  @ApiOperation({
    summary: 'One page of the worklist of a timeline',
    description:
      'Filters combine with AND; list filters take comma-separated values. Auto-validated results are hidden unless `status` names them, and the counters follow the same hiding but ignore the filters. Sorted by `sort` and `dir`, then by result code; page with `meta.page.nextCursor`, which is valid only with the same `sort` and `dir`. A timeline that is not offered to the caller, or does not exist, is the same 404.',
  })
  @ApiOkEnvelope(WorklistPageModel, { paged: true })
  @ApiErrorResponses({ ...TIMELINE_ERRORS, 400: ['VALIDATION_FAILED'] })
  @Get('timelines/:timelineId/worklist')
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: WorklistTimelineParams,
    @Query() query: ListWorklistQuery,
  ): Promise<Paged<never>> {
    const { nextCursor, ...page } = await this.worklist.list(
      user,
      params.timelineId,
      {
        statuses: query.status,
        programIds: query.programId,
        resultTypeKeys: query.resultTypeKey,
        q: query.q,
        sort: query.sort,
        dir: query.dir,
        limit: query.limit,
        cursor: query.cursor,
      },
    );
    return pagedObject(page, nextCursor);
  }

  @ApiOperation({
    summary: 'The filter options of a worklist',
    description:
      'The programs and result types inside the caller scope, and every QA status. A timeline that is not offered to the caller is a 404.',
  })
  @ApiOkEnvelope(WorklistOptionsModel)
  @ApiErrorResponses(TIMELINE_ERRORS)
  @Get('timelines/:timelineId/worklist/options')
  options(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: WorklistTimelineParams,
  ): Promise<WorklistOptions> {
    return this.worklist.options(user, params.timelineId);
  }
}

/**
 * The worklist answers an object in `data` with the cursor in `meta.page`, and
 * the shared `Paged` carries a list. The interceptor only reads `items` and
 * `nextCursor`, so the object travels as `items`; the type is widened here
 * rather than in `common/`.
 */
function pagedObject(
  page: Omit<WorklistPage, 'nextCursor'>,
  nextCursor: string | null,
): Paged<never> {
  return new Paged(page as unknown as readonly never[], nextCursor);
}
