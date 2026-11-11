// @akili-spec assessment/step-1-assessment
import { Controller, Get, HttpCode, Inject, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { RequirePermission } from '../auth/decorators/require-permission.decorator.js';
import { ApiErrorResponses, ApiOkEnvelope } from '../common/api-response.js';
import { ACCESS_TOKEN_SCHEME } from '../common/openapi.js';
import { Permission } from '../users/permissions.js';
import { ReleasesQuery } from './dto/release-query.dto.js';
import { ReleaseModel, ReleaseRetryModel } from './models/release.model.js';
import {
  ReleaseService,
  type ReleaseDispatchResult,
} from './release.service.js';

/** The most send batches one retry runs (one phase year each, at most 50 rows): the request answers in bounded time. */
export const RETRY_ROUNDS = 3;

/** One row of the list, as the API answers it. */
export interface ReleaseView {
  id: number;
  timeline: { id: number; name: string };
  resultCode: number;
  outcome: string;
  status: string;
  attempts: number;
  reason: string | null;
  createdAt: string;
}

/**
 * The release outbox for the admin (design 6, FR-18): the rows still pending or
 * refused, and a retry that sends the due ones now. `ADMIN_ACCESS` on the whole
 * class: the global `PermissionGuard` answers 403 to everyone else before any
 * handler runs.
 */
@ApiTags('assessment')
@ApiBearerAuth(ACCESS_TOKEN_SCHEME)
@RequirePermission(Permission.ADMIN_ACCESS)
@Controller('assessment-releases')
export class ReleasesController {
  constructor(
    @Inject(ReleaseService) private readonly releases: ReleaseService,
  ) {}

  @ApiOperation({
    summary: 'List the releases still pending or refused',
    description:
      'The outbox of the notices to Reporting, oldest first (at most 500): the timeline, the result code, the outcome, the attempts and the reason. Admin only.',
  })
  @ApiOkEnvelope(
    { type: 'array', items: { $ref: getSchemaPath(ReleaseModel) } },
    { extraModels: [ReleaseModel] },
  )
  @ApiErrorResponses({
    400: ['VALIDATION_FAILED'],
    401: ['AUTH_TOKEN_INVALID', 'AUTH_USER_NOT_ADMITTED'],
    403: ['AUTH_PERMISSION_DENIED'],
    503: ['SERVICE_UNAVAILABLE'],
  })
  @Get()
  async list(@Query() query: ReleasesQuery): Promise<ReleaseView[]> {
    const rows = await this.releases.list(query.status ?? 'pending');
    return rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  @ApiOperation({
    summary: 'Send the due releases now',
    description:
      'Claims every pending release whose lease has passed, sends it to Reporting and acknowledges it, in at most 3 batches of up to 50 (one phase year each); call again for the rest. Answers once the sweep is done: what was claimed, sent, refused and left pending. A row sent a moment ago by another dispatch is not sent twice. Admin only.',
  })
  @ApiOkEnvelope(ReleaseRetryModel)
  @ApiErrorResponses({
    401: ['AUTH_TOKEN_INVALID', 'AUTH_USER_NOT_ADMITTED'],
    403: ['AUTH_PERMISSION_DENIED'],
  })
  @HttpCode(200)
  @Post('retry')
  retry(): Promise<ReleaseDispatchResult> {
    return this.releases.dispatch({ maxRounds: RETRY_ROUNDS });
  }
}
