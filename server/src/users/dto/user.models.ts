import { ApiProperty } from '@nestjs/swagger';
import type {
  ActorRef,
  ExclusionHistoryItem,
  UserDetail,
  UserSummary,
} from '../users-query.repository.js';
import type {
  AuthSource,
  InvitationState,
} from '../../database/drizzle/schema/users.js';
import { allOrListSchema } from './user-fields.js';

// OpenAPI models of the answers (design 6). Dates leave as ISO 8601 strings.

export class UserRoleModel {
  @ApiProperty({ type: String, example: 'ASSESSOR' })
  role!: string;

  @ApiProperty({
    required: false,
    description: 'Only for result-type roles: `all` or the result type keys',
    example: ['innovation_development'],
    ...allOrListSchema('text'),
  })
  resultTypes?: 'all' | string[];
}

export class UserExclusionModel {
  @ApiProperty({ type: Number, example: 7 })
  id!: number;

  @ApiProperty({ type: Number, example: 3, description: 'CLARISA id' })
  programId!: number;

  @ApiProperty({ type: String, enum: ['manual', 'reporting'] })
  origin!: 'manual' | 'reporting';

  @ApiProperty({ type: String, nullable: true })
  reason!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  since!: Date;
}

export class ActorRefModel implements ActorRef {
  @ApiProperty({ type: Number })
  id!: number;

  @ApiProperty({ type: String, nullable: true })
  nickname!: string | null;

  @ApiProperty({ type: String, nullable: true })
  firstName!: string | null;

  @ApiProperty({ type: String, nullable: true })
  lastName!: string | null;
}

export class ExclusionHistoryModel implements ExclusionHistoryItem {
  @ApiProperty({ type: Number })
  id!: number;

  @ApiProperty({ type: Number })
  programId!: number;

  @ApiProperty({ type: String, enum: ['manual', 'reporting'] })
  origin!: 'manual' | 'reporting';

  @ApiProperty({ type: String, enum: ['removed', 'dismissed'] })
  status!: 'removed' | 'dismissed';

  @ApiProperty({ type: String, nullable: true })
  reason!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Role in Reporting',
  })
  reportingRole!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  since!: Date;

  @ApiProperty({ type: ActorRefModel, nullable: true })
  createdBy!: ActorRef | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  endedAt!: Date | null;

  @ApiProperty({
    type: ActorRefModel,
    nullable: true,
    description: 'null = the system',
  })
  endedBy!: ActorRef | null;

  @ApiProperty({ type: String, nullable: true })
  endReason!: string | null;
}

export class UserSummaryModel implements UserSummary {
  @ApiProperty({ type: Number, example: 12 })
  id!: number;

  @ApiProperty({ type: String, example: 'ada@cgiar.org' })
  email!: string;

  @ApiProperty({ type: String, nullable: true })
  firstName!: string | null;

  @ApiProperty({ type: String, nullable: true })
  lastName!: string | null;

  @ApiProperty({ type: String, nullable: true })
  nickname!: string | null;

  @ApiProperty({ type: String, enum: ['sso', 'custom'] })
  accountType!: AuthSource;

  @ApiProperty({ type: String, enum: ['active', 'inactive'] })
  status!: 'active' | 'inactive';

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastSignInAt!: Date | null;

  @ApiProperty({
    type: String,
    enum: ['none', 'sent', 'existing_account'],
    description: 'State of the Cognito invitation of a custom account',
  })
  invitation!: InvitationState;

  @ApiProperty({
    type: [UserRoleModel],
    description: 'Active grants, grouped per role',
  })
  roles!: UserRoleModel[];

  @ApiProperty({
    description:
      '`all` (no restriction) or the CLARISA ids the user may assess',
    example: 'all',
    ...allOrListSchema('id'),
  })
  programs!: 'all' | number[];

  @ApiProperty({ type: [UserExclusionModel], description: 'Active exclusions' })
  exclusions!: UserExclusionModel[];
}

export class UserDetailModel extends UserSummaryModel implements UserDetail {
  @ApiProperty({
    type: [ExclusionHistoryModel],
    description: 'Removed and dismissed exclusions, with who, when and why',
  })
  exclusionHistory!: ExclusionHistoryModel[];
}
