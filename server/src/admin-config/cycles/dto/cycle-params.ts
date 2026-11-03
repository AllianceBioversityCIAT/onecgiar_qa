import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

/** `int unsigned`, the type of every id in the cycles tables. */
export const UNSIGNED_INT_MAX = 4_294_967_295;

/** `:id` of `/cycles/:id/…`. A value that is not a positive integer is a 400 on `id`, never a lookup. */
export class CycleIdParams {
  @ApiProperty({
    type: Number,
    minimum: 1,
    example: 3,
    description: 'Cycle id',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(UNSIGNED_INT_MAX)
  id!: number;
}
