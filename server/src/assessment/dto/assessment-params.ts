// @akili-spec assessment/step-1-assessment
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { UNSIGNED_INT_MAX } from '../../admin-config/cycles/dto/cycle-params.js';

/** `/timelines/:timelineId/results/:resultCode/…`: a value that is not a positive integer is a 400 on its field, never a lookup. */
export class AssessmentParams {
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

  @ApiProperty({
    type: Number,
    minimum: 1,
    example: 4021,
    description: 'Result code (`resultCode` of a worklist row)',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(UNSIGNED_INT_MAX)
  resultCode!: number;
}

/** `/assessment-comments/:commentId/…`: a value that is not a positive integer is a 400 on its field, never a lookup. */
export class CommentParams {
  @ApiProperty({
    type: Number,
    minimum: 1,
    example: 12,
    description: 'Comment id (`id` of a comment of the assessment view)',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  commentId!: number;
}

/** `GET …/assessment` (design 6). Anything not listed is a 400 `UNKNOWN_FIELD`. */
export class AssessmentViewQuery {
  @ApiPropertyOptional({
    type: Number,
    enum: [1, 2],
    description:
      'ADMIN only: the round of the membership to read. Default: the latest round. Ignored for a reviewer, whose own row decides',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2)
  round?: number;
}
