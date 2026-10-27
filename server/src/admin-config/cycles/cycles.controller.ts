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
import type { CycleView } from './cycle-view.js';
import { CyclesService } from './cycles.service.js';
import { CycleIdParams } from './dto/cycle-params.js';
import { CreateCycleDto } from './dto/create-cycle.dto.js';
import { CycleModel } from './models/cycle.model.js';

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
 * The cycles API (design 6; FR-1…FR-3, FR-16, FR-17). `ADMIN_ACCESS` on the
 * whole class: the global `PermissionGuard` refuses everyone else before any
 * handler, pipe or lookup runs. Create is idempotent per `Idempotency-Key`;
 * every write answers the cycle as read after the commit.
 */
@ApiTags('cycles')
@ApiBearerAuth(ACCESS_TOKEN_SCHEME)
@RequirePermission(Permission.ADMIN_ACCESS)
@Controller('cycles')
export class CyclesController {
  constructor(@Inject(CyclesService) private readonly cycles: CyclesService) {}

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
    summary: 'Create a cycle',
    description:
      'The cycle starts as `draft`; activating it is a separate step. One cycle per year (2020 to 2100).',
  })
  @ApiOkEnvelope(CycleModel, {
    status: 201,
    headers: IDEMPOTENCY_REPLAYED_HEADERS,
  })
  @ApiErrorResponses(
    withIdempotencyErrors({
      ...ACCESS,
      400: ['VALIDATION_FAILED', 'MALFORMED_JSON'],
      409: ['CYCLES_YEAR_TAKEN'],
    }),
  )
  @Idempotent()
  @Post()
  async create(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
    @Body() dto: CreateCycleDto,
  ): Promise<CycleView> {
    const { cycleId } = await this.cycles.create(
      this.context(actor, request),
      dto,
    );
    return this.cycles.get(cycleId);
  }

  @ApiOperation({
    summary: 'List cycles',
    description:
      'Newest year first, each with its timeline count and the date range its timelines cover (null without timelines).',
  })
  @ApiOkEnvelope(listOf(CycleModel), { extraModels: [CycleModel] })
  @ApiErrorResponses(ACCESS)
  @Get()
  list(): Promise<CycleView[]> {
    return this.cycles.list();
  }

  @ApiOperation({
    summary: 'Activate a draft cycle',
    description:
      'The cycle becomes the active one and the previously active cycle, if any, becomes `closed`, in one operation. Only a `draft` cycle can be activated. When concurrent activations keep refusing this one, it answers 503 `SERVICE_UNAVAILABLE` and changes nothing: the request can be sent again.',
  })
  @ApiOkEnvelope(CycleModel)
  @ApiErrorResponses({
    ...ACCESS,
    400: ['VALIDATION_FAILED'],
    404: ['CYCLES_NOT_FOUND'],
    409: ['CYCLES_NOT_DRAFT'],
    503: ['SERVICE_UNAVAILABLE'],
  })
  @HttpCode(200)
  @Post(':id/activate')
  async activate(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
    @Param() { id }: CycleIdParams,
  ): Promise<CycleView> {
    const { cycleId } = await this.cycles.activate(
      this.context(actor, request),
      id,
    );
    return this.cycles.get(cycleId);
  }
}
