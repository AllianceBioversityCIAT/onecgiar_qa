// @akili-spec assessment/step-1-assessment
import { ApiProperty, type ApiPropertyOptions } from '@nestjs/swagger';
import { commentStates } from '../../database/drizzle/schema/assessment-comments.js';
import { QA_STATUSES, type QaStatus } from '../qa-status.js';
import {
  WorklistAssessedByModel,
  WorklistProgramModel,
  WorklistResultTypeModel,
} from './worklist.model.js';

/** OpenAPI models of the assessment view (design 6, FR-8, FR-9). The service's view is what they describe. */

/** Any JSON value, as the snapshot holds it: no `type`, so the schema says "anything" (3.0 has no type list). */
const anyValue = (description: string, required = true): ApiPropertyOptions =>
  ({
    nullable: true,
    required,
    description,
    oneOf: [
      { type: 'string' },
      { type: 'number' },
      { type: 'boolean' },
      { type: 'array', items: {} },
      { type: 'object', additionalProperties: true },
    ],
  }) as unknown as ApiPropertyOptions;

export class AssessmentTimelineModel {
  @ApiProperty({ type: Number, example: 4 })
  id!: number;

  @ApiProperty({ type: String, example: 'Official' })
  name!: string;
}

export class AssessmentStepModel {
  @ApiProperty({ type: Number, example: 1 })
  position!: number;

  @ApiProperty({ type: String, example: 'Step 1' })
  name!: string;
}

export class AssessmentHeaderModel {
  @ApiProperty({ type: Number, example: 4021 })
  resultCode!: number;

  @ApiProperty({ type: String, nullable: true })
  title!: string | null;

  @ApiProperty({ type: WorklistProgramModel })
  program!: WorklistProgramModel;

  @ApiProperty({ type: WorklistResultTypeModel })
  resultType!: WorklistResultTypeModel;

  @ApiProperty({ type: AssessmentTimelineModel })
  timeline!: AssessmentTimelineModel;

  @ApiProperty({
    type: AssessmentStepModel,
    nullable: true,
    description: 'The step of the caller role; null when the timeline has none',
  })
  step!: AssessmentStepModel | null;

  @ApiProperty({ type: String, enum: QA_STATUSES, nullable: true })
  status!: QaStatus | null;
}

export class AssessmentCommentAuthorModel {
  @ApiProperty({ type: Number, example: 7 })
  id!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Ana',
    description: 'Authors are shown by nickname only',
  })
  nickname!: string | null;
}

export class AssessmentCommentValueCopyModel {
  @ApiProperty(
    anyValue('The field value as the snapshot held it at writing (DD-8)'),
  )
  value!: unknown;

  @ApiProperty(
    anyValue(
      'Its labels when the snapshot had them; ids are shown otherwise',
      false,
    ),
  )
  labels?: unknown;
}

export class AssessmentCommentModel {
  @ApiProperty({ type: Number, example: 12 })
  id!: number;

  @ApiProperty({ type: String, example: 'general.title' })
  fieldKey!: string;

  @ApiProperty({ type: AssessmentCommentAuthorModel })
  author!: AssessmentCommentAuthorModel;

  @ApiProperty({ type: String })
  body!: string;

  @ApiProperty({ type: String, enum: commentStates, example: 'open' })
  state!: string;

  @ApiProperty({ type: Number, example: 1 })
  stepPosition!: number;

  @ApiProperty({ type: Number, example: 1 })
  round!: number;

  @ApiProperty({ type: AssessmentCommentValueCopyModel })
  valueCopy!: AssessmentCommentValueCopyModel;

  @ApiProperty({ type: Boolean })
  valueTruncated!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  withdrawnAt!: string | null;
}

export class AssessmentFieldModel {
  @ApiProperty({ type: String, example: 'general.title' })
  key!: string;

  @ApiProperty({ type: String, example: 'Title' })
  label!: string;

  @ApiProperty({
    type: String,
    example: 'text',
    description: 'The catalog type of the field; `unknown` under `other`',
  })
  type!: string;

  @ApiProperty({
    type: String,
    enum: ['view', 'assessed'],
    description:
      '`view`: value only. `assessed`: value, validation mark and comment action. A Hidden field is never returned, except the Theory of Change group, which is shown as `view`',
  })
  mode!: 'view' | 'assessed';

  @ApiProperty({
    type: Boolean,
    description: 'The "Core" tag; only on an `assessed` field',
  })
  core!: boolean;

  @ApiProperty(anyValue('The snapshot value; null when `notApplicable`'))
  value!: unknown;

  @ApiProperty({
    type: 'object',
    additionalProperties: {
      type: 'object',
      additionalProperties: { type: 'string', nullable: true },
    },
    nullable: true,
    example: { initiatives: { '3': 'SP03 Apple' } },
    description:
      'Display labels of the ids in `value`, as Reporting sends them: `{ control list: { id: label } }`, filtered to the lists the catalog field names. A null label is an id with no row. The whole object is null when the snapshot has none for this field, and the ids are shown then',
  })
  labels!: Record<string, Record<string, string | null>> | null;

  @ApiProperty({
    type: Boolean,
    description: 'The green mark; always false on a `view` field',
  })
  validated!: boolean;

  @ApiProperty({ type: [AssessmentCommentModel] })
  comments!: AssessmentCommentModel[];

  @ApiProperty({
    type: Boolean,
    description: 'The catalog has the field and the snapshot has no key for it',
  })
  notApplicable!: boolean;
}

export class AssessmentSectionModel {
  @ApiProperty({
    type: String,
    example: 'general_information',
    description:
      'A catalog section key, or `theory_of_change` for the virtual section of the ToC group',
  })
  key!: string;

  @ApiProperty({ type: String, example: 'General information' })
  label!: string;

  @ApiProperty({ type: [AssessmentFieldModel] })
  fields!: AssessmentFieldModel[];
}

export class AssessmentSummaryModel {
  @ApiProperty({
    type: String,
    enum: ['pending', 'quality_assessed', 'returned'],
  })
  status!: 'pending' | 'quality_assessed' | 'returned';

  @ApiProperty({ type: WorklistAssessedByModel, nullable: true })
  assessedBy!: WorklistAssessedByModel | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  finishedAt!: string | null;
}

export class AssessmentViewModel {
  @ApiProperty({ type: AssessmentHeaderModel })
  header!: AssessmentHeaderModel;

  @ApiProperty({
    type: [AssessmentSectionModel],
    description:
      'In catalog order, only the fields that apply to the result type and are not Hidden; the Theory of Change group is one section at the position of its first field',
  })
  sections!: AssessmentSectionModel[];

  @ApiProperty({
    type: [AssessmentFieldModel],
    description:
      'Snapshot keys missing from the catalog ("Other fields"), read only',
  })
  other!: AssessmentFieldModel[];

  @ApiProperty({ type: Boolean })
  writable!: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    enum: [
      'admin_read_only',
      'step_upcoming',
      'step_closed',
      'no_step',
      'finished',
    ],
    description: 'Why the caller cannot write; null when they can',
  })
  readOnlyReason!: string | null;

  @ApiProperty({
    type: AssessmentSummaryModel,
    nullable: true,
    description: 'null until the first write creates the assessment (DD-3)',
  })
  assessment!: AssessmentSummaryModel | null;
}
