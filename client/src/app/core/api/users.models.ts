/**
 * Contract of the user-management API (`/api/v1/users`, `/api/v1/catalogs`), copied by hand from
 * `server/src/users/dto/user.models.ts` and `server/src/users/catalogs/catalogs.controller.ts` until a
 * shared package exists (TRD ADR-007): keep it in sync. Dates travel as ISO 8601 strings.
 */

export type RoleCode = 'ADMIN' | 'LEAD_ASSESSOR' | 'ASSESSOR' | 'TPB' | 'PPU';
export type AccountType = 'sso' | 'custom';
export type InvitationState = 'none' | 'sent' | 'existing_account';
export type UserStatus = 'active' | 'inactive';
export type AllOr<T> = 'all' | readonly T[];

export interface RoleGrant {
  readonly role: RoleCode | string;
  /** Only for result-type roles (ASSESSOR, LEAD_ASSESSOR): `all` or catalog keys. */
  readonly resultTypes?: AllOr<string>;
}

export interface UserExclusion {
  readonly id: number;
  /** CLARISA id. */
  readonly programId: number;
  readonly origin: 'manual' | 'reporting';
  readonly reason: string | null;
  readonly since: string;
}

export interface ActorRef {
  readonly id: number;
  readonly nickname: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
}

export interface ExclusionHistoryItem {
  readonly id: number;
  readonly programId: number;
  readonly origin: 'manual' | 'reporting';
  readonly status: 'removed' | 'dismissed';
  readonly reason: string | null;
  readonly reportingRole: string | null;
  readonly since: string;
  readonly createdBy: ActorRef | null;
  readonly endedAt: string | null;
  readonly endedBy: ActorRef | null;
  readonly endReason: string | null;
}

export interface UserSummary {
  readonly id: number;
  readonly email: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly nickname: string | null;
  readonly accountType: AccountType;
  readonly status: UserStatus;
  readonly lastSignInAt: string | null;
  readonly invitation: InvitationState;
  /** Active grants, grouped per role. */
  readonly roles: readonly RoleGrant[];
  /** `all` (no restriction) or the CLARISA ids the user may assess. */
  readonly programs: AllOr<number>;
  /** Active exclusions. */
  readonly exclusions: readonly UserExclusion[];
}

export interface UserDetail extends UserSummary {
  readonly exclusionHistory: readonly ExclusionHistoryItem[];
}

export interface CreateUserBody {
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly nickname: string;
  readonly accountType: AccountType;
  readonly roles?: readonly RoleGrant[];
  readonly programs?: AllOr<number>;
  readonly exclusions?: readonly { readonly programId: number; readonly reason: string }[];
}

export interface EditUserBody {
  readonly nickname?: string;
  readonly firstName?: string;
  readonly lastName?: string;
}

export interface ListUsersQuery {
  readonly q?: string;
  readonly role?: string;
  readonly resultType?: string;
  readonly programId?: number;
  readonly status?: 'active' | 'inactive' | 'all';
  readonly population?: 'team' | 'guests' | 'all';
  readonly hasExclusions?: boolean;
  readonly cursor?: string;
  /** 1–200, default 50. */
  readonly limit?: number;
}

export interface GrantableRole {
  readonly code: RoleCode | string;
  readonly name: string;
  readonly scopeType: 'global' | 'result_type' | 'program';
}

export interface ResultTypeOption {
  readonly key: string;
  readonly name: string;
}

export interface ScienceProgramOption {
  readonly id: number;
  readonly code: string;
  readonly name: string;
}

/** Server error codes the user-management screens branch on (`server/src/users/users.errors.ts`). */
export const USERS_ERROR = {
  NOT_FOUND: 'USERS_NOT_FOUND',
  EMAIL_TAKEN: 'USERS_EMAIL_TAKEN',
  NICKNAME_TAKEN: 'USERS_NICKNAME_TAKEN',
  NAME_LOCKED: 'USERS_NAME_LOCKED',
  ROLE_CONFLICT: 'USERS_ROLE_CONFLICT',
  LAST_ADMIN: 'USERS_LAST_ADMIN',
  EXCLUSION_EXISTS: 'USERS_EXCLUSION_EXISTS',
  EXCLUSION_NOT_FOUND: 'USERS_EXCLUSION_NOT_FOUND',
  EXCLUSION_NOT_MANUAL: 'USERS_EXCLUSION_NOT_MANUAL',
  EXCLUSION_NOT_REPORTING: 'USERS_EXCLUSION_NOT_REPORTING',
  INVITATION_NOT_APPLICABLE: 'USERS_INVITATION_NOT_APPLICABLE',
} as const;
