import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, ValidateNested } from 'class-validator';
import { ExclusionDto, RoleGrantDto } from './create-user.dto.js';
import { EditUserDto } from './edit-user.dto.js';
import { allOrListSchema, IsAllOrList } from './user-fields.js';

/**
 * `PUT /users/:id` (FR-8): the whole editable state of one person. The three
 * optional name fields are `EditUserDto`'s, with the same validators; roles,
 * programs and the desired MANUAL exclusions are the complete truth, so each
 * is required. An unknown field is an `UNKNOWN_FIELD` 400 (global pipe).
 */
export class ReplaceUserDto extends EditUserDto {
  @ApiProperty({
    type: [RoleGrantDto],
    description: 'The complete role list; `[]` revokes every grantable role',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoleGrantDto)
  roles!: RoleGrantDto[];

  @ApiProperty({
    description:
      '`all` (no restriction, including future programs) or a non-empty list of CLARISA ids',
    example: [1, 2],
    ...allOrListSchema('id'),
  })
  @IsAllOrList('id')
  programs!: 'all' | number[];

  @ApiProperty({
    type: [ExclusionDto],
    description:
      'The complete list of MANUAL exclusions the person must have: missing ones are added with their reason, manual ones absent from the list are removed, and an existing one keeps its original reason even when the list sends another. A program listed twice is a 400. Exclusions that come from Reporting are never changed here',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExclusionDto)
  exclusions!: ExclusionDto[];
}
