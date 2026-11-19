// @akili-spec assessment/step-1-assessment
import {
  ApiProperty,
  ApiPropertyOptional,
  type ApiPropertyOptions,
} from '@nestjs/swagger';
import { commentStates } from '../../database/drizzle/schema/assessment-comments.js';
import {
  SpClarificationModel,
  SpResponseModel,
} from '../sp-view/models/sp-view.model.js';
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

/** The delete route's answer: the comment with who deleted it and when (round-2 FR-10). */
export class AssessmentDeletedCommentModel extends AssessmentCommentModel {
  @ApiProperty({ type: String, format: 'date-time' })
  deletedAt!: string;

  @ApiProperty({ type: Number, example: 20 })
  deletedBy!: number;
}

export class AssessmentThreadDecisionModel {
  @ApiProperty({
    type: String,
    example: 'escalate',
    description: "The Lead's current decision: `agree_program` or `escalate`",
  })
  decision!: string;

  @ApiProperty({ type: String, nullable: true })
  body!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  decidedAt!: string;
}

/** A round-1 comment as the Lead reads it (round-2 FR-4). Never an email: the responder is named. */
export class AssessmentThreadItemModel {
  @ApiProperty({ type: Number, example: 12 })
  commentId!: number;

  @ApiProperty({ type: AssessmentCommentAuthorModel })
  author!: AssessmentCommentAuthorModel;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: String })
  body!: string;

  @ApiProperty({
    type: AssessmentCommentValueCopyModel,
    description:
      "The field value when the comment was written; the current value is the field's own `value`",
  })
  valueCopy!: AssessmentCommentValueCopyModel;

  @ApiProperty({ type: Boolean })
  valueTruncated!: boolean;

  @ApiProperty({ type: String, enum: commentStates, example: 'disagreed' })
  state!: string;

  @ApiPropertyOptional({
    type: SpResponseModel,
    description:
      "The program's latest response; absent when the program has not responded",
  })
  response?: SpResponseModel;

  @ApiProperty({
    type: [SpClarificationModel],
    description: 'Every clarification request with its answer, oldest first',
  })
  clarifications!: SpClarificationModel[];

  @ApiPropertyOptional({
    type: AssessmentThreadDecisionModel,
    description: "The Lead's current decision; absent when none is set",
  })
  decision?: AssessmentThreadDecisionModel;

  @ApiProperty({
    type: Boolean,
    description: 'The caller may decide this comment (`choices` is not empty)',
  })
  decidable!: boolean;

  @ApiProperty({
    type: [String],
    enum: ['agree_program', 'escalate'],
    description:
      'The decisions the caller may set; empty for ADMIN and for a comment that is not decidable',
  })
  choices!: string[];
}

export class AssessmentFieldModel {
  @ApiProperty({ type: String, example: 'general.title' })
  key!: string;

  @ApiProperty({ type: String, example: 'Title' })
  label!: string;

  @ApiProperty({
    type: String,
    required: false,
    example: 'Provide a clear, informative name of the result.',
    description:
      "Reporting's help text for the field tooltip (catalog `description`); absent when the catalog row has none and on fields under `other`",
  })
  description?: string;

  @ApiProperty({
    type: String,
    example: 'text',
    description: 'The catalog type of the field; `unknown` under `other`',
  })
  type!: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'string' },
    example: { actor_type: 'actor_types' },
    description:
      'Subfield key -> the control list in `labels` that names its option ids (e.g. `actor_type` -> `actor_types`); absent when no subfield names a list',
  })
  subfieldLists?: Record<string, string>;

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

  @ApiProperty({
    type: Boolean,
    description:
      "Round 2: the field's key is in the membership's `changed_fields`. Always false in round 1 and on a new round-2 membership",
  })
  updated!: boolean;

  @ApiProperty({
    type: Boolean,
    description:
      'The field takes a write. Round 1: an Assessed field. Round 2: an Assessed core field; every other field is read-only context',
  })
  actionable!: boolean;

  @ApiProperty({
    type: Boolean,
    description:
      'Round 2: the stored validation, else the carried green. Equals `validated` in round 1 and on a field that is not actionable',
  })
  effectiveValidated!: boolean;

  @ApiProperty({
    type: Boolean,
    description:
      'Round 2: the green is the round-1 one, carried because the Lead stored nothing. False in round 1',
  })
  carried!: boolean;

  @ApiProperty({
    type: [AssessmentThreadItemModel],
    description:
      'Round 2: the round-1 thread of a core field (comments neither withdrawn nor deleted). Always empty in round 1 and on a new round-2 membership',
  })
  thread!: AssessmentThreadItemModel[];
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
    enum: ['pending', 'quality_assessed', 'returned', 'escalated'],
    description:
      '`escalated`: a round-2 review that ended with at least one grey core field escalated (Pending for TPB review). Round 2 never ends `returned`; round 1 never ends `escalated`',
  })
  status!: 'pending' | 'quality_assessed' | 'returned' | 'escalated';

  @ApiProperty({ type: WorklistAssessedByModel, nullable: true })
  assessedBy!: WorklistAssessedByModel | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  finishedAt!: string | null;
}

export class AssessmentValidationModel {
  @ApiProperty({ type: String, example: 'general.title' })
  fieldKey!: string;

  @ApiProperty({
    type: Boolean,
    description: 'true = green; false = set back to grey',
  })
  validated!: boolean;
}

/** The answer of `PUT …/assessment/validations`: the end state and every validation the assessment holds. */
export class ValidationSummaryModel extends AssessmentSummaryModel {
  @ApiProperty({
    type: [AssessmentValidationModel],
    description:
      'Every validation row of the assessment after the request, by field key. Empty when the assessment does not exist yet',
  })
  validations!: AssessmentValidationModel[];

  @ApiPropertyOptional({
    type: [AssessmentValidationModel],
    description:
      'Round 2 only: the effective state of every core field after the request, by field key (the stored mark, else the green carried from round 1). Absent in round 1',
  })
  effectiveValidated?: AssessmentValidationModel[];
}

/** The answer of `PUT` and `DELETE …/assessment/decisions/:commentId` (round-2 design 6). */
export class DecisionResultModel extends ValidationSummaryModel {
  @ApiProperty({
    type: AssessmentThreadDecisionModel,
    nullable: true,
    description:
      "The Lead's decision on the comment as stored; `null` after a clear",
  })
  decision!: AssessmentThreadDecisionModel | null;
}

export class AssessmentViewModel {
  @ApiProperty({ type: AssessmentHeaderModel })
  header!: AssessmentHeaderModel;

  @ApiProperty({
    type: Number,
    example: 2,
    description:
      "The membership's round: 1 for an assessor, 2 for a Lead Assessor; ADMIN reads the latest",
  })
  round!: number;

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
      'auto_validated',
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
