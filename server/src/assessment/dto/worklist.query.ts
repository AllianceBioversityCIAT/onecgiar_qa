// @akili-spec assessment/step-1-assessment
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { UNSIGNED_INT_MAX } from '../../admin-config/cycles/dto/cycle-params.js';
import { QA_STATUSES, type QaStatus } from '../qa-status.js';
import {
  DEFAULT_WORKLIST_LIMIT,
  MAX_WORKLIST_LIMIT,
} from '../worklist.service.js';
import {
  WORKLIST_SORT_KEYS,
  type SortDirection,
  type WorklistSortKey,
} from '../worklist.store.js';

const MAX_CSV_VALUES = 50;

/** `a,b` and a repeated `x=a&x=b` both become a list; anything else is left for the validators to refuse. */
const toList = ({ value }: { value: unknown }): unknown => {
  if (typeof value === 'string') return value.split(',');
  if (Array.isArray(value)) {
    return value.flatMap((item: unknown) =>
      typeof item === 'string' ? item.split(',') : [item],
    );
  }
  return value;
};

/** A list of positive integers; a value that is not one stays as it came so `isInt` refuses it. */
const toIntList = (params: { value: unknown }): unknown => {
  const list = toList(params);
  return Array.isArray(list)
    ? list.map((item: unknown) =>
        typeof item === 'string' && /^\d+$/.test(item) ? Number(item) : item,
      )
    : list;
};

/** `GET /timelines/:timelineId/worklist` (FR-3, FR-4, FR-7). Anything not listed here is a 400 `UNKNOWN_FIELD`. */
export class ListWorklistQuery {
  @ApiPropertyOptional({
    type: [String],
    enum: QA_STATUSES,
    description:
      'QA statuses, comma-separated. Auto-validated results are hidden unless this names `auto_validated`',
  })
  @IsOptional()
  @Transform(toList)
  @IsArray()
  @ArrayMaxSize(MAX_CSV_VALUES)
  @IsIn(QA_STATUSES, { each: true })
  status?: QaStatus[];

  @ApiPropertyOptional({
    type: [Number],
    description: 'CLARISA program ids, comma-separated',
  })
  @IsOptional()
  @Transform(toIntList)
  @IsArray()
  @ArrayMaxSize(MAX_CSV_VALUES)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(UNSIGNED_INT_MAX, { each: true })
  programId?: number[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Result type keys, comma-separated',
  })
  @IsOptional()
  @Transform(toList)
  @IsArray()
  @ArrayMaxSize(MAX_CSV_VALUES)
  @IsString({ each: true })
  @MaxLength(255, { each: true, context: { max: 255 } })
  resultTypeKey?: string[];

  @ApiPropertyOptional({
    type: String,
    maxLength: 200,
    description: 'Result code (exact or prefix) or title (contains)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200, { context: { max: 200 } })
  q?: string;

  @ApiPropertyOptional({
    type: String,
    enum: WORKLIST_SORT_KEYS,
    default: 'code',
  })
  @IsOptional()
  @IsIn(WORKLIST_SORT_KEYS)
  sort?: WorklistSortKey;

  @ApiPropertyOptional({
    type: String,
    enum: ['asc', 'desc'],
    default: 'asc',
  })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  dir?: SortDirection;

  @ApiPropertyOptional({
    type: Number,
    minimum: 1,
    maximum: MAX_WORKLIST_LIMIT,
    default: DEFAULT_WORKLIST_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_WORKLIST_LIMIT)
  limit?: number;

  @ApiPropertyOptional({
    type: String,
    maxLength: 512,
    description:
      '`meta.page.nextCursor` of the previous page; valid only with the same `sort` and `dir`',
  })
  @IsOptional()
  @IsString()
  @MaxLength(512, { context: { max: 512 } })
  cursor?: string;
}
