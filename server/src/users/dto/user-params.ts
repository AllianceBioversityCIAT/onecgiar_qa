import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import { UNSIGNED_INT_MAX } from '../users-admin.service.js';

/** `:id` of `/users/:id…`. A value that is not a positive integer is a 400 on `id`, never a lookup. */
export class UserIdParams {
  @ApiProperty({
    type: Number,
    minimum: 1,
    example: 12,
    description: 'User id',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(UNSIGNED_INT_MAX)
  id!: number;
}

export class ExclusionParams extends UserIdParams {
  @ApiProperty({
    type: Number,
    minimum: 1,
    example: 7,
    description: 'Exclusion id (from `exclusions` of the user)',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(UNSIGNED_INT_MAX)
  exclusionId!: number;
}
