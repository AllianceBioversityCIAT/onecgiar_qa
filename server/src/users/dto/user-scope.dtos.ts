import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, ValidateNested } from 'class-validator';
import { REASON_MAX_LENGTH } from '../users-admin.service.js';
import { RoleGrantDto } from './create-user.dto.js';
import { allOrListSchema, IsAllOrList, TextProp } from './user-fields.js';

/** `PUT /users/:id/roles` (FR-3): the whole list; what is missing is revoked. */
export class ReplaceRolesDto {
  @ApiProperty({
    type: [RoleGrantDto],
    description: 'The complete role list; `[]` revokes every grantable role',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoleGrantDto)
  roles!: RoleGrantDto[];
}

/** `PUT /users/:id/programs` (FR-4). */
export class ReplaceProgramsDto {
  @ApiProperty({
    description:
      '`all` (no restriction, including future programs) or a non-empty list of CLARISA ids',
    example: [1, 2],
    ...allOrListSchema('id'),
  })
  @IsAllOrList('id')
  programs!: 'all' | number[];
}

/** `POST /users/:id/exclusions/:exclusionId/dismiss` (FR-4, DD-12). */
export class DismissExclusionDto {
  @TextProp(REASON_MAX_LENGTH, {
    description: 'Why the Reporting exclusion does not apply',
    example: 'The user did not take part in this program',
  })
  reason!: string;
}
