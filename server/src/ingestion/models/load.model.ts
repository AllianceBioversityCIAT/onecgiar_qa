// @akili-spec ingestion/step-1-loads
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  KpGroupsView,
  LoadDetail,
  LoadItem,
  LoadPreview,
  LoadSummaryView,
  SkippedView,
  StartedLoad,
} from '../loads.service.js';

/** OpenAPI model of the loads API (design 6). The service's views are what the models implement. */

export class SkippedTimelineModel {
  @ApiProperty({ type: Number, example: 12 })
  id!: number;

  @ApiProperty({ type: String, example: 'August 2026' })
  name!: string;

  @ApiProperty({ type: Number, example: 3 })
  count!: number;
}

export class SkippedModel implements SkippedView {
  @ApiProperty({
    type: String,
    example: 'ACTIVE_IN_OTHER_TIMELINE',
    description:
      "`ACTIVE_IN_OTHER_TIMELINE`, `ALREADY_IN_THIS_TIMELINE`, `DUPLICATE_RESULT_CODE`, or Reporting's own reason as given (`not_found`, `not_submitted`, `other_phase`, `not_w1w2`, `type_not_catalogued`, `no_lead_program`, ...)",
  })
  reason!: string;

  @ApiProperty({ type: Number, example: 3 })
  count!: number;

  @ApiPropertyOptional({
    type: [SkippedTimelineModel],
    description:
      'Only for `ACTIVE_IN_OTHER_TIMELINE`: the timelines that hold the results',
  })
  timelines?: SkippedTimelineModel[];
}

export class KpGroupsModel implements KpGroupsView {
  @ApiProperty({ type: Number, example: 4 })
  notInQa!: number;

  @ApiProperty({ type: Number, example: 10 })
  autoChecked!: number;

  @ApiProperty({ type: Number, example: 6 })
  review!: number;
}

export class ByProgramModel {
  @ApiProperty({ type: Number, example: 2, description: 'CLARISA id' })
  programId!: number;

  @ApiProperty({ type: String, example: 'SP02' })
  code!: string;

  @ApiProperty({ type: Number, example: 120 })
  count!: number;
}

export class ByResultTypeModel {
  @ApiProperty({ type: String, example: 'knowledge_product' })
  key!: string;

  @ApiProperty({ type: Number, example: 80 })
  count!: number;
}

export class ToLoadModel {
  @ApiProperty({ type: Number, example: 200 })
  total!: number;

  @ApiProperty({ type: [ByProgramModel] })
  byProgram!: ByProgramModel[];

  @ApiProperty({ type: [ByResultTypeModel] })
  byResultType!: ByResultTypeModel[];
}

/** What a load would do now; nothing was written (FR-1). */
export class LoadPreviewModel implements LoadPreview {
  @ApiProperty({ type: Number, example: 2026 })
  phaseYear!: number;

  @ApiProperty({
    type: String,
    enum: ['open', 'closed'],
    example: 'open',
    description:
      '`closed` when the cycle is closed or step 1 has closed: the start is refused. The front disables the start on it',
  })
  window!: 'open' | 'closed';

  @ApiProperty({ type: ToLoadModel })
  toLoad!: ToLoadModel;

  @ApiProperty({ type: KpGroupsModel })
  kpGroups!: KpGroupsModel;

  @ApiProperty({ type: [SkippedModel] })
  skipped!: SkippedModel[];
}

/** The 202 answer of a start. */
export class StartedLoadModel implements StartedLoad {
  @ApiProperty({ type: Number, example: 7 })
  id!: number;

  @ApiProperty({ type: String, enum: ['running'], example: 'running' })
  status!: 'running';
}

export class StartedByModel {
  @ApiProperty({ type: Number, example: 1 })
  id!: number;

  @ApiProperty({ type: String, nullable: true, example: 'Ada' })
  nickname!: string | null;
}

/** A load as the list shows it. */
export class LoadItemModel implements LoadItem {
  @ApiProperty({ type: Number, example: 7 })
  id!: number;

  @ApiProperty({
    type: String,
    enum: ['running', 'completed', 'failed'],
    example: 'running',
    description:
      'A `running` load whose heartbeat expired reads `failed` with `ABANDONED` on every read',
  })
  status!: string;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 420,
    description: 'Results the run found; null until it has listed the feed',
  })
  total!: number | null;

  @ApiProperty({ type: Number, example: 150 })
  processed!: number;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-11-10T08:00:00.000Z',
  })
  startedAt!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    example: null,
  })
  finishedAt!: string | null;

  @ApiProperty({ type: StartedByModel })
  startedBy!: StartedByModel;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description:
      '`REPORTING_UNAUTHORIZED`, `REPORTING_REJECTED`, `REPORTING_UNAVAILABLE`, `CATALOG_VERSION_MISMATCH`, `STORE_UNAVAILABLE`, `ABANDONED` or `INTERNAL`; never a secret',
  })
  failureReason!: string | null;
}

export class SummaryByProgramModel {
  @ApiProperty({ type: Number, example: 2, description: 'CLARISA id' })
  programId!: number;

  @ApiProperty({ type: Number, example: 120 })
  count!: number;
}

export class LoadSummaryModel implements LoadSummaryView {
  @ApiProperty({ type: Number, example: 190 })
  loaded!: number;

  @ApiProperty({ type: [SummaryByProgramModel] })
  byProgram!: SummaryByProgramModel[];

  @ApiProperty({ type: [ByResultTypeModel] })
  byResultType!: ByResultTypeModel[];

  @ApiProperty({ type: KpGroupsModel })
  kpGroups!: KpGroupsModel;

  @ApiProperty({ type: [SkippedModel] })
  skipped!: SkippedModel[];
}

/** One load: the list item plus its summary. */
export class LoadDetailModel extends LoadItemModel implements LoadDetail {
  @ApiProperty({ type: LoadSummaryModel })
  summary!: LoadSummaryModel;
}
