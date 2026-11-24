import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  MAX_LIST_LIMIT,
  type UserPopulation,
  type UserStatusFilter,
} from '../users-query.repository.js';
import { UNSIGNED_INT_MAX } from '../users-admin.service.js';

const toBoolean = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

/** `GET /users` (FR-9). Anything not listed here is a 400 `UNKNOWN_FIELD`. */
export class ListUsersQuery {
  @ApiPropertyOptional({
    type: String,
    maxLength: 200,
    description: 'Matches email, nickname, first or last name (contains)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200, { context: { max: 200 } })
  q?: string;

  @ApiPropertyOptional({ type: String, example: 'ASSESSOR' })
  @IsOptional()
  @IsString()
  @MaxLength(64, { context: { max: 64 } })
  role?: string;

  @ApiPropertyOptional({
    type: String,
    example: 'innovation_development',
    description: 'A grant of this result type, or of all result types',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255, { context: { max: 255 } })
  resultType?: string;

  @ApiPropertyOptional({
    type: Number,
    minimum: 1,
    description: 'CLARISA id; users with no program restriction match too',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(UNSIGNED_INT_MAX)
  programId?: number;

  @ApiPropertyOptional({
    type: String,
    enum: ['active', 'inactive', 'all'],
    default: 'active',
  })
  @IsOptional()
  @IsIn(['active', 'inactive', 'all'])
  status?: UserStatusFilter;

  @ApiPropertyOptional({
    type: String,
    enum: ['team', 'guests', 'all'],
    default: 'team',
    description:
      'Team = has a role or was created by an admin; guests = neither',
  })
  @IsOptional()
  @IsIn(['team', 'guests', 'all'])
  population?: UserPopulation;

  @ApiPropertyOptional({
    type: Boolean,
    description:
      'Only users with (true) or without (false) an active exclusion',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  hasExclusions?: boolean;

  @ApiPropertyOptional({
    type: String,
    maxLength: 512,
    description: '`meta.page.nextCursor` of the previous page',
  })
  @IsOptional()
  @IsString()
  @MaxLength(512, { context: { max: 512 } })
  cursor?: string;

  @ApiPropertyOptional({
    type: Number,
    minimum: 1,
    maximum: MAX_LIST_LIMIT,
    default: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LIST_LIMIT)
  limit?: number;
}
