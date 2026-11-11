// @akili-spec assessment/step-1-assessment
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import { UNSIGNED_INT_MAX } from '../../admin-config/cycles/dto/cycle-params.js';

/** `:timelineId` of `/timelines/:timelineId/…`. A value that is not a positive integer is a 400 on `timelineId`, never a lookup. */
export class WorklistTimelineParams {
  @ApiProperty({
    type: Number,
    minimum: 1,
    example: 4,
    description: 'Timeline id (one of `GET /worklist/timelines`)',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(UNSIGNED_INT_MAX)
  timelineId!: number;
}
