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
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { RequirePermission } from '../auth/decorators/require-permission.decorator.js';
import {
  ApiErrorResponses,
  ApiOkEnvelope,
  Paged,
} from '../common/api-response.js';
import type { ErrorCode } from '../common/error-codes.js';
import { ACCESS_TOKEN_SCHEME } from '../common/openapi.js';
import { requestIdOf, type RequestWithId } from '../common/request-id.js';
import type { AuthenticatedUser } from './current-user.cache.js';
import { CreateUserDto, ExclusionDto } from './dto/create-user.dto.js';
import { EditUserDto } from './dto/edit-user.dto.js';
import { ListUsersQuery } from './dto/list-users.query.js';
import { ExclusionParams, UserIdParams } from './dto/user-params.js';
import {
  DismissExclusionDto,
  ReplaceProgramsDto,
  ReplaceRolesDto,
} from './dto/user-scope.dtos.js';
import { UserDetailModel, UserSummaryModel } from './dto/user.models.js';
import { Permission } from './permissions.js';
import { UsersAdminService, type AdminContext } from './users-admin.service.js';
import {
  UsersQueryRepository,
  type UserDetail,
  type UserSummary,
} from './users-query.repository.js';
import { UserNotFoundError } from './users.errors.js';

// Codes shared by every route: the guard answers before anything else, so a
// non-admin gets the same 403 whether the target exists or not (FR-1).
const ACCESS: Record<401 | 403, ErrorCode[]> = {
  401: ['AUTH_TOKEN_INVALID', 'AUTH_USER_NOT_ADMITTED'],
  403: ['AUTH_PERMISSION_DENIED'],
};
const BAD_PARAMS: ErrorCode[] = ['VALIDATION_FAILED'];
const BAD_BODY: ErrorCode[] = ['VALIDATION_FAILED', 'MALFORMED_JSON'];
const NOT_FOUND: ErrorCode[] = ['USERS_NOT_FOUND'];
/** Cognito (create, invitation) or the catalog behind a role, program or exclusion reference. */
const UNAVAILABLE: ErrorCode[] = [
  'AUTH_SERVICE_UNAVAILABLE',
  'SERVICE_UNAVAILABLE',
];
const CATALOG_UNAVAILABLE: ErrorCode[] = ['SERVICE_UNAVAILABLE'];

const listOf = (model: new () => unknown) => ({
  type: 'array',
  items: { $ref: getSchemaPath(model) },
});

/**
 * The admin API of users (design 6; FR-2…FR-5, FR-7…FR-10). `ADMIN_ACCESS`
 * on the whole class: the global `PermissionGuard` refuses everyone else
 * before any handler, pipe or lookup runs, so no answer depends on the target.
 * Every mutation answers the user's `UserDetail`, read after the commit.
 */
@ApiTags('users')
@ApiBearerAuth(ACCESS_TOKEN_SCHEME)
@RequirePermission(Permission.ADMIN_ACCESS)
@Controller('users')
export class UsersAdminController {
  constructor(
    @Inject(UsersAdminService) private readonly admin: UsersAdminService,
    @Inject(UsersQueryRepository)
    private readonly queries: UsersQueryRepository,
  ) {}

  private context(
    actor: AuthenticatedUser,
    request: RequestWithId,
  ): AdminContext {
    return { actorId: actor.id, requestId: requestIdOf(request) };
  }

  private async detail(id: number): Promise<UserDetail> {
    const detail = await this.queries.get(id);
    if (!detail) throw new UserNotFoundError(id);
    return detail;
  }

  @ApiOperation({
    summary: 'List users',
    description:
      'Filters combine with AND. Sorted by nickname (users without one last), then id; page with `meta.page.nextCursor`.',
  })
  @ApiOkEnvelope(listOf(UserSummaryModel), {
    extraModels: [UserSummaryModel],
    paged: true,
  })
  @ApiErrorResponses({ ...ACCESS, 400: BAD_PARAMS })
  @Get()
  async list(@Query() query: ListUsersQuery): Promise<Paged<UserSummary>> {
    const page = await this.queries.list(query);
    return new Paged(page.items, page.nextCursor);
  }

  @ApiOperation({
    summary: 'One user, with the history of their exclusions',
  })
  @ApiOkEnvelope(UserDetailModel)
  @ApiErrorResponses({ ...ACCESS, 400: BAD_PARAMS, 404: NOT_FOUND })
  @Get(':id')
  get(@Param() { id }: UserIdParams): Promise<UserDetail> {
    return this.detail(id);
  }

  @ApiOperation({
    summary: 'Create a user',
    description:
      'A `custom` user also gets a Cognito account and an invitation email (`invitation: sent`, or `existing_account` when the email already had one). An `sso` user is linked at the first sign-in.',
  })
  @ApiOkEnvelope(UserDetailModel, { status: 201 })
  @ApiErrorResponses({
    ...ACCESS,
    400: BAD_BODY,
    409: ['USERS_EMAIL_TAKEN', 'USERS_NICKNAME_TAKEN', 'USERS_ROLE_CONFLICT'],
    503: UNAVAILABLE,
  })
  @Post()
  async create(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
    @Body() dto: CreateUserDto,
  ): Promise<UserDetail> {
    const { userId } = await this.admin.create(
      this.context(actor, request),
      dto,
    );
    return this.detail(userId);
  }

  @ApiOperation({
    summary: 'Edit nickname and name',
    description:
      'The email never changes. First and last name can be edited only until the user signs in for the first time.',
  })
  @ApiOkEnvelope(UserDetailModel)
  @ApiErrorResponses({
    ...ACCESS,
    400: BAD_BODY,
    404: NOT_FOUND,
    409: ['USERS_NICKNAME_TAKEN', 'USERS_NAME_LOCKED'],
  })
  @Patch(':id')
  async edit(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
    @Param() { id }: UserIdParams,
    @Body() dto: EditUserDto,
  ): Promise<UserDetail> {
    await this.admin.edit(this.context(actor, request), id, dto);
    return this.detail(id);
  }

  @ApiOperation({
    summary: 'Replace the roles of a user',
    description:
      'The list is the whole truth: roles not listed are revoked, new ones granted, unchanged ones untouched. ADMIN cannot be removed from the last active admin.',
  })
  @ApiOkEnvelope(UserDetailModel)
  @ApiErrorResponses({
    ...ACCESS,
    400: BAD_BODY,
    404: NOT_FOUND,
    409: ['USERS_ROLE_CONFLICT', 'USERS_LAST_ADMIN'],
    503: CATALOG_UNAVAILABLE,
  })
  @Put(':id/roles')
  async replaceRoles(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
    @Param() { id }: UserIdParams,
    @Body() dto: ReplaceRolesDto,
  ): Promise<UserDetail> {
    await this.admin.replaceRoles(this.context(actor, request), id, dto.roles);
    return this.detail(id);
  }

  @ApiOperation({
    summary: 'Replace the program scope of a user',
    description:
      '`all` removes the restriction (including future programs); a list restricts the user to those programs. An empty list is refused.',
  })
  @ApiOkEnvelope(UserDetailModel)
  @ApiErrorResponses({
    ...ACCESS,
    400: BAD_BODY,
    404: NOT_FOUND,
    503: CATALOG_UNAVAILABLE,
  })
  @Put(':id/programs')
  async replacePrograms(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
    @Param() { id }: UserIdParams,
    @Body() dto: ReplaceProgramsDto,
  ): Promise<UserDetail> {
    await this.admin.replacePrograms(
      this.context(actor, request),
      id,
      dto.programs,
    );
    return this.detail(id);
  }

  @ApiOperation({
    summary: 'Exclude a user from a program (conflict of interest)',
  })
  @ApiOkEnvelope(UserDetailModel, { status: 201 })
  @ApiErrorResponses({
    ...ACCESS,
    400: BAD_BODY,
    404: NOT_FOUND,
    409: ['USERS_EXCLUSION_EXISTS'],
    503: CATALOG_UNAVAILABLE,
  })
  @Post(':id/exclusions')
  async addExclusion(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
    @Param() { id }: UserIdParams,
    @Body() dto: ExclusionDto,
  ): Promise<UserDetail> {
    await this.admin.addExclusion(this.context(actor, request), id, dto);
    return this.detail(id);
  }

  @ApiOperation({
    summary: 'Remove a manual exclusion',
    description:
      'Only exclusions added by an administrator; the row moves to the history.',
  })
  @ApiOkEnvelope(UserDetailModel)
  @ApiErrorResponses({
    ...ACCESS,
    400: BAD_PARAMS,
    404: [...NOT_FOUND, 'USERS_EXCLUSION_NOT_FOUND'],
    409: ['USERS_EXCLUSION_NOT_MANUAL'],
  })
  @Delete(':id/exclusions/:exclusionId')
  async removeExclusion(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
    @Param() { id, exclusionId }: ExclusionParams,
  ): Promise<UserDetail> {
    await this.admin.removeExclusion(
      this.context(actor, request),
      id,
      exclusionId,
    );
    return this.detail(id);
  }

  @ApiOperation({
    summary: 'Dismiss an exclusion that comes from Reporting',
    description:
      'Only Reporting exclusions, with a reason; the row moves to the history.',
  })
  @ApiOkEnvelope(UserDetailModel)
  @ApiErrorResponses({
    ...ACCESS,
    400: BAD_BODY,
    404: [...NOT_FOUND, 'USERS_EXCLUSION_NOT_FOUND'],
    409: ['USERS_EXCLUSION_NOT_REPORTING'],
  })
  @HttpCode(200)
  @Post(':id/exclusions/:exclusionId/dismiss')
  async dismissExclusion(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
    @Param() { id, exclusionId }: ExclusionParams,
    @Body() dto: DismissExclusionDto,
  ): Promise<UserDetail> {
    await this.admin.dismissExclusion(
      this.context(actor, request),
      id,
      exclusionId,
      dto.reason,
    );
    return this.detail(id);
  }

  @ApiOperation({
    summary: 'Deactivate a user ("Remove from team")',
    description:
      'The user can no longer sign in or use the API. Refused for the last active admin.',
  })
  @ApiOkEnvelope(UserDetailModel)
  @ApiErrorResponses({
    ...ACCESS,
    400: BAD_PARAMS,
    404: NOT_FOUND,
    409: ['USERS_LAST_ADMIN'],
  })
  @HttpCode(200)
  @Post(':id/deactivate')
  async deactivate(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
    @Param() { id }: UserIdParams,
  ): Promise<UserDetail> {
    await this.admin.deactivate(this.context(actor, request), id);
    return this.detail(id);
  }

  @ApiOperation({ summary: 'Reactivate a user' })
  @ApiOkEnvelope(UserDetailModel)
  @ApiErrorResponses({
    ...ACCESS,
    400: BAD_PARAMS,
    404: NOT_FOUND,
  })
  @HttpCode(200)
  @Post(':id/activate')
  async activate(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
    @Param() { id }: UserIdParams,
  ): Promise<UserDetail> {
    await this.admin.activate(this.context(actor, request), id);
    return this.detail(id);
  }

  @ApiOperation({
    summary: 'Resend the invitation',
    description:
      'Only for an active custom-account user, invited by QA, who has not signed in yet.',
  })
  @ApiOkEnvelope(UserDetailModel)
  @ApiErrorResponses({
    ...ACCESS,
    400: BAD_PARAMS,
    404: NOT_FOUND,
    409: ['USERS_INVITATION_NOT_APPLICABLE'],
    503: ['AUTH_SERVICE_UNAVAILABLE'],
  })
  @HttpCode(200)
  @Post(':id/invitation')
  async resendInvitation(
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: RequestWithId,
    @Param() { id }: UserIdParams,
  ): Promise<UserDetail> {
    await this.admin.resendInvitation(this.context(actor, request), id);
    return this.detail(id);
  }
}
