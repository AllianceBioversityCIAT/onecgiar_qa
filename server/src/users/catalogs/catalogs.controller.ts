import { Controller, Get, Inject, type Type } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator.js';
import { getSchemaPath } from '@nestjs/swagger';
import { ApiErrorResponses, ApiOkEnvelope } from '../../common/api-response.js';
import { ACCESS_TOKEN_SCHEME } from '../../common/openapi.js';
import { Permission } from '../permissions.js';
import { CatalogService } from './catalog.service.js';
import type {
  GrantableRoleOption,
  ResultTypeOption,
  ScienceProgramOption,
} from './catalogs.ports.js';

const listOf = (model: Type<unknown>) => ({
  type: 'array',
  items: { $ref: getSchemaPath(model) },
});

export class GrantableRoleModel implements GrantableRoleOption {
  @ApiProperty({ type: String, example: 'LEAD_ASSESSOR' })
  code!: string;

  @ApiProperty({ type: String, example: 'Lead assessor' })
  name!: string;

  @ApiProperty({
    type: String,
    enum: ['global', 'result_type'],
    example: 'result_type',
  })
  scopeType!: 'global' | 'result_type' | 'program';
}

export class ResultTypeModel implements ResultTypeOption {
  @ApiProperty({ type: String, example: 'innovation_development' })
  key!: string;

  @ApiProperty({ type: String, example: 'Innovation development' })
  name!: string;
}

export class ScienceProgramModel implements ScienceProgramOption {
  @ApiProperty({
    type: Number,
    description: 'CLARISA id (canonical)',
    example: 1,
  })
  id!: number;

  @ApiProperty({ type: String, example: 'INIT-01' })
  code!: string;

  @ApiProperty({ type: String, example: 'Accelerated Breeding' })
  name!: string;
}

/** FR-11: the lists the user-management forms read. ADMIN only (FR-1). */
@ApiTags('catalogs')
@ApiBearerAuth(ACCESS_TOKEN_SCHEME)
@RequirePermission(Permission.ADMIN_ACCESS)
@Controller('catalogs')
export class CatalogsController {
  constructor(
    @Inject(CatalogService) private readonly catalogs: CatalogService,
  ) {}

  @ApiOperation({
    summary: 'Roles an admin can grant',
    description:
      'ADMIN, ASSESSOR, LEAD_ASSESSOR, TPB and PPU. PROGRAM is not grantable.',
  })
  @ApiOkEnvelope(listOf(GrantableRoleModel), {
    extraModels: [GrantableRoleModel],
  })
  @ApiErrorResponses({
    401: ['AUTH_TOKEN_INVALID'],
    403: ['AUTH_PERMISSION_DENIED'],
  })
  @Get('roles')
  roles(): GrantableRoleOption[] {
    return this.catalogs.grantableRoles();
  }

  @ApiOperation({
    summary: 'Result types (key and display name)',
    description:
      'From the Reporting catalog, cached 1 h; a copy up to 24 h old is served when Reporting is down.',
  })
  @ApiOkEnvelope(listOf(ResultTypeModel), { extraModels: [ResultTypeModel] })
  @ApiErrorResponses({
    401: ['AUTH_TOKEN_INVALID'],
    403: ['AUTH_PERMISSION_DENIED'],
    503: ['SERVICE_UNAVAILABLE'],
  })
  @Get('result-types')
  resultTypes(): Promise<ResultTypeOption[]> {
    return this.catalogs.listResultTypes();
  }

  @ApiOperation({
    summary: 'Science Programs (CLARISA id, code and name)',
    description:
      'From CLARISA, cached 1 h; a copy up to 24 h old is served when CLARISA is down.',
  })
  @ApiOkEnvelope(listOf(ScienceProgramModel), {
    extraModels: [ScienceProgramModel],
  })
  @ApiErrorResponses({
    401: ['AUTH_TOKEN_INVALID'],
    403: ['AUTH_PERMISSION_DENIED'],
    503: ['SERVICE_UNAVAILABLE'],
  })
  @Get('science-programs')
  sciencePrograms(): Promise<ScienceProgramOption[]> {
    return this.catalogs.listSciencePrograms();
  }
}
