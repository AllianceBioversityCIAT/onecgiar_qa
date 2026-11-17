// @akili-spec assessment/step-1-assessment
import { ApiProperty } from '@nestjs/swagger';

class ReleaseTimelineModel {
  @ApiProperty({ type: Number, example: 3 })
  id!: number;

  @ApiProperty({ type: String, example: 'Official 2026' })
  name!: string;
}

/** The OpenAPI model of one outbox row (design 6, FR-18): ids, words and counts only. */
export class ReleaseModel {
  @ApiProperty({ type: Number, example: 41 })
  id!: number;

  @ApiProperty({ type: () => ReleaseTimelineModel })
  timeline!: ReleaseTimelineModel;

  @ApiProperty({ type: Number, example: 5001 })
  resultCode!: number;

  @ApiProperty({ type: String, enum: ['qaed', 'not_qaed'], example: 'qaed' })
  outcome!: string;

  @ApiProperty({
    type: String,
    enum: ['pending', 'sent', 'refused'],
    example: 'pending',
  })
  status!: string;

  @ApiProperty({
    type: Number,
    example: 2,
    description: 'How many times a dispatch claimed the row',
  })
  attempts!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'not_submitted',
    description:
      "Reporting's reason: set on a refused row (`not_found`, `other_phase`, `not_submitted`), null otherwise",
  })
  reason!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}

/** The answer of `POST /assessment-releases/retry` (design 6): what the sweep did. */
export class ReleaseRetryModel {
  @ApiProperty({ type: Number, example: 3, description: 'Rows claimed' })
  attempted!: number;

  @ApiProperty({
    type: Number,
    example: 2,
    description: 'Acknowledged: released, or already out of QA (`not_in_qa`)',
  })
  sent!: number;

  @ApiProperty({
    type: Number,
    example: 0,
    description: 'Turned down by Reporting',
  })
  refused!: number;

  @ApiProperty({
    type: Number,
    example: 1,
    description: 'Claimed but not acknowledged: still pending',
  })
  stillPending!: number;
}
