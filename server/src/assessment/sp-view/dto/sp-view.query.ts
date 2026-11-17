// P2-3911: params and queries of the /sp read routes.
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
import { UNSIGNED_INT_MAX } from '../../../admin-config/cycles/dto/cycle-params.js';
import { QA_STATUSES, type QaStatus } from '../../qa-status.js';

const MAX_CSV_VALUES = 50;

/** `a,b` and a repeated `x=a&x=b` both become a list. */
const toList = ({ value }: { value: unknown }): unknown => {
  if (typeof value === 'string') return value.split(',');
  if (Array.isArray(value)) {
    return value.flatMap((item: unknown) =>
      typeof item === 'string' ? item.split(',') : [item],
    );
  }
  return value;
};

/** `?programId=`: required for an admin SP session, optional (and checked) otherwise. */
export class SpProgramQuery {
  @ApiPropertyOptional({
    type: Number,
    minimum: 1,
    description:
      'CLARISA id of the Science Program. Required for an admin session; a non-admin session may omit it (any other value than its own program is a 404)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(UNSIGNED_INT_MAX)
  programId?: number;
}

/** `GET /sp/timelines/:timelineId/results`: program, and the server-side filters. */
export class SpResultsQuery extends SpProgramQuery {
  @ApiPropertyOptional({
    type: [String],
    enum: QA_STATUSES,
    description: 'QA statuses, comma-separated',
  })
  @IsOptional()
  @Transform(toList)
  @IsArray()
  @ArrayMaxSize(MAX_CSV_VALUES)
  @IsIn(QA_STATUSES, { each: true })
  status?: QaStatus[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Result type keys, comma-separated',
  })
  @IsOptional()
  @Transform(toList)
  @IsArray()
  @ArrayMaxSize(MAX_CSV_VALUES)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  resultTypeKey?: string[];
}

export class SpTimelineParams {
  @ApiProperty({ type: Number, minimum: 1, description: 'Timeline id' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(UNSIGNED_INT_MAX)
  timelineId!: number;
}

export class SpResultParams extends SpTimelineParams {
  @ApiProperty({ type: Number, minimum: 1, description: 'Result code' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(UNSIGNED_INT_MAX)
  resultCode!: number;
}
