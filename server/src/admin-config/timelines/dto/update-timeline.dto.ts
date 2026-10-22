import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import type { TimelineStepUpdate } from '../timeline-rules.js';
import type { UpdateTimelineCommand } from '../timelines.service.js';

// A key the client left out is `undefined`; `null` is a value and not a way to
// leave a key out, so for a field that cannot hold null the check runs on
// everything except `undefined`.
const sentOnly = ValidateIf((_, value) => value !== undefined);

/**
 * One step of `PATCH /timelines/:id`, addressed by position (design 6, DD-1).
 * Only the position is required. There is no `audience`, `round` or
 * `requiresLoad`: the structure is fixed, and those keys are a 400 from the
 * pipe (FR-1, NFR-2). The position is only type-checked here; one the timeline
 * lacks, or sent twice, is named by the rules as `steps[i].position`, with the
 * other rule problems of the request (FR-11 of *timelines*).
 */
export class TimelineStepUpdateDto implements TimelineStepUpdate {
  @ApiProperty({
    type: Number,
    minimum: 1,
    maximum: 5,
    example: 2,
    description:
      'The step to change, by its position in the timeline (1 to 5). A position the timeline does not have is a 400 naming `steps[i].position`',
  })
  @IsInt()
  position!: number;

  @ApiProperty({
    type: String,
    maxLength: 120,
    required: false,
    example: 'Assessors review',
    description:
      'New name; left out keeps the stored one. At most 120 characters after trimming',
  })
  @sentOnly
  @IsString()
  name?: string;

  @ApiProperty({
    type: String,
    format: 'date',
    required: false,
    nullable: true,
    example: '2026-11-02',
    description:
      'New opening day, Rome calendar `YYYY-MM-DD`; left out keeps the stored one. Refused when the step is already open or closed',
  })
  @IsOptional()
  @IsString()
  opensOn?: string | null;

  @ApiProperty({
    type: String,
    format: 'date',
    required: false,
    nullable: true,
    example: '2026-11-06',
    description:
      'New closing day, Rome calendar `YYYY-MM-DD`; left out keeps the stored one. A step in progress can be extended (never earlier than today)',
  })
  @IsOptional()
  @IsString()
  closesOn?: string | null;
}

/**
 * Body of `PATCH /timelines/:id` (design 6, `TimelineUpdate`). A partial body:
 * a key left out keeps its stored value. `version` is the only required key,
 * and its absence is a 400 (FR-9). Everything else optional stays optional at
 * the pipe, so the rules can name each problem in one 400 (FR-11 of
 * *timelines*). The structure is fixed: any key outside this class, at any
 * level, is a 400 `UNKNOWN_FIELD` (FR-1, NFR-2).
 */
export class UpdateTimelineDto implements UpdateTimelineCommand {
  @ApiProperty({
    type: Number,
    minimum: 1,
    example: 4,
    description:
      'The version the timeline had when the admin read it. When it moved since, nothing is written: 409 `TIMELINES_VERSION_STALE`',
  })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiProperty({
    type: String,
    maxLength: 120,
    required: false,
    example: 'July 2026',
    description:
      'New name; at most 120 characters after trimming; unique in the cycle whatever the letter case',
  })
  @sentOnly
  @IsString()
  name?: string;

  @ApiProperty({
    type: Boolean,
    required: false,
    example: false,
    description:
      'Every Science Program. A scope change sends its flag; with it true the list is left out or empty',
  })
  @sentOnly
  @IsBoolean()
  allPrograms?: boolean;

  @ApiProperty({
    type: [Number],
    required: false,
    nullable: true,
    example: [2, 5],
    description:
      'CLARISA ids; with `allPrograms` false, at least one, all in the catalog. Sent without the flag, it is judged against the stored flag',
  })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  programIds?: number[] | null;

  @ApiProperty({
    type: Boolean,
    required: false,
    example: false,
    description:
      'Every result type. A scope change sends its flag; with it true the list is left out or empty',
  })
  @sentOnly
  @IsBoolean()
  allResultTypes?: boolean;

  @ApiProperty({
    type: [String],
    required: false,
    nullable: true,
    example: ['INNOVATION_DEV'],
    description:
      'Catalog keys; with `allResultTypes` false, at least one, all in the catalog. Sent without the flag, it is judged against the stored flag',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  resultTypeKeys?: string[] | null;

  @ApiProperty({
    type: [TimelineStepUpdateDto],
    required: false,
    description:
      'The steps to change, each by position. A step left out is untouched',
  })
  @sentOnly
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TimelineStepUpdateDto)
  steps?: TimelineStepUpdateDto[];

  @ApiProperty({
    type: Boolean,
    required: false,
    example: true,
    description:
      'Confirms a change that touches a step in progress. Without it such a change is 409 `TIMELINES_IN_PROGRESS_UNCONFIRMED` and nothing is written',
  })
  @sentOnly
  @IsBoolean()
  confirmInProgress?: boolean;
}
