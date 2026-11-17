// P2-3911: OpenAPI models of the /sp read routes. No model has an assessor
// field: the SP view never names who wrote a comment.
import { ApiProperty } from '@nestjs/swagger';
import { QA_STATUSES } from '../../qa-status.js';
import { SpProgramModel } from './sp-access.model.js';

export class SpStepModel {
  @ApiProperty({ type: Number, example: 2 })
  position!: number;

  @ApiProperty({ type: String, example: 'Programs review' })
  name!: string;

  @ApiProperty({
    type: String,
    example: '2026-11-21T09:00',
    description: 'Rome wall-clock minute',
  })
  opensAt!: string;

  @ApiProperty({ type: String, example: '2026-11-30T17:30' })
  closesAt!: string;

  @ApiProperty({ type: String, enum: ['upcoming', 'in_progress', 'closed'] })
  state!: string;
}

export class SpTimelineModel {
  @ApiProperty({ type: Number })
  id!: number;

  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ type: String, enum: ['official', 'additional'] })
  kind!: string;

  @ApiProperty({
    type: SpStepModel,
    nullable: true,
    description: 'The step whose audience is the programs; null when none',
  })
  step!: SpStepModel | null;
}

export class SpTimelinesModel {
  @ApiProperty({ type: [SpTimelineModel] })
  timelines!: SpTimelineModel[];

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'The official timeline, else the first; null when none',
  })
  defaultTimelineId!: number | null;
}

export class SpKeyLabelModel {
  @ApiProperty({ type: String })
  key!: string;

  @ApiProperty({ type: String })
  label!: string;
}

export class SpResultRowModel {
  @ApiProperty({ type: Number })
  resultCode!: number;

  @ApiProperty({ type: String, nullable: true })
  title!: string | null;

  @ApiProperty({
    type: Boolean,
    description: 'The result was resubmitted with changes (round 2)',
  })
  updated!: boolean;

  @ApiProperty({ type: SpKeyLabelModel })
  resultType!: SpKeyLabelModel;

  @ApiProperty({
    type: Number,
    description: 'QA comments visible to the program',
  })
  comments!: number;

  @ApiProperty({
    type: Number,
    description: 'Comments accepted, accepted with a comment, or disagreed',
  })
  answered!: number;

  @ApiProperty({ type: String, enum: QA_STATUSES, nullable: true })
  status!: string | null;
}

export class SpResultOptionsModel {
  @ApiProperty({ type: [SpKeyLabelModel] })
  statuses!: SpKeyLabelModel[];

  @ApiProperty({ type: [SpKeyLabelModel] })
  resultTypes!: SpKeyLabelModel[];
}

export class SpResultsModel {
  @ApiProperty({ type: [SpResultRowModel] })
  rows!: SpResultRowModel[];

  @ApiProperty({ type: SpResultOptionsModel })
  options!: SpResultOptionsModel;

  @ApiProperty({ type: SpStepModel, nullable: true })
  step!: SpStepModel | null;
}

export class SpResponderModel {
  @ApiProperty({ type: String })
  name!: string;
}

export class SpResponseModel {
  @ApiProperty({ type: Number })
  id!: number;

  @ApiProperty({
    type: String,
    enum: [
      'accept',
      'accept_with_comment',
      'disagree',
      'request_clarification',
    ],
  })
  kind!: string;

  @ApiProperty({ type: String, nullable: true })
  body!: string | null;

  @ApiProperty({ type: SpResponderModel })
  respondedBy!: SpResponderModel;

  @ApiProperty({ type: String, format: 'date-time' })
  respondedAt!: string;
}

export class SpClarificationAnswerModel {
  @ApiProperty({ type: String })
  body!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  answeredAt!: string;
}

export class SpClarificationModel {
  @ApiProperty({
    type: Number,
    description: 'Id of the clarification request (a response)',
  })
  requestId!: number;

  @ApiProperty({ type: String })
  question!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  requestedAt!: string;

  @ApiProperty({ type: SpClarificationAnswerModel, nullable: true })
  answer!: SpClarificationAnswerModel | null;
}

export class SpCommentModel {
  @ApiProperty({ type: Number })
  id!: number;

  @ApiProperty({ type: String })
  fieldKey!: string;

  @ApiProperty({ type: String })
  body!: string;

  @ApiProperty({ type: String })
  state!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: '`{ value, labels? }`: the field as it was when commented',
  })
  valueCopy!: object;

  @ApiProperty({ type: Boolean })
  valueTruncated!: boolean;

  @ApiProperty({
    type: SpResponseModel,
    nullable: true,
    description: 'The latest response',
  })
  response!: SpResponseModel | null;

  @ApiProperty({
    type: [SpResponseModel],
    description: 'Every response, oldest first',
  })
  history!: SpResponseModel[];

  @ApiProperty({ type: [SpClarificationModel] })
  clarifications!: SpClarificationModel[];
}

export class SpFieldModel {
  @ApiProperty({ type: String })
  key!: string;

  @ApiProperty({ type: String })
  label!: string;

  @ApiProperty({ type: String, required: false })
  description?: string;

  @ApiProperty({ type: String })
  type!: string;

  @ApiProperty({ type: String, enum: ['view', 'assessed'] })
  mode!: string;

  @ApiProperty({ type: Boolean })
  core!: boolean;

  @ApiProperty({ description: 'The reported value', nullable: true })
  value!: unknown;

  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true })
  labels!: object | null;

  @ApiProperty({ type: Boolean })
  validated!: boolean;

  @ApiProperty({ type: [SpCommentModel] })
  comments!: SpCommentModel[];

  @ApiProperty({ type: Boolean })
  notApplicable!: boolean;
}

export class SpSectionModel {
  @ApiProperty({ type: String })
  key!: string;

  @ApiProperty({ type: String })
  label!: string;

  @ApiProperty({ type: [SpFieldModel] })
  fields!: SpFieldModel[];
}

export class SpTimelineRefModel {
  @ApiProperty({ type: Number })
  id!: number;

  @ApiProperty({ type: String })
  name!: string;
}

export class SpResultHeaderModel {
  @ApiProperty({ type: Number })
  resultCode!: number;

  @ApiProperty({ type: String, nullable: true })
  title!: string | null;

  @ApiProperty({ type: SpProgramModel })
  program!: SpProgramModel;

  @ApiProperty({ type: SpKeyLabelModel })
  resultType!: SpKeyLabelModel;

  @ApiProperty({ type: SpTimelineRefModel })
  timeline!: SpTimelineRefModel;

  @ApiProperty({ type: String, enum: QA_STATUSES, nullable: true })
  status!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      '"Open in Reporting" link (SP_REPORTING_RESULT_URL); null when not configured',
  })
  reportingUrl!: string | null;
}

export class SpCountsModel {
  @ApiProperty({ type: Number })
  comments!: number;

  @ApiProperty({ type: Number })
  answered!: number;
}

export class SpResultModel {
  @ApiProperty({ type: SpResultHeaderModel })
  header!: SpResultHeaderModel;

  @ApiProperty({ type: SpStepModel, nullable: true })
  step!: SpStepModel | null;

  @ApiProperty({ type: [SpSectionModel] })
  sections!: SpSectionModel[];

  @ApiProperty({ type: [SpFieldModel] })
  other!: SpFieldModel[];

  @ApiProperty({
    type: Boolean,
    description: 'The programs step is in progress',
  })
  writable!: boolean;

  @ApiProperty({
    type: String,
    enum: ['step_not_open', 'step_closed'],
    nullable: true,
  })
  readOnlyReason!: string | null;

  @ApiProperty({ type: SpCountsModel })
  counts!: SpCountsModel;
}
