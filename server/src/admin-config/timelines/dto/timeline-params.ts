import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import { UNSIGNED_INT_MAX } from '../../cycles/dto/cycle-params.js';

/** `:id` of `/timelines/:id`. A value that is not a positive integer is a 400 on `id`, never a lookup. */
export class TimelineIdParams {
  @ApiProperty({
    type: Number,
    minimum: 1,
    example: 4,
    description: 'Timeline id',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(UNSIGNED_INT_MAX)
  id!: number;
}

/** `:id` and `:assignmentId` of `/timelines/:id/users/:assignmentId`; either one that is not a positive integer is a 400. */
export class TimelineAssignmentParams extends TimelineIdParams {
  @ApiProperty({
    type: Number,
    minimum: 1,
    example: 12,
    description: 'Assignment id',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(UNSIGNED_INT_MAX)
  assignmentId!: number;
}
