import { ApiProperty } from '@nestjs/swagger';
import {
  stepAudiences,
  type StepAudience,
} from '../../../database/drizzle/schema/timeline-steps.js';
import {
  timelineKinds,
  type TimelineKind,
} from '../../../database/drizzle/schema/timelines.js';
import type { DefaultStep } from '../default-steps.js';
import {
  ASSIGNABLE_ROLES,
  type AssignableRole,
  type TimelineDetailResponse,
  type TimelineResponse,
  type TimelineStepResponse,
  type TimelineUserResponse,
} from '../timeline-response.js';
import type { TimelineStatus } from '../timeline-view.js';

/** OpenAPI model of a default step (design 6, `DefaultStep`; FR-4). */
export class DefaultStepModel implements DefaultStep {
  @ApiProperty({ type: Number, example: 1 })
  position!: number;

  @ApiProperty({ type: String, example: 'QA Platform open for assessors' })
  name!: string;

  @ApiProperty({ type: String, enum: stepAudiences, example: 'assessors' })
  audience!: StepAudience;

  @ApiProperty({ type: Number, example: 1 })
  round!: number;

  @ApiProperty({ type: Boolean, example: true })
  requiresLoad!: boolean;
}

/** OpenAPI model of a step of a timeline: as created, plus its position. */
export class TimelineStepModel implements TimelineStepResponse {
  @ApiProperty({ type: Number, example: 1 })
  position!: number;

  @ApiProperty({ type: String, example: 'QA Platform open for assessors' })
  name!: string;

  @ApiProperty({ type: String, enum: stepAudiences, example: 'assessors' })
  audience!: StepAudience;

  @ApiProperty({
    type: String,
    format: 'date',
    example: '2026-11-02',
    description: 'Rome calendar day',
  })
  opensOn!: string;

  @ApiProperty({
    type: String,
    format: 'date',
    example: '2026-11-06',
    description: 'Rome calendar day',
  })
  closesOn!: string;

  @ApiProperty({ type: Number, example: 1 })
  round!: number;

  @ApiProperty({ type: Boolean, example: true })
  requiresLoad!: boolean;
}

/** Active assignments per assignable role. */
export class AssignedCountModel implements Record<AssignableRole, number> {
  @ApiProperty({ type: Number, example: 0 })
  ASSESSOR!: number;

  @ApiProperty({ type: Number, example: 0 })
  LEAD_ASSESSOR!: number;

  @ApiProperty({ type: Number, example: 0 })
  TPB!: number;

  @ApiProperty({ type: Number, example: 0 })
  PPU!: number;
}

/** OpenAPI model of a timeline (design 6, `Timeline`). */
export class TimelineModel implements TimelineResponse {
  @ApiProperty({ type: Number, example: 4 })
  id!: number;

  @ApiProperty({ type: Number, example: 3 })
  cycleId!: number;

  @ApiProperty({ type: String, example: 'July 2026' })
  name!: string;

  @ApiProperty({
    type: String,
    enum: timelineKinds,
    example: 'official',
    description: 'Set by the server: the first timeline of a cycle is official',
  })
  kind!: TimelineKind;

  @ApiProperty({ type: Boolean, example: false })
  allPrograms!: boolean;

  @ApiProperty({
    type: [Number],
    example: [2, 5],
    description: 'CLARISA ids; empty when `allPrograms`',
  })
  programIds!: number[];

  @ApiProperty({ type: Boolean, example: false })
  allResultTypes!: boolean;

  @ApiProperty({
    type: [String],
    example: ['INNOVATION_DEV'],
    description: 'Catalog keys; empty when `allResultTypes`',
  })
  resultTypeKeys!: string[];

  @ApiProperty({ type: [TimelineStepModel] })
  steps!: TimelineStepModel[];

  @ApiProperty({
    type: String,
    enum: ['scheduled', 'live', 'finished'],
    example: 'scheduled',
    description: 'From today in Rome, computed on read',
  })
  status!: TimelineStatus;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: null,
    description: 'Position of the step open today, or null',
  })
  currentStep!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 1,
    description: 'Position of the next step to open, or null',
  })
  nextStep!: number | null;

  @ApiProperty({
    type: [String],
    example: ['NO_RESULTS_LOADED', 'NO_ASSESSOR_ASSIGNED'],
    description: 'What the timeline still lacks to run',
  })
  readiness!: string[];

  @ApiProperty({ type: AssignedCountModel })
  assignedCount!: AssignedCountModel;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}

/** OpenAPI model of a user assigned to a timeline in a role (design 6, `TimelineUser`). */
export class TimelineUserModel implements TimelineUserResponse {
  @ApiProperty({ type: Number, example: 12 })
  assignmentId!: number;

  @ApiProperty({ type: Number, example: 7 })
  userId!: number;

  @ApiProperty({ type: String, nullable: true, example: 'Ada' })
  firstName!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Lovelace' })
  lastName!: string | null;

  @ApiProperty({ type: String, example: 'ada@cgiar.org' })
  email!: string;

  @ApiProperty({ type: String, enum: ASSIGNABLE_ROLES, example: 'ASSESSOR' })
  role!: AssignableRole;

  @ApiProperty({ type: String, format: 'date-time' })
  assignedAt!: Date;
}

/** OpenAPI model of a timeline with its assigned users (design 6, `TimelineDetail`). */
export class TimelineDetailModel
  extends TimelineModel
  implements TimelineDetailResponse
{
  @ApiProperty({ type: [TimelineUserModel] })
  users!: TimelineUserModel[];
}
