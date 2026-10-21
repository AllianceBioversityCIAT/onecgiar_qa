import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator.js';
import { ApiErrorResponses, ApiOkEnvelope } from '../../common/api-response.js';
import type { ErrorCode } from '../../common/error-codes.js';
import { idempotencyHandleOf } from '../../common/idempotency/idempotency.context.js';
import {
  IDEMPOTENCY_REPLAYED_HEADERS,
  withIdempotencyErrors,
} from '../../common/idempotency/idempotency.openapi.js';
import { Idempotent } from '../../common/idempotency/idempotent.decorator.js';
import { ACCESS_TOKEN_SCHEME } from '../../common/openapi.js';
import { requestIdOf, type RequestWithId } from '../../common/request-id.js';
import type { AuthenticatedUser } from '../../users/current-user.cache.js';
import { Permission } from '../../users/permissions.js';
import type { AdminConfigContext } from '../admin-config.context.js';
import { CycleIdParams } from '../cycles/dto/cycle-params.js';
import type { DefaultStep } from './default-steps.js';
import { CreateTimelineDto } from './dto/create-timeline.dto.js';
import { TimelineIdParams } from './dto/timeline-params.js';
import {
  DefaultStepModel,
  TimelineDetailModel,
  TimelineModel,
} from './models/timeline.model.js';
import type {
  TimelineDetailResponse,
  TimelineResponse,
} from './timeline-response.js';
import { TimelinesService } from './timelines.service.js';

// Codes shared by every route: the guard answers before anything else, so a
// non-admin gets the same 403 whatever the cycle (FR-16).
const ACCESS: Record<401 | 403, ErrorCode[]> = {
  401: ['AUTH_TOKEN_INVALID', 'AUTH_USER_NOT_ADMITTED'],
  403: ['AUTH_PERMISSION_DENIED'],
};

const listOf = (model: new () => unknown) => ({
  type: 'array',
  items: { $ref: getSchemaPath(model) },
});

/**
 * The timelines API (design 6; FR-4, FR-5, FR-6, FR-11, FR-16, FR-17).
 * `ADMIN_ACCESS` on the whole class: the global `PermissionGuard` refuses
 * everyone else before any handler, pipe or lookup runs. The paths are spelled
 * per route because they sit under `/cycles/:id`, `/timelines/:id` and
 * `/timeline-defaults`. Reads (FR-12) compute status on the fly and never write. Create is idempotent per `Idempotency-Key` and answers
 * the timeline as read after the commit.
 */
@ApiTags('timelines')
@ApiBearerAuth(ACCESS_TOKEN_SCHEME)
@RequirePermission(Permission.ADMIN_ACCESS)
@Controller()
export class TimelinesController {
  constructor(
    @Inject(TimelinesService) private readonly timelines: TimelinesService,
  ) {}

  private context(
    actor: AuthenticatedUser,
    request: RequestWithId,
  ): AdminConfigContext {
    // A keyed request carries its reservation from the interceptor (P-1);
    // without the header there is none and nothing is marked.
    const idempotency = idempotencyHandleOf(request);
    return {
      actorId: actor.id,
      requestId: requestIdOf(request),
      ...(idempotency === undefined ? {} : { idempotency }),
    };
  }

  @ApiOperation({
    summary: 'List the default steps of a new timeline',
    description:
      'The five steps every client proposes: position, name, audience, round and whether the step requires a load. The admin can rename, drop or regroup them before creating the timeline.',
  })
  @ApiOkEnvelope(listOf(DefaultStepModel), { extraModels: [DefaultStepModel] })
  @ApiErrorResponses(ACCESS)
  @Get('timeline-defaults')
  defaults(): DefaultStep[] {
    return this.timelines.defaultSteps();
  }

  @ApiOperation({
    summary: 'Create a timeline in a cycle',
    description:
      'The first timeline of a cycle is the official one and every later one is additional; the server decides, and a `kind` in the body is a 400. Allowed in a `draft` or `active` cycle. Every rule problem of the request is listed in one 400, and nothing is written when there is one.',
  })
  @ApiOkEnvelope(TimelineModel, {
    status: 201,
    headers: IDEMPOTENCY_REPLAYED_HEADERS,
  })
  @ApiErrorResponses(
    withIdempotencyErrors({
      ...ACCESS,
      400: ['VALIDATION_FAILED', 'MALFORMED_JSON'],
      404: ['CYCLES_NOT_FOUND'],
      409: ['CYCLES_CLOSED', 'TIMELINES_NAME_TAKEN'],
      503: ['SERVICE_UNAVAILABLE'],
    }),
  )
  @Idempotent()
  @Post('cycles/:id/timelines')
  async create(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
    @Param() { id }: CycleIdParams,
    @Body() dto: CreateTimelineDto,
  ): Promise<TimelineResponse> {
    const { timelineId } = await this.timelines.create(
      this.context(actor, request),
      id,
      dto,
    );
    return this.timelines.get(timelineId);
  }

  @ApiOperation({
    summary: 'List the timelines of a cycle',
    description:
      'The official timeline first, then the additional ones newest first. Status, current step and readiness are computed on read from today in Rome; nothing is stored or changed by reading.',
  })
  @ApiOkEnvelope(listOf(TimelineModel), { extraModels: [TimelineModel] })
  @ApiErrorResponses({
    ...ACCESS,
    400: ['VALIDATION_FAILED'],
    404: ['CYCLES_NOT_FOUND'],
  })
  @Get('cycles/:id/timelines')
  list(@Param() { id }: CycleIdParams): Promise<TimelineResponse[]> {
    return this.timelines.listByCycle(id);
  }

  @ApiOperation({
    summary: 'Read one timeline',
    description: 'The timeline as listed, plus the users assigned to it.',
  })
  @ApiOkEnvelope(TimelineDetailModel)
  @ApiErrorResponses({
    ...ACCESS,
    400: ['VALIDATION_FAILED'],
    404: ['TIMELINES_NOT_FOUND'],
  })
  @Get('timelines/:id')
  detail(@Param() { id }: TimelineIdParams): Promise<TimelineDetailResponse> {
    return this.timelines.detail(id);
  }
}
