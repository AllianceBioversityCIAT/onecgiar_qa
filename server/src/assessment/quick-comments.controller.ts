// @akili-spec assessment/step-1-assessment
import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { ReadAccess } from '../auth/decorators/read-access.decorator.js';
import { ApiErrorResponses, ApiOkEnvelope } from '../common/api-response.js';
import { ACCESS_TOKEN_SCHEME } from '../common/openapi.js';
import { requestIdOf, type RequestWithId } from '../common/request-id.js';
import type { AuthenticatedUser } from '../users/current-user.cache.js';
import {
  CreateQuickCommentBody,
  QuickCommentsQuery,
} from './dto/quick-comment.dto.js';
import { QuickCommentModel } from './models/quick-comment.model.js';
import {
  QuickCommentsService,
  type QuickCommentView,
} from './quick-comments.service.js';

/**
 * The quick-comment routes (design 6, FR-12): a thin HTTP layer over
 * `QuickCommentsService`, which owns the role check. Reachable by every
 * authenticated user (`@ReadAccess()`); the service refuses a caller with no
 * live grant of the role asked for.
 */
@ApiTags('assessment')
@ApiBearerAuth(ACCESS_TOKEN_SCHEME)
@ReadAccess()
@Controller()
export class QuickCommentsController {
  constructor(
    @Inject(QuickCommentsService)
    private readonly quickComments: QuickCommentsService,
  ) {}

  @ApiOperation({
    summary: 'List the quick comments of a role',
    description:
      'The reusable comment texts saved for the role, newest first. Every user with a live grant of that role sees the same list; a user of another role, an ADMIN included, gets a 403.',
  })
  @ApiOkEnvelope(
    { type: 'array', items: { $ref: getSchemaPath(QuickCommentModel) } },
    { extraModels: [QuickCommentModel] },
  )
  @ApiErrorResponses({
    400: ['VALIDATION_FAILED'],
    401: ['AUTH_TOKEN_INVALID', 'AUTH_USER_NOT_ADMITTED'],
    403: ['AUTH_PERMISSION_DENIED'],
    503: ['SERVICE_UNAVAILABLE'],
  })
  @Get('quick-comments')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QuickCommentsQuery,
  ): Promise<QuickCommentView[]> {
    return this.quickComments.list(user, query.role);
  }

  @ApiOperation({
    summary: 'Save a quick comment for a role',
    description:
      'Saves a text of 1 to 2,000 characters (trimmed) for the role; every user of that role then sees it. The same text saved again (case-sensitive) keeps one entry: 201 when this call created it, 200 with the existing entry otherwise, and only the first writes an audit row.',
  })
  @ApiOkEnvelope(QuickCommentModel, {
    status: 201,
    description: 'Saved now',
  })
  @ApiOkEnvelope(QuickCommentModel, {
    description: 'Already saved: the existing entry, nothing written',
  })
  @ApiErrorResponses({
    400: ['VALIDATION_FAILED', 'MALFORMED_JSON'],
    401: ['AUTH_TOKEN_INVALID', 'AUTH_USER_NOT_ADMITTED'],
    403: ['AUTH_PERMISSION_DENIED'],
    413: ['PAYLOAD_TOO_LARGE'],
    503: ['SERVICE_UNAVAILABLE'],
  })
  @Post('quick-comments')
  async save(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: RequestWithId,
    @Res({ passthrough: true }) response: Response,
    @Body() body: CreateQuickCommentBody,
  ): Promise<QuickCommentView> {
    const { comment, created } = await this.quickComments.save(
      user,
      body.role,
      body.body,
      requestIdOf(request),
    );
    // A POST answers 201; a repeat is the same entry, not a new one.
    response.status(created ? 201 : 200);
    return comment;
  }
}
