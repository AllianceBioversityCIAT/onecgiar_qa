// @akili-spec admin-config/cycle-timelines
import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsString, Max, Min } from 'class-validator';
import { UNSIGNED_INT_MAX } from '../../cycles/dto/cycle-params.js';
import { ASSIGNABLE_ROLES, type AssignableRole } from '../timeline-response.js';

/**
 * `POST /timelines/:id/users` (design 6, FR-14). The role is checked at the pipe
 * against the four assignable roles, so ADMIN, PROGRAM or anything else is a 400
 * before any lookup runs.
 */
export class AssignTimelineUserDto {
  @ApiProperty({ type: Number, minimum: 1, example: 7, description: 'User id' })
  @IsInt()
  @Min(1)
  @Max(UNSIGNED_INT_MAX)
  userId!: number;

  @ApiProperty({
    type: String,
    enum: ASSIGNABLE_ROLES,
    example: 'ASSESSOR',
    description:
      'The role the user is assigned with; she must hold a live grant of it',
  })
  @IsString()
  @IsIn(ASSIGNABLE_ROLES)
  role!: AssignableRole;
}
