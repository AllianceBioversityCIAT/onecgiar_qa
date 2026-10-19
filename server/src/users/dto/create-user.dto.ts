import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  NAME_MAX_LENGTH,
  NICKNAME_MAX_LENGTH,
  REASON_MAX_LENGTH,
  UNSIGNED_INT_MAX,
} from '../users-admin.service.js';
import type { AccountType } from '../users-admin.service.js';
import {
  allOrListSchema,
  EmailProp,
  IsAllOrList,
  TextProp,
} from './user-fields.js';
import { IsNotEmpty } from 'class-validator';

/** One role as the API groups it: one entry per role (design 6). */
export class RoleGrantDto {
  @ApiProperty({
    type: String,
    example: 'ASSESSOR',
    description:
      'A grantable role: ADMIN, LEAD_ASSESSOR, ASSESSOR, TPB or PPU (see `GET /catalogs/roles`)',
  })
  @IsString()
  @IsNotEmpty()
  role!: string;

  @ApiPropertyOptional({
    description:
      'Result types of a result-type role: `all` or a non-empty list of keys. Global roles take none',
    example: ['innovation_development'],
    ...allOrListSchema('text'),
  })
  @IsOptional()
  @IsAllOrList('text')
  resultTypes?: 'all' | string[];
}

/** A program a user cannot assess, with the reason (FR-4). */
export class ExclusionDto {
  @ApiProperty({
    type: Number,
    minimum: 1,
    example: 3,
    description: 'CLARISA id',
  })
  @IsInt()
  @Min(1)
  @Max(UNSIGNED_INT_MAX)
  programId!: number;

  @TextProp(REASON_MAX_LENGTH, {
    description: 'Why the user is excluded (shown in the history)',
    example: 'Co-authored the results of this program',
  })
  reason!: string;
}

/** `POST /users` (FR-2). */
export class CreateUserDto {
  @EmailProp()
  email!: string;

  @TextProp(NAME_MAX_LENGTH, { description: 'Given name', example: 'Ada' })
  firstName!: string;

  @TextProp(NAME_MAX_LENGTH, {
    description: 'Family name',
    example: 'Lovelace',
  })
  lastName!: string;

  @TextProp(NICKNAME_MAX_LENGTH, {
    description: 'Unique, whatever the case; what other users see',
    example: 'Ada',
  })
  nickname!: string;

  @ApiProperty({
    type: String,
    enum: ['sso', 'custom'],
    description:
      '`custom` creates the Cognito account and sends the invitation; `sso` is linked at first sign-in',
  })
  @IsIn(['sso', 'custom'])
  accountType!: AccountType;

  @ApiPropertyOptional({ type: [RoleGrantDto], description: 'Default: none' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoleGrantDto)
  roles?: RoleGrantDto[];

  @ApiPropertyOptional({
    description:
      'Programs the user may assess: `all` (default) or a non-empty list of CLARISA ids',
    example: [1, 2],
    ...allOrListSchema('id'),
  })
  @IsOptional()
  @IsAllOrList('id')
  programs?: 'all' | number[];

  @ApiPropertyOptional({
    type: [ExclusionDto],
    description: 'One per program; a program listed twice is a 400',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExclusionDto)
  exclusions?: ExclusionDto[];
}
