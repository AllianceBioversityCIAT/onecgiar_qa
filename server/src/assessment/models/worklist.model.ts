// @akili-spec assessment/step-1-assessment
import { ApiProperty } from '@nestjs/swagger';
import { QA_STATUSES, type QaStatus } from '../qa-status.js';

/** OpenAPI models of the worklist routes (design 6). The service's views are what they describe. */

export class WorklistStepModel {
  @ApiProperty({ type: Number, example: 1 })
  position!: number;

  @ApiProperty({ type: String, example: 'Step 1' })
  name!: string;

  @ApiProperty({
    type: String,
    example: '2026-03-01T00:00',
    description: 'Rome wall-clock minute, no offset',
  })
  opensAt!: string;

  @ApiProperty({ type: String, example: '2026-03-31T23:59' })
  closesAt!: string;

  @ApiProperty({
    type: String,
    example: 'in_progress',
    description:
      'The step state of the caller role at the server clock: `upcoming`, `in_progress` or `closed`',
  })
  state!: string;
}

export class WorklistTimelineModel {
  @ApiProperty({ type: Number, example: 4 })
  id!: number;

  @ApiProperty({ type: String, example: 'Official' })
  name!: string;

  @ApiProperty({ type: String, enum: ['official', 'additional'] })
  kind!: 'official' | 'additional';

  @ApiProperty({
    type: [String],
    example: ['ASSESSOR'],
    description:
      'The roles the caller reads this timeline with: their enabled reviewer roles (`ASSESSOR`), and `ADMIN` when the caller holds the admin permission, so an admin sees `["ADMIN"]` on a timeline they are not assigned to',
  })
  roles!: string[];

  @ApiProperty({
    type: WorklistStepModel,
    nullable: true,
    description: 'The step of the caller role; null when the timeline has none',
  })
  step!: WorklistStepModel | null;
}

export class WorklistTimelinesModel {
  @ApiProperty({ type: [WorklistTimelineModel] })
  timelines!: WorklistTimelineModel[];

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 4,
    description:
      'The official timeline when offered, else the earliest step-1 opening; null when none is offered',
  })
  defaultTimelineId!: number | null;

  @ApiProperty({
    type: String,
    example: 'Europe/Rome',
    description: 'The time zone the step minutes are written in',
  })
  timeZone!: string;
}

export class WorklistProgramModel {
  @ApiProperty({ type: Number, example: 3, description: 'CLARISA id' })
  id!: number;

  @ApiProperty({ type: String, example: 'SP03' })
  code!: string;

  @ApiProperty({ type: String, example: 'Climate action' })
  name!: string;
}

export class WorklistResultTypeModel {
  @ApiProperty({ type: String, example: 'KP' })
  key!: string;

  @ApiProperty({ type: String, example: 'Knowledge product' })
  label!: string;
}

export class WorklistAssessedByModel {
  @ApiProperty({ type: Number, example: 7 })
  id!: number;

  @ApiProperty({ type: String, nullable: true, example: 'Ana' })
  nickname!: string | null;
}

export class WorklistRowModel {
  @ApiProperty({ type: Number, example: 51 })
  membershipId!: number;

  @ApiProperty({ type: Number, example: 4021 })
  resultCode!: number;

  @ApiProperty({ type: String, nullable: true })
  title!: string | null;

  @ApiProperty({
    type: Boolean,
    description:
      'A round-2 re-entry whose fields changed since the previous round',
  })
  updated!: boolean;

  @ApiProperty({ type: WorklistProgramModel })
  program!: WorklistProgramModel;

  @ApiProperty({ type: WorklistResultTypeModel })
  resultType!: WorklistResultTypeModel;

  @ApiProperty({ type: Number, example: 2, description: 'Open comments' })
  comments!: number;

  @ApiProperty({ type: Number, enum: [0], description: 'Always 0 for now' })
  answeredBySp!: 0;

  @ApiProperty({ type: WorklistAssessedByModel, nullable: true })
  assessedBy!: WorklistAssessedByModel | null;

  @ApiProperty({ type: String, enum: QA_STATUSES, nullable: true })
  status!: QaStatus | null;

  @ApiProperty({ type: Boolean, description: 'Rows always open the view' })
  canOpen!: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Why the caller cannot write on it; null when they can',
  })
  readOnlyReason!: string | null;
}

export class WorklistCountersModel {
  @ApiProperty({ type: Number, example: 12, description: 'Status `pending`' })
  pending!: number;

  @ApiProperty({
    type: Number,
    example: 7,
    description:
      '`quality_assessed`, `returned_to_program` and `clarification_requested`',
  })
  finished!: number;

  @ApiProperty({
    type: Number,
    example: 10,
    description:
      'Every membership of the caller scope under the Auto-validated hiding. Filters and the page do not change it',
  })
  total!: number;
}

export class WorklistPageModel {
  @ApiProperty({ type: [WorklistRowModel] })
  rows!: WorklistRowModel[];

  @ApiProperty({ type: WorklistCountersModel })
  counters!: WorklistCountersModel;

  @ApiProperty({
    type: Boolean,
    description:
      'The caller can write now: an enabled reviewer role whose step is open. An admin without a reviewer row is never writable',
  })
  writable!: boolean;

  @ApiProperty({
    type: Boolean,
    description:
      'The caller is assigned to the timeline but no enabled role of theirs has a worklist (the page is empty)',
  })
  noActiveRole!: boolean;
}

export class WorklistStatusOptionModel {
  @ApiProperty({ type: String, enum: QA_STATUSES, example: 'pending' })
  key!: QaStatus;

  @ApiProperty({ type: String, example: 'Pending' })
  label!: string;
}

export class WorklistOptionsModel {
  @ApiProperty({ type: [WorklistProgramModel] })
  programs!: WorklistProgramModel[];

  @ApiProperty({ type: [WorklistResultTypeModel] })
  resultTypes!: WorklistResultTypeModel[];

  @ApiProperty({ type: [WorklistStatusOptionModel] })
  statuses!: WorklistStatusOptionModel[];
}
