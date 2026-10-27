// @akili-spec admin-config/field-configuration
import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
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
import { PublishFieldConfigDto } from './dto/publish-field-config.dto.js';
import { UpdateFieldConfigDraftDto } from './dto/update-field-config-draft.dto.js';
import {
  FieldConfigService,
  type FieldConfigPreview,
  type FieldConfigView,
  type PublishResult,
} from './field-config.service.js';
import {
  FieldConfigPreviewModel,
  FieldConfigViewModel,
  PublishResultModel,
} from './models/field-config.model.js';

// Codes shared by every route: the guard answers before anything else, so a
// non-admin gets the same 403 whatever the cycle (FR-1, NFR-1).
const ACCESS: Record<401 | 403, ErrorCode[]> = {
  401: ['AUTH_TOKEN_INVALID', 'AUTH_USER_NOT_ADMITTED'],
  403: ['AUTH_PERMISSION_DENIED'],
};

/**
 * The field configuration API of a cycle (design 6; FR-1, FR-8, FR-13, NFR-1,
 * NFR-2). `ADMIN_ACCESS` on the whole class: the global `PermissionGuard`
 * refuses everyone else before any handler, pipe or lookup runs. The reads work
 * in any cycle status. The draft edit and the discard are repeatable by nature;
 * only the publish is idempotent per `Idempotency-Key` (DD-9).
 */
@ApiTags('field-config')
@ApiBearerAuth(ACCESS_TOKEN_SCHEME)
@RequirePermission(Permission.ADMIN_ACCESS)
@Controller('cycles')
export class FieldConfigController {
  constructor(
    @Inject(FieldConfigService)
    private readonly fieldConfig: FieldConfigService,
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
    summary: 'Read the field configuration of a cycle',
    description:
      'Every field of the Reporting catalog of the cycle year, grouped by result type and section, each with its draft option set and the one in the latest published version. Works in any cycle status and writes nothing. `revision` is the draft revision to send back when publishing.',
  })
  @ApiOkEnvelope(FieldConfigViewModel)
  @ApiErrorResponses({
    ...ACCESS,
    400: ['VALIDATION_FAILED'],
    404: ['CYCLES_NOT_FOUND'],
    409: ['FIELD_CONFIG_CATALOG_MISSING'],
    503: ['SERVICE_UNAVAILABLE'],
  })
  @Get(':id/field-config')
  view(@Param() { id }: CycleIdParams): Promise<FieldConfigView> {
    return this.fieldConfig.view(id);
  }

  @ApiOperation({
    summary: 'Edit the draft field configuration',
    description:
      'Sets the option set of each listed field in the draft (1 to 2,000 items); a field not listed keeps what the draft has, and a later item for the same field is refused. A flag left out is stored false, and `isCore` or `isAiInput` true needs `visibility` `assessed`. Every rule problem is listed in one 400 and nothing is written when there is one. Allowed in a `draft` or `active` cycle. Answers with the view as stored.',
  })
  @ApiOkEnvelope(FieldConfigViewModel)
  @ApiErrorResponses({
    ...ACCESS,
    400: ['VALIDATION_FAILED', 'MALFORMED_JSON'],
    404: ['CYCLES_NOT_FOUND'],
    409: ['CYCLES_CLOSED', 'FIELD_CONFIG_CATALOG_MISSING'],
    413: ['PAYLOAD_TOO_LARGE'],
    503: ['SERVICE_UNAVAILABLE'],
  })
  @Patch(':id/field-config/draft')
  updateDraft(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
    @Param() { id }: CycleIdParams,
    @Body() dto: UpdateFieldConfigDraftDto,
  ): Promise<FieldConfigView> {
    return this.fieldConfig.updateDraft(
      this.context(actor, request),
      id,
      dto.items,
    );
  }

  @ApiOperation({
    summary: 'Discard the draft field configuration',
    description:
      'Resets the draft to the latest published version (to nothing classified when none exists). Allowed in a `draft` or `active` cycle. Answers with the view as stored.',
  })
  @ApiOkEnvelope(FieldConfigViewModel)
  @ApiErrorResponses({
    ...ACCESS,
    400: ['VALIDATION_FAILED'],
    404: ['CYCLES_NOT_FOUND'],
    409: ['CYCLES_CLOSED', 'FIELD_CONFIG_CATALOG_MISSING'],
    503: ['SERVICE_UNAVAILABLE'],
  })
  @Delete(':id/field-config/draft')
  discardDraft(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
    @Param() { id }: CycleIdParams,
  ): Promise<FieldConfigView> {
    return this.fieldConfig.discardDraft(this.context(actor, request), id);
  }

  @ApiOperation({
    summary: 'Preview the publication of the draft',
    description:
      'The changes the draft holds against the latest published version, and which timelines would receive the new version and which keep theirs. Works in any cycle status and writes nothing. Send `revision` back to publish exactly what was reviewed.',
  })
  @ApiOkEnvelope(FieldConfigPreviewModel)
  @ApiErrorResponses({
    ...ACCESS,
    400: ['VALIDATION_FAILED'],
    404: ['CYCLES_NOT_FOUND'],
    409: ['FIELD_CONFIG_CATALOG_MISSING'],
    503: ['SERVICE_UNAVAILABLE'],
  })
  @Get(':id/field-config/publish-preview')
  preview(@Param() { id }: CycleIdParams): Promise<FieldConfigPreview> {
    return this.fieldConfig.preview(id);
  }

  @ApiOperation({
    summary: 'Publish the draft as a new version',
    description:
      'Publishes the draft the admin reviewed as a new immutable version. `revision` must be the one the admin read; otherwise 409 `FIELD_CONFIG_REVISION_STALE` and nothing is written. A draft with no change against the latest version is 409 `FIELD_CONFIG_NOTHING_TO_PUBLISH`. Allowed in a `draft` or `active` cycle. Idempotent per `Idempotency-Key`: a repeat answers the same publication, with the receive and keep lists as recorded. One audit row per publication.',
  })
  @ApiOkEnvelope(PublishResultModel, {
    status: 201,
    headers: IDEMPOTENCY_REPLAYED_HEADERS,
  })
  @ApiErrorResponses(
    withIdempotencyErrors({
      ...ACCESS,
      400: ['VALIDATION_FAILED', 'MALFORMED_JSON'],
      404: ['CYCLES_NOT_FOUND'],
      409: [
        'CYCLES_CLOSED',
        'FIELD_CONFIG_REVISION_STALE',
        'FIELD_CONFIG_NOTHING_TO_PUBLISH',
        'FIELD_CONFIG_CATALOG_MISSING',
      ],
      503: ['SERVICE_UNAVAILABLE'],
    }),
  )
  @Idempotent()
  @Post(':id/field-config/publish')
  publish(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
    @Param() { id }: CycleIdParams,
    @Body() dto: PublishFieldConfigDto,
  ): Promise<PublishResult> {
    return this.fieldConfig.publish(
      this.context(actor, request),
      id,
      dto.revision,
    );
  }
}
