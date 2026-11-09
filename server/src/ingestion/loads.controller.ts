// @akili-spec ingestion/step-1-loads
// @akili-spec ingestion/timeline-sync
import {
  applyDecorators,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExtraModels,
  ApiOperation,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { AdminConfigContext } from '../admin-config/admin-config.context.js';
import { TimelineIdParams } from '../admin-config/timelines/dto/timeline-params.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { RequirePermission } from '../auth/decorators/require-permission.decorator.js';
import {
  ApiErrorResponses,
  ApiMetaModel,
  ApiOkEnvelope,
} from '../common/api-response.js';
import type { ErrorCode } from '../common/error-codes.js';
import { idempotencyHandleOf } from '../common/idempotency/idempotency.context.js';
import {
  IDEMPOTENCY_REPLAYED_HEADERS,
  withIdempotencyErrors,
} from '../common/idempotency/idempotency.openapi.js';
import { Idempotent } from '../common/idempotency/idempotent.decorator.js';
import { ACCESS_TOKEN_SCHEME } from '../common/openapi.js';
import { requestIdOf, type RequestWithId } from '../common/request-id.js';
import type { AuthenticatedUser } from '../users/current-user.cache.js';
import { Permission } from '../users/permissions.js';
import { LoadParams } from './dto/load-params.js';
import { StartLoadDto } from './dto/start-load.dto.js';
import {
  LoadDetailModel,
  LoadItemModel,
  LoadPreviewModel,
  StartedLoadModel,
} from './models/load.model.js';
import {
  LoadsService,
  type LoadDetail,
  type LoadItem,
  type LoadPreview,
  type StartedLoad,
} from './loads.service.js';

// Codes shared by every route: the guard answers before anything else, so a
// non-admin gets the same 403 whatever the timeline (FR-13).
const ACCESS: Record<401 | 403, ErrorCode[]> = {
  401: ['AUTH_TOKEN_INVALID', 'AUTH_USER_NOT_ADMITTED'],
  403: ['AUTH_PERMISSION_DENIED'],
};

const listOf = (model: new () => unknown) => ({
  type: 'array',
  items: { $ref: getSchemaPath(model) },
});

/**
 * The success envelope of a 202. `ApiOkEnvelope` documents 200 and 201 only
 * and `common/` is not this spec's to widen, so the same schema is composed
 * here from the shared meta model.
 */
const ApiAcceptedEnvelope = (
  data: new () => unknown,
  headers: Record<string, { description: string; schema: object }>,
) =>
  applyDecorators(
    ApiExtraModels(ApiMetaModel, data),
    ApiResponse({
      status: 202,
      description:
        'Accepted: the load is recorded and the run continues in the background',
      headers,
      schema: {
        type: 'object',
        required: ['success', 'data', 'meta'],
        properties: {
          success: { type: 'boolean', enum: [true] },
          data: { $ref: getSchemaPath(data) },
          meta: { $ref: getSchemaPath(ApiMetaModel) },
        },
      },
    }),
  );

/**
 * The loads API (step-1 design 6; FR-1, FR-2, FR-10, FR-12, FR-13; timeline-sync design 6).
 * `ADMIN_ACCESS` on the whole class: the global `PermissionGuard` refuses
 * everyone else before any handler, pipe or lookup runs, so Reporting is never
 * called for another role. The start is idempotent per `Idempotency-Key` and
 * answers 202 as soon as the load is committed, without waiting for the run.
 */
@ApiTags('loads')
@ApiBearerAuth(ACCESS_TOKEN_SCHEME)
@RequirePermission(Permission.ADMIN_ACCESS)
@Controller()
export class LoadsController {
  constructor(@Inject(LoadsService) private readonly loads: LoadsService) {}

  private context(
    actor: AuthenticatedUser,
    request: RequestWithId,
  ): AdminConfigContext {
    // A keyed request carries its reservation from the interceptor; without
    // the header there is none and nothing is marked.
    const idempotency = idempotencyHandleOf(request);
    return {
      actorId: actor.id,
      requestId: requestIdOf(request),
      ...(idempotency === undefined ? {} : { idempotency }),
    };
  }

  // `preview` is declared before `:loadId` so the literal wins the route.
  @ApiOperation({
    summary: 'Preview a timeline sync',
    description:
      "What a sync of the timeline would do now: its `round` and `stepPosition`, how many results it would bring in (new and re-submitted, by program and result type), the KP groups, the results this timeline returned that are not yet re-submitted, and what it would skip and why. Reads the timeline, QA's memberships and Reporting; writes nothing, in QA or in Reporting. `window` is `closed` when the start would be refused: the cycle is closed, or the last step of the timeline has closed.",
  })
  @ApiOkEnvelope(LoadPreviewModel)
  @ApiErrorResponses({
    ...ACCESS,
    400: ['VALIDATION_FAILED'],
    404: ['TIMELINES_NOT_FOUND'],
    409: ['LOADS_CATALOG_MISSING'],
    503: ['SERVICE_UNAVAILABLE'],
  })
  @Get('timelines/:id/loads/preview')
  preview(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
    @Param() { id }: TimelineIdParams,
  ): Promise<LoadPreview> {
    return this.loads.preview(this.context(actor, request), id);
  }

  @ApiOperation({
    summary: 'Start a timeline sync',
    description:
      'Allowed while the cycle is not closed and the last step of the timeline has not closed (its closing minute is still open); before step 1 opens it is accepted as round 1. Records the load as `running`, with the round and step position in force, and answers 202 with its id; the run continues in the background and is read with the two GET routes. One load runs per cycle. Reporting must answer a first check, otherwise 503 and nothing is written. Idempotent per `Idempotency-Key`: a repeat returns the same load id and starts no second load.',
  })
  @ApiAcceptedEnvelope(StartedLoadModel, IDEMPOTENCY_REPLAYED_HEADERS)
  @ApiErrorResponses(
    withIdempotencyErrors({
      ...ACCESS,
      400: ['VALIDATION_FAILED', 'MALFORMED_JSON'],
      404: ['TIMELINES_NOT_FOUND'],
      409: [
        'CYCLES_CLOSED',
        'LOADS_WINDOW_CLOSED',
        'LOADS_ALREADY_RUNNING',
        'LOADS_CATALOG_MISSING',
      ],
      503: ['SERVICE_UNAVAILABLE'],
    }),
  )
  @Idempotent()
  @HttpCode(202)
  @Post('timelines/:id/loads')
  start(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
    @Param() { id }: TimelineIdParams,
    // The body is `{}`; the class refuses any key.
    @Body() _body: StartLoadDto,
  ): Promise<StartedLoad> {
    return this.loads.start(this.context(actor, request), id);
  }

  @ApiOperation({
    summary: 'List the syncs of a timeline',
    description:
      'Newest first, each with its `round` and `stepPosition`. A `running` load whose heartbeat expired reads `failed` with `ABANDONED`. Poll every 2 seconds while one is `running`.',
  })
  @ApiOkEnvelope(listOf(LoadItemModel), { extraModels: [LoadItemModel] })
  @ApiErrorResponses({
    ...ACCESS,
    400: ['VALIDATION_FAILED'],
    404: ['TIMELINES_NOT_FOUND'],
  })
  @Get('timelines/:id/loads')
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
    @Param() { id }: TimelineIdParams,
  ): Promise<LoadItem[]> {
    return this.loads.list(this.context(actor, request), id);
  }

  @ApiOperation({
    summary: 'Read one load',
    description:
      'The load as listed, plus its summary: loaded (new and re-submitted) by program and result type, the KP groups, the results returned and not re-submitted, and the skips by reason with the other timelines named.',
  })
  @ApiOkEnvelope(LoadDetailModel)
  @ApiErrorResponses({
    ...ACCESS,
    400: ['VALIDATION_FAILED'],
    404: ['TIMELINES_NOT_FOUND', 'LOADS_NOT_FOUND'],
  })
  @Get('timelines/:id/loads/:loadId')
  detail(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
    @Param() { id, loadId }: LoadParams,
  ): Promise<LoadDetail> {
    return this.loads.get(this.context(actor, request), id, loadId);
  }
}
