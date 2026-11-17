// @akili-spec assessment/step-1-assessment
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

export const RELEASE_LIST_STATUSES = ['pending', 'refused'] as const;

/** `GET /assessment-releases?status=` (design 6): which rows of the outbox to list; `pending` when absent. */
export class ReleasesQuery {
  @ApiPropertyOptional({
    type: String,
    enum: RELEASE_LIST_STATUSES,
    default: 'pending',
    example: 'refused',
    description:
      '`pending`: not acknowledged by Reporting yet (including rows leased right now). `refused`: Reporting turned the release down; the membership stays active',
  })
  @IsOptional()
  @IsIn(RELEASE_LIST_STATUSES)
  status?: (typeof RELEASE_LIST_STATUSES)[number];
}
