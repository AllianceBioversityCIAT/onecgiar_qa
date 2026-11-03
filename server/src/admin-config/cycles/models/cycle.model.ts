import { ApiProperty } from '@nestjs/swagger';
import {
  cycleStatuses,
  type CycleStatus,
} from '../../../database/drizzle/schema/cycles.js';
import type { CycleView } from '../cycle-view.js';

/** OpenAPI model of a cycle (design 6, `Cycle`). Dates are Rome calendar days; `createdAt` is an ISO instant. */
export class CycleModel implements CycleView {
  @ApiProperty({ type: Number, example: 3 })
  id!: number;

  @ApiProperty({ type: Number, example: 2027 })
  year!: number;

  @ApiProperty({ type: String, example: '2027 cycle' })
  name!: string;

  @ApiProperty({ type: String, enum: cycleStatuses, example: 'draft' })
  status!: CycleStatus;

  @ApiProperty({ type: Number, example: 2 })
  timelineCount!: number;

  @ApiProperty({
    type: String,
    format: 'date',
    nullable: true,
    example: '2027-07-06',
    description:
      'Earliest step opening of its timelines (Rome date), null without timelines',
  })
  startsOn!: string | null;

  @ApiProperty({
    type: String,
    format: 'date',
    nullable: true,
    example: '2027-11-20',
    description:
      'Latest step closing of its timelines (Rome date), null without timelines',
  })
  endsOn!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}
