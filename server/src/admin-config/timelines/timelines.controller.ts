import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { Response } from 'express';
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
import { AssignTimelineUserDto } from './dto/assign-timeline-user.dto.js';
import { CreateTimelineDto } from './dto/create-timeline.dto.js';
import {
  TimelineAssignmentParams,
  TimelineIdParams,
} from './dto/timeline-params.js';
import { UpdateTimelineDto } from './dto/update-timeline.dto.js';
import {
  DefaultStepModel,
  TimelineDetailModel,
  TimelineModel,
  TimelineUserModel,
} from './models/timeline.model.js';
import type {
  TimelineDetailResponse,
  TimelineResponse,
  TimelineUserResponse,
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
 * The timelines API (design 6; FR-4, FR-5, FR-6, FR-11, FR-16, FR-17; timeline-edit FR-1, FR-9, FR-12, FR-13).
 * `ADMIN_ACCESS` on the whole class: the global `PermissionGuard` refuses
 * everyone else before any handler, pipe or lookup runs. The paths are spelled
 * per route because they sit under `/cycles/:id`, `/timelines/:id` and
 * `/timeline-defaults`. Reads (FR-12) compute status on the fly and never write. Create and edit are idempotent per `Idempotency-Key`; create answers
 * the timeline as read after the commit, edit answers the one the service read.
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

  @ApiOperation({
    summary: 'Edit a timeline',
    description:
      'A partial edit: a key left out keeps its stored value. `version` is required and must be the one the admin read; otherwise 409 `TIMELINES_VERSION_STALE` and nothing is written. Steps are addressed by position and only their name and dates can change; audience, round, load requirement and kind are fixed (an unknown key at any level is a 400). A change to a step in progress needs `confirmInProgress`. Every rule problem is listed in one 400. A request that changes nothing answers 200 with the timeline as stored and writes nothing. Allowed in a `draft` or `active` cycle. One audit row per applied edit.',
  })
  @ApiOkEnvelope(TimelineModel, { headers: IDEMPOTENCY_REPLAYED_HEADERS })
  @ApiErrorResponses(
    withIdempotencyErrors({
      ...ACCESS,
      400: ['VALIDATION_FAILED', 'MALFORMED_JSON'],
      404: ['TIMELINES_NOT_FOUND'],
      409: [
        'CYCLES_CLOSED',
        'TIMELINES_NAME_TAKEN',
        'TIMELINES_VERSION_STALE',
        'TIMELINES_IN_PROGRESS_UNCONFIRMED',
      ],
      503: ['SERVICE_UNAVAILABLE'],
    }),
  )
  @Idempotent()
  @Patch('timelines/:id')
  async update(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
    @Param() { id }: TimelineIdParams,
    @Body() dto: UpdateTimelineDto,
  ): Promise<TimelineResponse> {
    return this.timelines.update(this.context(actor, request), id, dto);
  }

  @ApiOperation({
    summary: 'Assign a user to a timeline',
    description:
      'The user must be active and hold a live grant of the role (ASSESSOR, LEAD_ASSESSOR, TPB or PPU; any other role is a 400). 201 when the assignment is new; 200 with the existing assignment when the user already holds that role in the timeline, and nothing is written. Allowed in any cycle that is not closed.',
  })
  @ApiOkEnvelope(TimelineUserModel, {
    status: 201,
    description: 'Assigned now',
  })
  @ApiOkEnvelope(TimelineUserModel, {
    description: 'Already assigned: the existing assignment, nothing written',
  })
  @ApiErrorResponses({
    ...ACCESS,
    400: ['VALIDATION_FAILED', 'MALFORMED_JSON'],
    404: ['TIMELINES_NOT_FOUND', 'USERS_NOT_FOUND'],
    409: ['CYCLES_CLOSED', 'TIMELINES_USER_NOT_ELIGIBLE'],
  })
  @Post('timelines/:id/users')
  async assign(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
    @Res({ passthrough: true }) response: Response,
    @Param() { id }: TimelineIdParams,
    @Body() dto: AssignTimelineUserDto,
  ): Promise<TimelineUserResponse> {
    const { assignment, created } = await this.timelines.assign(
      this.context(actor, request),
      id,
      dto,
    );
    // A POST answers 201; a repeat is the same assignment, not a new one.
    response.status(created ? 201 : 200);
    return assignment;
  }

  @ApiOperation({
    summary: 'Remove a user from a timeline',
    description:
      'The assignment stops counting at once and its row is kept with who removed it and when. Allowed in any cycle that is not closed.',
  })
  @ApiNoContentResponse({ description: 'Removed' })
  @ApiErrorResponses({
    ...ACCESS,
    400: ['VALIDATION_FAILED'],
    404: ['TIMELINES_NOT_FOUND', 'TIMELINES_ASSIGNMENT_NOT_FOUND'],
    409: ['CYCLES_CLOSED'],
  })
  @HttpCode(204)
  @Delete('timelines/:id/users/:assignmentId')
  async remove(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
    @Param() { id, assignmentId }: TimelineAssignmentParams,
  ): Promise<void> {
    await this.timelines.remove(this.context(actor, request), id, assignmentId);
  }
}
