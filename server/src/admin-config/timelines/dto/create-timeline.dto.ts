import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { stepAudiences } from '../../../database/drizzle/schema/timeline-steps.js';
import type {
  CreateTimelineCommand,
  TimelineStepCommand,
} from '../timelines.service.js';

/**
 * One step of `POST /cycles/:id/timelines`. The pipe judges the shape only
 * (types, unknown fields). Everything else is a rule of `timeline-rules.ts`, so
 * that all of a request's problems come back together (FR-11, design 7.2): an
 * empty name, a date that is missing or not real, an audience outside the five
 * or out of order, a round that skips. That is why the audience is a plain
 * string and the dates are optional here: a missing date must reach the rules
 * to be named, never be dropped (FR-8).
 */
export class TimelineStepDto implements TimelineStepCommand {
  @ApiProperty({
    type: String,
    maxLength: 120,
    example: 'QA Platform open for assessors',
    description: 'Required; at most 120 characters after trimming',
  })
  @IsString()
  name!: string;

  @ApiProperty({
    type: String,
    enum: stepAudiences,
    example: 'assessors',
    description:
      'Who works in this step. Each audience once, in workflow order: assessors, programs, lead_assessors, tpb, ppu',
  })
  @IsString()
  audience!: string;

  @ApiProperty({
    type: String,
    required: false,
    nullable: true,
    example: '2026-11-10T14:00',
    description:
      'Opening moment, Rome time, `YYYY-MM-DDTHH:mm` (no seconds, no offset). Send this or `opensOn`, not both: send only one key per boundary; a null key counts as sent. The first step cannot open before the current Rome minute, and a step opens after the closing minute of the one before it',
  })
  @IsOptional()
  @IsString()
  opensAt?: string | null;

  @ApiProperty({
    type: String,
    required: false,
    nullable: true,
    example: '2026-11-12T17:30',
    description:
      'Closing moment, Rome time, `YYYY-MM-DDTHH:mm`. Send this or `closesOn`, not both: send only one key per boundary; a null key counts as sent. It is after the opening moment',
  })
  @IsOptional()
  @IsString()
  closesAt?: string | null;

  @ApiProperty({
    type: String,
    format: 'date',
    required: false,
    nullable: true,
    example: '2026-11-02',
    description:
      'Rome calendar day, `YYYY-MM-DD`: the day-only form of the opening, meaning 00:00 that day. Send this or `opensAt`; the first step cannot open before the current Rome minute, and a step opens after the closing minute of the one before it',
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
      'Rome calendar day, `YYYY-MM-DD`: the day-only form of the closing, meaning 23:59 that day. Send this or `closesAt`',
  })
  @IsOptional()
  @IsString()
  closesOn?: string | null;

  @ApiProperty({
    type: Number,
    minimum: 1,
    example: 1,
    description:
      'Round of this step: 1 on the first step, then the same as the step before or one more',
  })
  @IsInt()
  round!: number;

  @ApiProperty({
    type: Boolean,
    example: true,
    description: 'Whether this step needs a load; the first step always does',
  })
  @IsBoolean()
  requiresLoad!: boolean;
}

/**
 * Body of `POST /cycles/:id/timelines` (design 6, `TimelineCreate`). There is
 * no `kind`: the server decides official or additional, and an unknown field is
 * a 400 (FR-5, NFR-2). The two scope lists are optional at the pipe, like the
 * step dates: a list that is absent must reach the rules to be named
 * `REQUIRED` in the same round as the other rule problems (FR-6, FR-11, design
 * 7.2 step 1). A list that is present is still type-checked here.
 */
export class CreateTimelineDto implements CreateTimelineCommand {
  @ApiProperty({
    type: String,
    maxLength: 120,
    example: 'July 2026',
    description:
      'Required; at most 120 characters after trimming; unique in the cycle whatever the letter case',
  })
  @IsString()
  name!: string;

  @ApiProperty({
    type: Boolean,
    example: false,
    description:
      'Every Science Program, also those added to the catalog later. Then `programIds` is empty',
  })
  @IsBoolean()
  allPrograms!: boolean;

  @ApiProperty({
    type: [Number],
    required: false,
    example: [2, 5],
    description:
      'CLARISA ids when `allPrograms` is false; at least one, all in the catalog. Left out or empty is refused as REQUIRED (it never means "all"); with `allPrograms` true it may be left out',
  })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  programIds?: number[] | null;

  @ApiProperty({
    type: Boolean,
    example: false,
    description:
      'Every result type, also those added to the catalog later. Then `resultTypeKeys` is empty',
  })
  @IsBoolean()
  allResultTypes!: boolean;

  @ApiProperty({
    type: [String],
    required: false,
    example: ['INNOVATION_DEV'],
    description:
      'Catalog keys when `allResultTypes` is false; at least one, all in the catalog. Left out or empty is refused as REQUIRED (it never means "all"); with `allResultTypes` true it may be left out',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  resultTypeKeys?: string[] | null;

  @ApiProperty({
    type: [TimelineStepDto],
    minItems: 1,
    maxItems: 5,
    description: 'One to five steps, in workflow order',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TimelineStepDto)
  steps!: TimelineStepDto[];
}
