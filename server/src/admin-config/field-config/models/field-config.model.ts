// @akili-spec admin-config/field-configuration
import { ApiProperty } from '@nestjs/swagger';
import { fieldConfigVisibilities } from '../../../database/drizzle/schema/field-config-draft-items.js';
import type { FieldChange, OptionSet } from '../field-config-diff.js';
import type { FieldRequirement } from '../field-config-catalog.js';
import type { FieldVisibility } from '../field-config-rules.js';
import type {
  FieldConfigPreview,
  FieldConfigView,
  FieldView,
  NotInCatalogView,
  PreviewTimeline,
  PublishResult,
  ResultTypeView,
  SectionView,
} from '../field-config.service.js';

// OpenAPI models of the field configuration answers (design 6). Each class
// mirrors a service interface; every property states its `type` because Vitest
// does not emit decorator metadata. `Date` values are ISO strings on the wire.

export class OptionSetModel implements OptionSet {
  @ApiProperty({
    type: String,
    enum: fieldConfigVisibilities,
    example: 'assessed',
  })
  visibility!: FieldVisibility;

  @ApiProperty({ type: Boolean, example: true })
  isCore!: boolean;

  @ApiProperty({ type: Boolean, example: false })
  isAiInput!: boolean;
}

export class FieldModel implements FieldView {
  @ApiProperty({ type: String, example: 'title' })
  key!: string;

  @ApiProperty({ type: String, example: 'Title' })
  label!: string;

  @ApiProperty({ type: String, required: false })
  description?: string;

  @ApiProperty({
    type: String,
    enum: ['required', 'conditional', 'optional'],
    example: 'required',
    description: 'How Reporting requires the field',
  })
  requirement!: FieldRequirement;

  @ApiProperty({
    type: Boolean,
    example: false,
    description: 'Added to the catalog since the latest published version',
  })
  isNew!: boolean;

  @ApiProperty({
    type: Boolean,
    example: false,
    description: 'No classification yet: it reads `hidden`',
  })
  unclassified!: boolean;

  @ApiProperty({ type: OptionSetModel, description: 'The draft option set' })
  draft!: OptionSetModel;

  @ApiProperty({
    type: OptionSetModel,
    nullable: true,
    description: 'The latest published option set; null before any publication',
  })
  published!: OptionSetModel | null;
}

export class SectionModel implements SectionView {
  @ApiProperty({ type: String, example: 'general' })
  key!: string;

  @ApiProperty({ type: String, example: 'General' })
  label!: string;

  @ApiProperty({ type: [FieldModel] })
  fields!: FieldModel[];
}

export class ResultTypeModel implements ResultTypeView {
  @ApiProperty({ type: String, example: 'INNOVATION_DEV' })
  key!: string;

  @ApiProperty({ type: String, example: 'Innovation development' })
  label!: string;

  @ApiProperty({ type: String, example: 'output' })
  level!: string;

  @ApiProperty({ type: [SectionModel] })
  sections!: SectionModel[];
}

export class NotInCatalogModel implements NotInCatalogView {
  @ApiProperty({ type: String, example: 'INNOVATION_DEV' })
  resultTypeKey!: string;

  @ApiProperty({ type: String, example: 'old_field' })
  fieldKey!: string;

  @ApiProperty({
    type: OptionSetModel,
    description: 'A draft row whose field left the catalog',
  })
  draft!: OptionSetModel;
}

export class LatestVersionModel {
  @ApiProperty({ type: Number, example: 3 })
  number!: number;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-10-20T10:00:00.000Z',
  })
  publishedAt!: Date;
}

export class FieldConfigViewModel implements Omit<
  FieldConfigView,
  'latestVersion'
> {
  @ApiProperty({ type: Number, example: 3 })
  cycleId!: number;

  @ApiProperty({ type: Number, example: 2026 })
  year!: number;

  @ApiProperty({ type: String, example: '2026.2' })
  catalogVersion!: string;

  @ApiProperty({
    type: Number,
    minimum: 0,
    example: 7,
    description: 'Draft revision; send it back to publish',
  })
  revision!: number;

  @ApiProperty({
    type: LatestVersionModel,
    nullable: true,
    description: 'The latest published version; null before any publication',
  })
  latestVersion!: LatestVersionModel | null;

  @ApiProperty({ type: [ResultTypeModel] })
  resultTypes!: ResultTypeModel[];

  @ApiProperty({ type: [NotInCatalogModel] })
  notInCatalog!: NotInCatalogModel[];
}

export class FieldChangeModel implements FieldChange {
  @ApiProperty({ type: String, example: 'INNOVATION_DEV' })
  resultTypeKey!: string;

  @ApiProperty({ type: String, example: 'title' })
  fieldKey!: string;

  @ApiProperty({
    type: OptionSetModel,
    nullable: true,
    description: 'The latest published option set; null when it had none',
  })
  before!: OptionSetModel | null;

  @ApiProperty({ type: OptionSetModel })
  after!: OptionSetModel;
}

export class PreviewTimelineModel implements PreviewTimeline {
  @ApiProperty({ type: Number, example: 4 })
  id!: number;

  @ApiProperty({ type: String, example: 'July 2026' })
  name!: string;

  @ApiProperty({
    type: String,
    format: 'date',
    nullable: true,
    example: '2026-11-02',
    description: 'Opening day of step 1, Rome calendar; null with no steps',
  })
  opensOn!: string | null;
}

export class KeepTimelineModel extends PreviewTimelineModel {
  @ApiProperty({
    type: Number,
    nullable: true,
    example: 2,
    description:
      'The version the timeline keeps; null when it resolves to none',
  })
  version!: number | null;
}

export class PublishTimelinesModel {
  @ApiProperty({
    type: [PreviewTimelineModel],
    description: 'Timelines that will use the new version',
  })
  receive!: PreviewTimelineModel[];

  @ApiProperty({
    type: [KeepTimelineModel],
    description: 'Started timelines that keep the version they have',
  })
  keep!: KeepTimelineModel[];
}

export class FieldConfigPreviewModel implements Omit<
  FieldConfigPreview,
  'timelines'
> {
  @ApiProperty({ type: Number, minimum: 0, example: 7 })
  revision!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 2,
    description:
      'The version the changes are measured against; null for the first',
  })
  basedOn!: number | null;

  @ApiProperty({ type: [FieldChangeModel] })
  changes!: FieldChangeModel[];

  @ApiProperty({ type: PublishTimelinesModel })
  timelines!: PublishTimelinesModel;
}

export class PublishedVersionModel {
  @ApiProperty({ type: Number, example: 3 })
  number!: number;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-10-20T10:00:00.000Z',
  })
  publishedAt!: Date;

  @ApiProperty({ type: String, example: '2026.2' })
  catalogVersion!: string;
}

export class PublishResultModel implements Omit<PublishResult, 'version'> {
  @ApiProperty({ type: PublishedVersionModel })
  version!: PublishedVersionModel;

  @ApiProperty({
    type: PublishTimelinesModel,
    description:
      'The lists the publication was computed with; a replay returns them as recorded in the audit row',
  })
  timelines!: PublishTimelinesModel;
}
