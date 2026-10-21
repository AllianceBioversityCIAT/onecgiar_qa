import { ApiProperty } from '@nestjs/swagger';
import { IsInt } from 'class-validator';

/** FR-1: a cycle's year is 2020 to 2100 (`chk_cycles_year`). */
export const CYCLE_YEAR_MIN = 2020;
export const CYCLE_YEAR_MAX = 2100;

/**
 * Body of `POST /cycles`. The pipe judges the shape (a missing or non-integer
 * year, unknown fields); the range is a service rule so it answers
 * `OUT_OF_RANGE` instead of the pipe's generic `INVALID` (design 7.2, 7.5).
 */
export class CreateCycleDto {
  @ApiProperty({
    type: Number,
    minimum: CYCLE_YEAR_MIN,
    maximum: CYCLE_YEAR_MAX,
    example: 2027,
    description: 'Calendar year of the cycle; one cycle per year',
  })
  @IsInt()
  year!: number;
}
