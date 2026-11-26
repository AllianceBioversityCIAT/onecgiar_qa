// @akili-spec assessment/ai-suggestions
import { ApiProperty } from '@nestjs/swagger';
import type { AiRequeueResult, AiRunStatus } from '../ai-enqueue.service.js';

/** FR-3: what a re-enqueue of a load's AI jobs did. */
export class AiRequeueModel implements AiRequeueResult {
  @ApiProperty({
    type: Number,
    example: 42,
    description:
      "Jobs the load's pending memberships need (the run's `expected`)",
  })
  expected!: number;

  @ApiProperty({ type: Number, example: 42 })
  sent!: number;

  @ApiProperty({
    type: Number,
    example: 0,
    description: 'Jobs SQS did not take after 3 tries',
  })
  failed!: number;
}

/** FR-3: the counters of a load's AI run, as the worker and the sync wrote them. */
export class AiRunStatusModel implements AiRunStatus {
  @ApiProperty({ type: String, example: 'load-7' })
  runId!: string;

  @ApiProperty({
    type: Number,
    example: 42,
    description: 'Jobs sent by the sync or the last re-enqueue',
  })
  expected!: number;

  @ApiProperty({
    type: Number,
    example: 30,
    description: 'Suggestions stored as available',
  })
  produced!: number;

  @ApiProperty({
    type: Number,
    example: 12,
    description: 'Suggestions stored as unavailable (with a reason)',
  })
  unavailable!: number;

  @ApiProperty({
    type: Number,
    example: 0,
    description:
      'Jobs that failed on their last delivery; a re-enqueue replaces them',
  })
  failed!: number;

  @ApiProperty({
    type: Boolean,
    example: true,
    description:
      '`produced + unavailable == expected` and `failed == 0`; false for a run nobody wrote',
  })
  complete!: boolean;
}
