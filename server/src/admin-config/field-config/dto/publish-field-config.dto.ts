// @akili-spec admin-config/field-configuration
import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';
import { UNSIGNED_INT_MAX } from '../../cycles/dto/cycle-params.js';

/** Body of `POST /cycles/:id/field-config/publish` (design 6): the revision the admin reviewed. */
export class PublishFieldConfigDto {
  @ApiProperty({
    type: Number,
    minimum: 0,
    example: 7,
    description:
      'The draft revision the admin reviewed in the publish preview (0 for a cycle never edited). When the draft moved since: 409 `FIELD_CONFIG_REVISION_STALE`, nothing is written',
  })
  @IsInt()
  @Min(0)
  @Max(UNSIGNED_INT_MAX)
  revision!: number;
}
