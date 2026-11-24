// @akili-spec ingestion/step-1-loads
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import { UNSIGNED_INT_MAX } from '../../admin-config/cycles/dto/cycle-params.js';
import { TimelineIdParams } from '../../admin-config/timelines/dto/timeline-params.js';

/** `:id` and `:loadId` of `/timelines/:id/loads/:loadId`; either one that is not a positive integer is a 400, never a lookup. */
export class LoadParams extends TimelineIdParams {
  @ApiProperty({
    type: Number,
    minimum: 1,
    example: 7,
    description: 'Load id',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(UNSIGNED_INT_MAX)
  loadId!: number;
}
