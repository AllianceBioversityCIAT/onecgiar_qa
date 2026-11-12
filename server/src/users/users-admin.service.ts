import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import type { IdempotencyHandle } from '../common/idempotency/idempotency.context.js';
import { CognitoAdminClient } from '../auth/cognito-admin.client.js';
import { UpstreamUnavailableError } from '../auth/cognito-auth.client.js';
import type { UserAuditChanges } from '../database/drizzle/schema/user-audit-events.js';
import type {
  InvitationState,
  User,
} from '../database/drizzle/schema/users.js';
import type {
  AccessRoleLine,
  SignInPath,
} from '../notifications/access-email.js';
import {
  type AccessChange,
  AccessNotifier,
} from '../notifications/access-notifier.service.js';
import { CatalogService } from './catalogs/catalog.service.js';
import { CurrentUserCache, isLiveAssignment } from './current-user.cache.js';
import {
  findRoleDefinition,
  GRANTABLE_ROLES,
  isGrantableRole,
  RoleCode,
} from './permissions.js';
import type { UserAuditAction } from '../database/drizzle/schema/user-audit-events.js';
import {
  lockTargetUser,
  USERS_ADMIN_UNIT_OF_WORK,
  type UsersAdminRepositories,
  type UsersAdminUnitOfWork,
} from './users-admin.unit-of-work.js';
import {
  DuplicateUserError,
  EmailTakenError,
  ExclusionExistsError,
  FieldValidationError,
  InvalidEmailError,
  InvitationNotApplicableError,
  NameLockedError,
  NicknameTakenError,
  type FieldIssue,
} from './users.errors.js';
import { normalizeEmail, UsersRepository } from './users.repository.js';

/** Who acts, and under which request: every audit event and log line carries both (FR-13). */
export interface AdminContext {
  actorId: number;
  requestId: string | null;
  /**
   * The keyed request's handle (design 7, P-5), set by the controller from
   * `@CurrentIdempotency()`. Absent = no `Idempotency-Key`: nothing is marked
   * and behavior is exactly as before (FR-1).
   */
  idempotency?: IdempotencyHandle;
}

export type AccountType = 'sso' | 'custom';

/**
 * One role of a user as the API groups it (design 6): global roles carry no
 * `resultTypes`; ASSESSOR and LEAD_ASSESSOR carry `'all'` or the result type
 * keys. One entry per role: the `*` sentinel is internal, never sent by a client.
 */
export interface RoleGrantInput {
  role: string;
  resultTypes?: 'all' | string[] | null;
}

export type ProgramScopeInput = 'all' | number[];

export interface ExclusionInput {
  programId: number;
  reason: string;
}

export interface CreateUserCommand {
  email: string;
  firstName: string;
  lastName: string;
  nickname: string;
  accountType: AccountType;
  roles?: RoleGrantInput[];
  programs?: ProgramScopeInput;
  exclusions?: ExclusionInput[];
}

/** Email is not here: it never changes (FR-5). */
export interface EditUserPatch {
  nickname?: string;
  firstName?: string;
  lastName?: string;
}

/**
 * The editable state of one person for `replaceUser` (FR-8): the patch fields
 * are optional, the rest is the full desired state. `exclusions` is the
 * desired MANUAL set; `reporting` exclusions are never part of it (D4).
 */
export interface ReplaceUserCommand extends EditUserPatch {
  roles: RoleGrantInput[];
  programs: ProgramScopeInput;
  exclusions: ExclusionInput[];
}

/** `changed` = false when the request asked for what already holds: nothing was written. */
export interface UserChangeResult {
  userId: number;
  changed: boolean;
}

export interface CreatedUser {
  userId: number;
  invitation: InvitationState;
}

export const NICKNAME_MAX_LENGTH = 50;
export const NAME_MAX_LENGTH = 100;
export const REASON_MAX_LENGTH = 500;
const ALL_RESULT_TYPES = '*';
export const UNSIGNED_INT_MAX = 4294967295;

/** NFR-3: one budget for everything QA asks Cognito inside one request. */
export const COGNITO_BUDGET_MS = 10_000;

type LogAction =
  | 'create'
  | 'edit'
  | 'replace'
  | 'roles'
  | 'programs'
  | 'exclusion_add'
  | 'exclusion_remove'
  | 'exclusion_dismiss'
  | 'deactivate'
  | 'activate'
  | 'invitation_resend';

/** One grant of the diff: `resultTypeKey` is `'*'` for "all result types", null for a global role. */
interface Grant {
  roleCode: string;
  resultTypeKey: string | null;
}

/** A committed role change, for the access email: the grants before and after. */
interface RoleChange {
  target: User;
  before: Grant[];
  after: Grant[];
}

/** Grants grouped per role for the email, in catalog order of the roles. */
function roleLines(
  grants: readonly Grant[],
  names: ReadonlyMap<string, string>,
): AccessRoleLine[] {
  const byRole = new Map<string, Grant[]>();
  for (const grant of grants) {
    byRole.set(grant.roleCode, [...(byRole.get(grant.roleCode) ?? []), grant]);
  }
  return [...byRole.entries()].map(([code, held]) => {
    const role = findRoleDefinition(code)?.name ?? code;
    if (held.every((g) => g.resultTypeKey === null)) {
      return { role, resultTypes: null };
    }
    if (held.some((g) => g.resultTypeKey === ALL_RESULT_TYPES)) {
      return { role, resultTypes: 'all' };
    }
    return {
      role,
      resultTypes: held
        .map((g) => g.resultTypeKey!)
        .map((key) => names.get(key) ?? key)
        .sort((a, b) => a.localeCompare(b)),
    };
  });
}

const grantKey = (roleCode: string, resultTypeKey: string | null) =>
  `${roleCode}|${resultTypeKey ?? ''}`;

const scopeLabel = (resultTypeKey: string | null) =>
  resultTypeKey === ALL_RESULT_TYPES ? 'all' : resultTypeKey;

/** The grant as an audit entry: `{ role, resultType? }`, with `all` for the sentinel. */
function grantChanges(
  roleCode: string,
  resultTypeKey: string | null,
  side: 'before' | 'after',
): UserAuditChanges {
  const empty = side === 'before' ? 'after' : 'before';
  return {
    role: { [side]: roleCode, [empty]: null } as {
      before: unknown;
      after: unknown;
    },
    ...(resultTypeKey === null
      ? {}
      : {
          resultType: {
            [side]: scopeLabel(resultTypeKey),
            [empty]: null,
          } as { before: unknown; after: unknown },
        }),
  };
}

const isPositiveId = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 1 &&
  value <= UNSIGNED_INT_MAX;

/** Errors whose decision line carries a fixed reason instead of the one derived from the error (one line per mutation). */
const FORCED_LOG_REASONS = new WeakMap<object, string>();

/** Design 7, `UsersAdminService`: every admin mutation of a user, its audit trail and its cache invalidation. */
@Injectable()
export class UsersAdminService {
  private readonly logger = new Logger(UsersAdminService.name);

  constructor(
    @Inject(USERS_ADMIN_UNIT_OF_WORK)
    private readonly unitOfWork: UsersAdminUnitOfWork,
    @Inject(UsersRepository) private readonly users: UsersRepository,
    @Inject(CatalogService) private readonly catalogs: CatalogService,
    @Inject(CognitoAdminClient) private readonly cognito: CognitoAdminClient,
    @Inject(CurrentUserCache) private readonly cache: CurrentUserCache,
    @Inject(AccessNotifier) private readonly notifier: AccessNotifier,
  ) {}

  // -------------------------------------------------------------------------
  // Create (FR-2, DD-7)
  // -------------------------------------------------------------------------

  /**
   * Order is the design's: validate (shape, then catalog references) →
   * uniqueness pre-check → Cognito (custom only, one 10 s budget) → ONE
   * transaction with the user, its grants, scope, exclusions and audit. A
   * failure after Cognito leaves no QA row: the account may stay in the pool
   * and shows as `existing_account` on retry (DD-7, accepted).
   */
  create(ctx: AdminContext, command: CreateUserCommand): Promise<CreatedUser> {
    return this.logged(
      'create',
      ctx,
      null,
      async () => {
        const input = await this.validateCreate(command);

        if (await this.users.findByEmail(input.email))
          throw new EmailTakenError();
        if (await this.users.findByNickname(input.nickname)) {
          throw new NicknameTakenError();
        }

        const invitation = await this.invite(input);

        const created = await this.unitOfWork.run(async (repos) => {
          const user = await this.insertUser(repos, ctx, input, invitation);
          await this.audit(repos, ctx, user.id, 'create', {
            email: { before: null, after: input.email },
            firstName: { before: null, after: input.firstName },
            lastName: { before: null, after: input.lastName },
            nickname: { before: null, after: input.nickname },
            accountType: { before: null, after: input.accountType },
          });
          await this.applyRoles(repos, ctx, user, input.grants);
          if (input.programs.length > 0) {
            const { before, after } = await repos.programs.replaceScope(
              user.id,
              input.programs,
            );
            await this.audit(repos, ctx, user.id, 'scope_change', {
              programs: {
                before: this.scopeOf(before),
                after: this.scopeOf(after),
              },
            });
          }
          for (const exclusion of input.exclusions) {
            await this.insertExclusion(repos, ctx, user.id, exclusion);
          }
          // The transaction that follows the Cognito call: the user, its
          // audit rows and the mark commit together (design 7).
          await this.markExecuted(repos, ctx, user.id);
          return { userId: user.id, invitation: invitation.state };
        });
        // After the commit: the email never decides the outcome.
        await this.announce({
          kind: 'granted',
          email: input.email,
          firstName: input.firstName,
          grants: input.grants,
          signIn:
            input.accountType === 'sso'
              ? 'sso'
              : invitation.state === 'sent'
                ? 'temporary_password'
                : 'existing_password',
        });
        return created;
      },
      (result) => result.userId,
    );
  }

  // -------------------------------------------------------------------------
  // Edit (FR-5, DD-8)
  // -------------------------------------------------------------------------

  /** Nickname any time; first and last name only while the user has never signed in; never the email. */
  edit(
    ctx: AdminContext,
    userId: number,
    patch: EditUserPatch,
  ): Promise<UserChangeResult> {
    return this.logged('edit', ctx, userId, async () => {
      const wanted = this.validatePatch(patch);
      return this.mutate(ctx, userId, (repos, target) =>
        this.applyEdit(repos, ctx, target, wanted),
      );
    });
  }

  /**
   * The aggregate edit (FR-8, design 7): validate everything first, outside
   * the transaction, then ONE `mutate` applies edit -> roles -> programs ->
   * exclusions through the same helpers the separate routes call, so a
   * refusal anywhere rolls the whole save back and the rules cannot drift.
   */
  replaceUser(
    ctx: AdminContext,
    userId: number,
    command: ReplaceUserCommand,
  ): Promise<UserChangeResult> {
    return this.logged('replace', ctx, userId, async () => {
      const issues: FieldIssue[] = [];
      const wanted = this.shapePatch(command, issues);
      const shape = this.shapeState(
        command.roles,
        command.programs,
        command.exclusions,
        issues,
      );
      if (issues.length > 0) throw new FieldValidationError(issues);
      await this.checkShapeCatalogs(shape, issues);
      if (issues.length > 0) throw new FieldValidationError(issues);

      const grants = shape.grants.map((g) => g.grant);
      const exclusions = shape.exclusions as ExclusionInput[];
      let change: RoleChange | undefined;
      const result = await this.mutate(ctx, userId, async (repos, target) => {
        // No short-circuit: every part runs, and any of them may be the refusal.
        const edited = await this.applyEdit(repos, ctx, target, wanted);
        const before = await this.heldGrants(repos, target.id);
        const roled = await this.applyRoles(repos, ctx, target, grants);
        if (roled) {
          change = {
            target,
            before,
            after: await this.heldGrants(repos, target.id),
          };
        }
        const scoped = await this.applyPrograms(
          repos,
          ctx,
          target,
          shape.programs,
        );
        const reconciled = await this.reconcileExclusions(
          repos,
          ctx,
          target,
          exclusions,
        );
        return edited || roled || scoped || reconciled;
      });
      if (change) await this.announceRoleChange(ctx, change);
      return result;
    });
  }

  // -------------------------------------------------------------------------
  // Roles (FR-3)
  // -------------------------------------------------------------------------

  /** Replaces the user's grantable roles by diff: removed grants are revoked first, new ones inserted, unchanged ones untouched. */
  replaceRoles(
    ctx: AdminContext,
    userId: number,
    roles: RoleGrantInput[],
  ): Promise<UserChangeResult> {
    return this.logged('roles', ctx, userId, async () => {
      const grants = await this.validateRoles(roles);
      let change: RoleChange | undefined;
      const result = await this.mutate(ctx, userId, async (repos, target) => {
        const before = await this.heldGrants(repos, target.id);
        const roled = await this.applyRoles(repos, ctx, target, grants);
        if (roled) {
          change = {
            target,
            before,
            after: await this.heldGrants(repos, target.id),
          };
        }
        return roled;
      });
      if (change) await this.announceRoleChange(ctx, change);
      return result;
    });
  }

  // -------------------------------------------------------------------------
  // Program scope and exclusions (FR-4)
  // -------------------------------------------------------------------------

  replacePrograms(
    ctx: AdminContext,
    userId: number,
    programs: ProgramScopeInput,
  ): Promise<UserChangeResult> {
    return this.logged('programs', ctx, userId, async () => {
      const ids = await this.validatePrograms(programs, 'programs');
      return this.mutate(ctx, userId, (repos, target) =>
        this.applyPrograms(repos, ctx, target, ids),
      );
    });
  }

  addExclusion(
    ctx: AdminContext,
    userId: number,
    exclusion: ExclusionInput,
  ): Promise<UserChangeResult> {
    return this.logged('exclusion_add', ctx, userId, async () => {
      const [clean] = await this.validateExclusions([exclusion], '');
      return this.mutate(ctx, userId, async (repos, target) => {
        await this.insertExclusion(repos, ctx, target.id, clean!);
        return true;
      });
    });
  }

  /** Manual exclusions only; the acting admin is always `ended_by` (DD-12). */
  removeExclusion(
    ctx: AdminContext,
    userId: number,
    exclusionId: number,
  ): Promise<UserChangeResult> {
    return this.logged('exclusion_remove', ctx, userId, () =>
      this.mutate(ctx, userId, async (repos, target) => {
        await this.removeManualExclusion(repos, ctx, target.id, exclusionId);
        return true;
      }),
    );
  }

  /** Reporting exclusions only, with a mandatory reason; the acting admin is always `ended_by` (DD-12). */
  dismissExclusion(
    ctx: AdminContext,
    userId: number,
    exclusionId: number,
    reason: string,
  ): Promise<UserChangeResult> {
    return this.logged('exclusion_dismiss', ctx, userId, async () => {
      const issues: FieldIssue[] = [];
      const cleanReason = this.cleanReason(reason, 'reason', issues);
      if (issues.length > 0) throw new FieldValidationError(issues);
      return this.mutate(ctx, userId, async (repos, target) => {
        const ended = await repos.programs.dismissReportingExclusion({
          userId: target.id,
          exclusionId,
          endedBy: ctx.actorId,
          reason: cleanReason!,
        });
        await this.audit(repos, ctx, target.id, 'exclusion_dismiss', {
          exclusion: {
            before: {
              id: ended.id,
              programId: ended.programId,
              status: 'active',
            },
            after: {
              id: ended.id,
              programId: ended.programId,
              status: ended.status,
              endReason: ended.endReason,
            },
          },
        });
        return true;
      });
    });
  }

  // -------------------------------------------------------------------------
  // Activation (FR-7)
  // -------------------------------------------------------------------------

  /**
   * Deactivates the user in QA only: their Cognito account is never touched
   * (the pool is shared). Deactivating an active ADMIN passes the last-admin
   * guard first, oneself included.
   */
  deactivate(ctx: AdminContext, userId: number): Promise<UserChangeResult> {
    return this.logged('deactivate', ctx, userId, async () => {
      let removed: { target: User; grants: Grant[] } | undefined;
      const result = await this.mutate(ctx, userId, async (repos, target) => {
        if (!target.isActive) return false;
        const views = await repos.assignments.findActiveViewsByUserId(
          target.id,
        );
        if (
          views.some(
            (view) =>
              view.roleCode === RoleCode.ADMIN && isLiveAssignment(view),
          )
        ) {
          await repos.admins.assertAnotherAdminRemains(target.id);
        }
        await repos.users.update(target.id, { isActive: false });
        await this.audit(repos, ctx, target.id, 'deactivate', {
          isActive: { before: true, after: false },
        });
        removed = { target, grants: await this.heldGrants(repos, target.id) };
        return true;
      });
      // Only someone who could use QA is told they no longer can.
      if (removed && removed.grants.length > 0) {
        await this.announce({
          kind: 'removed',
          email: removed.target.email,
          firstName: removed.target.firstName,
          grants: [],
          signIn: this.signInOf(removed.target),
        });
      }
      return result;
    });
  }

  /**
   * Reactivates the user. A custom user whose Cognito account is gone (removed
   * from the shared pool meanwhile) gets it back first: `AdminCreateUser`
   * emails a temporary password, and the stale `cognito_sub` is cleared in the
   * same transaction so the next sign-in links the new account by its verified
   * email (admission step 2). A Cognito failure (503) writes nothing.
   */
  activate(ctx: AdminContext, userId: number): Promise<UserChangeResult> {
    return this.logged('activate', ctx, userId, async () => {
      const current = await this.users.findById(userId);
      const account =
        current && !current.isActive && current.authSource === 'custom'
          ? await this.ensureCognitoAccount(current)
          : null;
      let granted: { target: User; grants: Grant[] } | undefined;
      const result = await this.mutate(ctx, userId, async (repos, target) => {
        if (target.isActive) return false;
        await repos.users.update(target.id, { isActive: true });
        await this.audit(repos, ctx, target.id, 'reactivate', {
          isActive: { before: false, after: true },
        });
        if (account === 'created') {
          await this.recordRecreatedAccount(repos, ctx, target);
        }
        granted = { target, grants: await this.heldGrants(repos, target.id) };
        return true;
      });
      if (granted && granted.grants.length > 0) {
        await this.announce({
          kind: 'granted',
          email: granted.target.email,
          firstName: granted.target.firstName,
          grants: granted.grants,
          signIn: this.signInOf(granted.target, account),
        });
      }
      return result;
    });
  }

  // -------------------------------------------------------------------------
  // Invitation (FR-8)
  // -------------------------------------------------------------------------

  /**
   * For an active custom user who has no password yet, or whose Cognito
   * account is gone (DD-7 amended): Cognito first, then the audited write.
   * - no account in the pool → `AdminCreateUser` (new temporary password), the
   *   stale `cognito_sub` is cleared and the person gets the access email;
   * - `FORCE_CHANGE_PASSWORD` → `RESEND` (new temporary password);
   * - any other state → 409: the person has a password ("Forgot password?").
   */
  resendInvitation(
    ctx: AdminContext,
    userId: number,
  ): Promise<UserChangeResult> {
    return this.logged('invitation_resend', ctx, userId, async () => {
      const current = await this.users.findById(userId);
      if (!current) {
        // Same 404 as every other action; the row lock below would say it too.
        return this.mutate(ctx, userId, async () => false);
      }
      this.assertInvitable(current);

      const account = await this.ensureCognitoAccount(current);
      if (account === 'present') {
        throw new InvitationNotApplicableError(
          'the account already has a password',
        );
      }
      if (account === 'pending') {
        const outcome = await this.withinCognitoBudget(() =>
          this.cognito.resendInvitation(current.email),
        );
        if (outcome === 'not_applicable') {
          throw new InvitationNotApplicableError(
            'Cognito has nothing to resend',
          );
        }
      }

      let granted: { target: User; grants: Grant[] } | undefined;
      try {
        const result = await this.mutate(ctx, userId, async (repos, target) => {
          this.assertInvitable(target);
          if (account === 'created') {
            await this.recordRecreatedAccount(repos, ctx, target);
            granted = {
              target,
              grants: await this.heldGrants(repos, target.id),
            };
            return true;
          }
          const invitedAt = new Date();
          await repos.users.update(target.id, {
            invitedAt,
            invitation: 'sent',
          });
          await this.audit(repos, ctx, target.id, 'invitation_resend', {
            invitedAt: {
              before: target.invitedAt?.toISOString() ?? null,
              after: invitedAt.toISOString(),
            },
            ...(target.invitation === 'sent'
              ? {}
              : { invitation: { before: target.invitation, after: 'sent' } }),
          });
          return true;
        });
        if (granted && granted.grants.length > 0) {
          await this.announce({
            kind: 'granted',
            email: granted.target.email,
            firstName: granted.target.firstName,
            grants: granted.grants,
            signIn: 'temporary_password',
          });
        }
        return result;
      } catch (error) {
        // Cognito already sent the email but QA could not record it (the user
        // was deactivated meanwhile, or the write failed). The reason rides on
        // the error so `logged` writes ONE line (design 7 Logging).
        if (typeof error === 'object' && error !== null) {
          FORCED_LOG_REASONS.set(error, 'cognito_sent_not_recorded');
        }
        throw error;
      }
    });
  }

  // -------------------------------------------------------------------------
  // Shared steps
  // -------------------------------------------------------------------------

  /**
   * Design 7 steps 1 and the cache rule: lock the target (404 when absent),
   * run `apply` in the same transaction, and only AFTER the commit invalidate
   * the target in the cache (FR-6). A refusal or a rollback never reaches it.
   * `apply` answers whether it changed anything.
   */
  private async mutate(
    ctx: AdminContext,
    userId: number,
    apply: (repos: UsersAdminRepositories, target: User) => Promise<boolean>,
  ): Promise<UserChangeResult> {
    const changed = await this.unitOfWork.run(async (repos) => {
      const target = await lockTargetUser(repos, userId);
      const result = await apply(repos, target);
      // After the last write, still inside the transaction: a refusal above
      // never marks, and a lost fence rolls the whole change back, so nothing
      // is audited or invalidated (design 7, DD-2; FR-2, FR-5). A request that
      // changed nothing marks too: its answer is still deterministic.
      await this.markExecuted(repos, ctx, userId);
      return result;
    });
    if (changed) this.cache.invalidate(userId);
    return { userId, changed };
  }

  /**
   * The exactly-once fence (design 7): `in_progress` -> `executed` for a keyed
   * request, conditioned on still owning the key, in the business transaction.
   * It throws `IdempotencyFenceLostError` when a take-over got the key first.
   * No handle (no `Idempotency-Key`) = nothing to mark (FR-1).
   */
  private async markExecuted(
    repos: UsersAdminRepositories,
    ctx: AdminContext,
    targetUserId: number,
  ): Promise<void> {
    if (ctx.idempotency === undefined) return;
    await repos.idempotency.markExecuted(
      ctx.idempotency.reservation,
      targetUserId,
    );
  }

  private audit(
    repos: UsersAdminRepositories,
    ctx: AdminContext,
    userId: number,
    action: UserAuditAction,
    changes: UserAuditChanges,
  ) {
    return repos.audit.record({
      userId,
      actorId: ctx.actorId,
      action,
      changes,
      requestId: ctx.requestId,
    });
  }

  /** Roles by diff (FR-3, design 7 step 3): revoke what is gone BEFORE inserting what is new (Assessor KP → Lead KP), the last-admin guard before any insert. */
  private async applyRoles(
    repos: UsersAdminRepositories,
    ctx: AdminContext,
    target: User,
    grants: readonly Grant[],
  ): Promise<boolean> {
    // Plain read: this transaction holds the user row lock, and every other writer of this user's grants waits for it.
    const current = (
      await repos.assignments.findActiveByUserId(target.id)
    ).filter(
      // PROGRAM grants are not managed here (D6): the replacement never touches them.
      (assignment) => isGrantableRole(assignment.roleCode),
    );
    const wanted = new Set(
      grants.map((g) => grantKey(g.roleCode, g.resultTypeKey)),
    );
    const held = new Set(
      current.map((a) => grantKey(a.roleCode, a.resultTypeKey)),
    );
    const toRevoke = current.filter(
      (a) => !wanted.has(grantKey(a.roleCode, a.resultTypeKey)),
    );
    const toGrant = grants.filter(
      (g) => !held.has(grantKey(g.roleCode, g.resultTypeKey)),
    );
    if (toRevoke.length === 0 && toGrant.length === 0) return false;

    // Before the first insert: an insert takes a shared lock on `roles` through its foreign key, and a later exclusive request on the ADMIN row could deadlock (design 7, lock order).
    if (
      target.isActive &&
      toRevoke.some((a) => a.roleCode === RoleCode.ADMIN)
    ) {
      await repos.admins.assertAnotherAdminRemains(target.id);
    }
    for (const assignment of toRevoke) {
      await repos.assignments.revoke(assignment.id, ctx.actorId);
      await this.audit(
        repos,
        ctx,
        target.id,
        'role_revoke',
        grantChanges(assignment.roleCode, assignment.resultTypeKey, 'before'),
      );
    }
    for (const grant of toGrant) {
      await repos.assignments.create({
        userId: target.id,
        roleCode: grant.roleCode,
        resultTypeKey: grant.resultTypeKey,
        createdBy: ctx.actorId,
      });
      await this.audit(
        repos,
        ctx,
        target.id,
        'role_grant',
        grantChanges(grant.roleCode, grant.resultTypeKey, 'after'),
      );
    }
    return true;
  }

  /** Nickname / names by diff (FR-5). The patch is already validated; `false` = nothing differs, nothing written. */
  private async applyEdit(
    repos: UsersAdminRepositories,
    ctx: AdminContext,
    target: User,
    wanted: EditUserPatch,
  ): Promise<boolean> {
    const changes: UserAuditChanges = {};
    const values: {
      nickname?: string;
      firstName?: string;
      lastName?: string;
    } = {};
    for (const field of ['firstName', 'lastName', 'nickname'] as const) {
      const next = wanted[field];
      if (next === undefined || next === target[field]) continue;
      values[field] = next;
      changes[field] = { before: target[field], after: next };
    }
    if (Object.keys(values).length === 0) return false;

    // Name rule (FR-5): after the first sign-in the identity provider owns the name.
    if (
      (values.firstName !== undefined || values.lastName !== undefined) &&
      target.lastLoginAt !== null
    ) {
      throw new NameLockedError();
    }
    if (values.nickname !== undefined) {
      // A plain read (DD-15): only the target row is locked; a concurrent
      // winner is caught by the unique index at the write below.
      const holder = await repos.users.findByNickname(values.nickname);
      if (holder && holder.id !== target.id) throw new NicknameTakenError();
    }
    try {
      await repos.users.update(target.id, values);
    } catch (error) {
      // Email is not in `values`, so the only unique key left to clash is the nickname.
      if (error instanceof DuplicateUserError) throw new NicknameTakenError();
      throw error;
    }
    await this.audit(repos, ctx, target.id, 'update', changes);
    return true;
  }

  /** Program scope by diff (FR-4); `ids` empty = all programs. */
  private async applyPrograms(
    repos: UsersAdminRepositories,
    ctx: AdminContext,
    target: User,
    ids: readonly number[],
  ): Promise<boolean> {
    const { before, after } = await repos.programs.replaceScope(target.id, ids);
    if (before.join() === after.join()) return false;
    await this.audit(repos, ctx, target.id, 'scope_change', {
      programs: {
        before: this.scopeOf(before),
        after: this.scopeOf(after),
      },
    });
    return true;
  }

  /** Ends one active MANUAL exclusion; the acting admin is `ended_by` (DD-12). */
  private async removeManualExclusion(
    repos: UsersAdminRepositories,
    ctx: AdminContext,
    userId: number,
    exclusionId: number,
  ): Promise<void> {
    const ended = await repos.programs.removeManualExclusion({
      userId,
      exclusionId,
      endedBy: ctx.actorId,
    });
    await this.audit(repos, ctx, userId, 'exclusion_remove', {
      exclusion: {
        before: { id: ended.id, programId: ended.programId, status: 'active' },
        after: {
          id: ended.id,
          programId: ended.programId,
          status: ended.status,
        },
      },
    });
  }

  /**
   * Aggregate exclusions (design 7, DD-8): `desired` is the manual set. A
   * listed program with an active manual exclusion keeps it as is (its reason
   * is a creation-time fact); one with an active `reporting` exclusion is
   * refused like `addExclusion` would; a missing one is added; an active
   * manual one that is not listed is removed. `reporting` rows are never
   * touched here (D4).
   */
  private async reconcileExclusions(
    repos: UsersAdminRepositories,
    ctx: AdminContext,
    target: User,
    desired: readonly ExclusionInput[],
  ): Promise<boolean> {
    const active = (
      await repos.programs.findExclusions(target.id, { forUpdate: true })
    ).filter((row) => row.status === 'active');
    const wanted = new Set(desired.map((e) => e.programId));
    const held = new Map(active.map((row) => [row.programId, row]));
    const toAdd = desired.filter((e) => {
      const row = held.get(e.programId);
      if (row?.origin === 'reporting') throw new ExclusionExistsError();
      return row === undefined;
    });
    const toRemove = active.filter(
      (row) => row.origin === 'manual' && !wanted.has(row.programId),
    );
    for (const exclusion of toAdd) {
      await this.insertExclusion(repos, ctx, target.id, exclusion);
    }
    for (const row of toRemove) {
      await this.removeManualExclusion(repos, ctx, target.id, row.id);
    }
    return toAdd.length > 0 || toRemove.length > 0;
  }

  private async insertExclusion(
    repos: UsersAdminRepositories,
    ctx: AdminContext,
    userId: number,
    exclusion: ExclusionInput,
  ): Promise<void> {
    const row = await repos.programs.addManualExclusion({
      userId,
      programId: exclusion.programId,
      reason: exclusion.reason,
      createdBy: ctx.actorId,
    });
    await this.audit(repos, ctx, userId, 'exclusion_add', {
      exclusionId: { before: null, after: row.id },
      programId: { before: null, after: row.programId },
      origin: { before: null, after: row.origin },
      reason: { before: null, after: row.reason },
    });
  }

  private async insertUser(
    repos: UsersAdminRepositories,
    ctx: AdminContext,
    input: ValidCreate,
    invitation: { state: InvitationState; at: Date | null },
  ): Promise<User> {
    try {
      return await repos.users.create({
        email: input.email,
        firstName: input.firstName,
        lastName: input.lastName,
        nickname: input.nickname,
        authSource: input.accountType,
        createdBy: ctx.actorId,
        invitation: invitation.state,
        invitedAt: invitation.at,
      });
    } catch (error) {
      if (!(error instanceof DuplicateUserError)) throw error;
      // Lost a race with another creator: say which key it was (FR-2). Nothing stays: the throw rolls back.
      // Plain read (DD-15): no second `users` lock outside the design 7 order.
      if (await repos.users.findByEmail(input.email)) {
        throw new EmailTakenError();
      }
      throw new NicknameTakenError();
    }
  }

  private scopeOf(programIds: readonly number[]): 'all' | number[] {
    return programIds.length === 0 ? 'all' : [...programIds];
  }

  // -------------------------------------------------------------------------
  // Cognito (DD-7, NFR-3)
  // -------------------------------------------------------------------------

  /** `sso`: no Cognito call, ever. `custom`: look the account up first; write only when it is absent (the existing account is never touched). */
  private async invite(
    input: ValidCreate,
  ): Promise<{ state: InvitationState; at: Date | null }> {
    if (input.accountType === 'sso') return { state: 'none', at: null };
    const state = await this.withinCognitoBudget(async () => {
      if (await this.cognito.getUser(input.email)) {
        return 'existing_account' as const;
      }
      const outcome = await this.cognito.createUser({
        email: input.email,
        givenName: input.firstName,
        familyName: input.lastName,
      });
      return outcome === 'created'
        ? ('sent' as const)
        : ('existing_account' as const);
    });
    return { state, at: state === 'sent' ? new Date() : null };
  }

  /** One deadline for the whole Cognito phase of a request, not 10 s per call (NFR-3). The loser of the race is left to finish: its outcome only matters to the pool. */
  private async withinCognitoBudget<T>(work: () => Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new UpstreamUnavailableError()),
        COGNITO_BUDGET_MS,
      );
    });
    try {
      return await Promise.race([work(), deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** The invitation (FR-8, amended): custom accounts only, never a deactivated user (DD-15: QA would refuse their sign-in). */
  private assertInvitable(user: User): void {
    if (user.authSource !== 'custom') {
      throw new InvitationNotApplicableError('the account is SSO');
    }
    if (!user.isActive) {
      throw new InvitationNotApplicableError('the user is deactivated');
    }
  }

  /**
   * The person's Cognito account, created when it is missing (it was removed
   * from the shared pool, or never existed). `created`: Cognito emailed a
   * temporary password. `pending`: the account still waits for its first
   * password. `present`: the account has a password. One 10 s budget.
   */
  private ensureCognitoAccount(
    user: User,
  ): Promise<'created' | 'pending' | 'present'> {
    return this.withinCognitoBudget(async () => {
      const account = await this.cognito.getUser(user.email);
      if (account) {
        return account.status === 'FORCE_CHANGE_PASSWORD'
          ? 'pending'
          : 'present';
      }
      const outcome = await this.cognito.createUser({
        email: user.email,
        givenName: user.firstName ?? '',
        familyName: user.lastName ?? '',
      });
      return outcome === 'created' ? 'created' : 'present';
    });
  }

  /**
   * A recreated Cognito account has a new `sub`: the old one is cleared so the
   * next sign-in links the new account by its verified email (admission step
   * 2) instead of failing as an email collision. Audited as an invitation.
   */
  private async recordRecreatedAccount(
    repos: UsersAdminRepositories,
    ctx: AdminContext,
    target: User,
  ): Promise<void> {
    const invitedAt = new Date();
    await repos.users.update(target.id, {
      cognitoSub: null,
      invitation: 'sent',
      invitedAt,
    });
    await this.audit(repos, ctx, target.id, 'invitation_resend', {
      invitedAt: {
        before: target.invitedAt?.toISOString() ?? null,
        after: invitedAt.toISOString(),
      },
      ...(target.invitation === 'sent'
        ? {}
        : { invitation: { before: target.invitation, after: 'sent' } }),
      cognitoAccount: { before: 'missing', after: 'created' },
    });
  }

  // -------------------------------------------------------------------------
  // Access email (after the commit; never decides the outcome)
  // -------------------------------------------------------------------------

  /** The grantable roles the user holds now, read in the transaction. */
  private async heldGrants(
    repos: UsersAdminRepositories,
    userId: number,
  ): Promise<Grant[]> {
    return (await repos.assignments.findActiveByUserId(userId))
      .filter((a) => isGrantableRole(a.roleCode))
      .map((a) => ({ roleCode: a.roleCode, resultTypeKey: a.resultTypeKey }));
  }

  /**
   * After a committed role change of an active user: removed (no role left),
   * granted (first role) or updated. A custom user who gains or keeps access
   * gets their Cognito account back if it is gone; a failure there is logged
   * and the email still goes out (the admin can resend the invitation).
   */
  private async announceRoleChange(
    ctx: AdminContext,
    change: RoleChange,
  ): Promise<void> {
    const { target, before, after } = change;
    if (!target.isActive) return;
    const kind =
      after.length === 0
        ? 'removed'
        : before.length === 0
          ? 'granted'
          : 'updated';
    let account: 'created' | 'pending' | 'present' | null = null;
    if (kind !== 'removed' && target.authSource === 'custom') {
      account = await this.restoreAfterCommit(ctx, target);
    }
    await this.announce({
      kind,
      email: target.email,
      firstName: target.firstName,
      grants: after,
      signIn: this.signInOf(target, account),
    });
  }

  /** `ensureCognitoAccount` + its audited record, outside the role change's transaction. */
  private async restoreAfterCommit(
    ctx: AdminContext,
    target: User,
  ): Promise<'created' | 'pending' | 'present' | null> {
    try {
      const account = await this.ensureCognitoAccount(target);
      if (account === 'created') {
        await this.unitOfWork.run(async (repos) => {
          const locked = await lockTargetUser(repos, target.id);
          await this.recordRecreatedAccount(repos, ctx, locked);
        });
        this.cache.invalidate(target.id);
      }
      return account;
    } catch {
      this.logger.warn(
        JSON.stringify({
          event: 'users_admin',
          action: 'account_restore',
          targetId: target.id,
          actorId: ctx.actorId,
          outcome: 'error',
          requestId: ctx.requestId,
        }),
      );
      return null;
    }
  }

  /** How the person signs in, for the email's instructions. */
  private signInOf(
    user: User,
    account: 'created' | 'pending' | 'present' | null = null,
  ): SignInPath {
    if (user.authSource !== 'custom') return 'sso';
    if (account === 'created' || account === 'pending') {
      return 'temporary_password';
    }
    if (account === 'present') return 'existing_password';
    return user.lastLoginAt === null && user.invitation === 'sent'
      ? 'temporary_password'
      : 'existing_password';
  }

  /** Builds the role lines (result type names from the catalog when it answers) and sends. Never throws. */
  private async announce(
    change: Omit<AccessChange, 'roles'> & { grants: readonly Grant[] },
  ): Promise<void> {
    // Nothing to tell someone who still cannot use QA.
    if (change.kind !== 'removed' && change.grants.length === 0) return;
    try {
      const names = new Map<string, string>();
      if (change.grants.some((g) => g.resultTypeKey !== null)) {
        try {
          for (const type of await this.catalogs.listResultTypes()) {
            names.set(type.key, type.name);
          }
        } catch {
          // No catalog copy: the keys stand in for the names.
        }
      }
      const { grants, ...rest } = change;
      await this.notifier.notify({ ...rest, roles: roleLines(grants, names) });
    } catch {
      this.logger.warn('access_email outcome=error');
    }
  }

  // -------------------------------------------------------------------------
  // Validation: shape first, then catalog references (stale cache allowed; no copy = 503)
  // -------------------------------------------------------------------------

  private async validateCreate(
    command: CreateUserCommand,
  ): Promise<ValidCreate> {
    const issues: FieldIssue[] = [];
    let email = '';
    try {
      email = normalizeEmail(command.email);
    } catch (error) {
      if (!(error instanceof InvalidEmailError)) throw error;
      issues.push({ field: 'email', code: 'INVALID_EMAIL' });
    }
    const firstName = this.cleanText(
      command.firstName,
      'firstName',
      NAME_MAX_LENGTH,
      issues,
    );
    const lastName = this.cleanText(
      command.lastName,
      'lastName',
      NAME_MAX_LENGTH,
      issues,
    );
    const nickname = this.cleanText(
      command.nickname,
      'nickname',
      NICKNAME_MAX_LENGTH,
      issues,
    );
    if (command.accountType !== 'sso' && command.accountType !== 'custom') {
      issues.push({ field: 'accountType', code: 'INVALID' });
    }
    const shape = this.shapeState(
      command.roles ?? [],
      command.programs ?? 'all',
      command.exclusions ?? [],
      issues,
    );
    if (issues.length > 0) throw new FieldValidationError(issues);

    await this.checkShapeCatalogs(shape, issues);
    if (issues.length > 0) throw new FieldValidationError(issues);

    return {
      email,
      firstName: firstName!,
      lastName: lastName!,
      nickname: nickname!,
      accountType: command.accountType,
      grants: shape.grants.map((g) => g.grant),
      programs: shape.programs,
      exclusions: shape.exclusions as ExclusionInput[],
    };
  }

  private validatePatch(patch: EditUserPatch): EditUserPatch {
    const issues: FieldIssue[] = [];
    const wanted = this.shapePatch(patch, issues);
    if (issues.length > 0) throw new FieldValidationError(issues);
    return wanted;
  }

  private shapePatch(
    patch: EditUserPatch,
    issues: FieldIssue[],
  ): EditUserPatch {
    const wanted: EditUserPatch = {};
    if (patch.nickname !== undefined) {
      wanted.nickname = this.cleanText(
        patch.nickname,
        'nickname',
        NICKNAME_MAX_LENGTH,
        issues,
      );
    }
    if (patch.firstName !== undefined) {
      wanted.firstName = this.cleanText(
        patch.firstName,
        'firstName',
        NAME_MAX_LENGTH,
        issues,
      );
    }
    if (patch.lastName !== undefined) {
      wanted.lastName = this.cleanText(
        patch.lastName,
        'lastName',
        NAME_MAX_LENGTH,
        issues,
      );
    }
    return wanted;
  }

  /**
   * Roles, program scope and manual exclusions of a whole state, shape only.
   * One exclusion per program: a repeat is a bad request on the repeated
   * entry, not a 409 from the unique key (design 6; T-6 forward pointer 3).
   */
  private shapeState(
    roles: RoleGrantInput[],
    programs: ProgramScopeInput,
    exclusions: ExclusionInput[],
    issues: FieldIssue[],
  ): StateShape {
    const shape: StateShape = {
      grants: this.roleShape(roles, issues),
      programs: this.programShape(programs, 'programs', issues),
      exclusions: exclusions.map((exclusion, index) =>
        this.exclusionShape(exclusion, `exclusions[${index}].`, issues),
      ),
    };
    const seenPrograms = new Set<number>();
    shape.exclusions.forEach((exclusion, index) => {
      if (exclusion === undefined) return;
      if (seenPrograms.has(exclusion.programId)) {
        issues.push({
          field: `exclusions[${index}].programId`,
          code: 'INVALID',
        });
      }
      seenPrograms.add(exclusion.programId);
    });
    return shape;
  }

  /** The one catalog check of a whole state: at most one read per catalog. */
  private checkShapeCatalogs(
    shape: StateShape,
    issues: FieldIssue[],
  ): Promise<void> {
    return this.checkCatalogs(
      shape.grants,
      shape.programs,
      shape.exclusions.map((e) => e!.programId),
      shape.exclusions.map((_, index) => `exclusions[${index}].programId`),
      issues,
    );
  }

  private async validateRoles(roles: RoleGrantInput[]): Promise<Grant[]> {
    const issues: FieldIssue[] = [];
    const shaped = this.roleShape(roles, issues);
    if (issues.length > 0) throw new FieldValidationError(issues);
    await this.checkCatalogs(shaped, [], [], [], issues);
    if (issues.length > 0) throw new FieldValidationError(issues);
    return shaped.map((s) => s.grant);
  }

  private async validatePrograms(
    programs: ProgramScopeInput,
    field: string,
  ): Promise<number[]> {
    const issues: FieldIssue[] = [];
    const ids = this.programShape(programs, field, issues);
    if (issues.length > 0) throw new FieldValidationError(issues);
    await this.checkCatalogs([], ids, [], [], issues, field);
    if (issues.length > 0) throw new FieldValidationError(issues);
    return ids;
  }

  private async validateExclusions(
    exclusions: ExclusionInput[],
    prefix: string,
  ): Promise<ExclusionInput[]> {
    const issues: FieldIssue[] = [];
    const clean = exclusions.map((exclusion, index) =>
      this.exclusionShape(
        exclusion,
        prefix === '' ? '' : `${prefix}[${index}].`,
        issues,
      ),
    );
    if (issues.length > 0) throw new FieldValidationError(issues);
    await this.checkCatalogs(
      [],
      [],
      clean.map((e) => e!.programId),
      clean.map((_, index) =>
        prefix === '' ? 'programId' : `${prefix}[${index}].programId`,
      ),
      issues,
    );
    if (issues.length > 0) throw new FieldValidationError(issues);
    return clean as ExclusionInput[];
  }

  private cleanText(
    value: unknown,
    field: string,
    max: number,
    issues: FieldIssue[],
  ): string | undefined {
    const text = typeof value === 'string' ? value.trim() : '';
    if (text.length === 0) {
      issues.push({ field, code: 'REQUIRED' });
      return undefined;
    }
    if (text.length > max) {
      issues.push({ field, code: 'TOO_LONG', max });
      return undefined;
    }
    return text;
  }

  private cleanReason(
    value: unknown,
    field: string,
    issues: FieldIssue[],
  ): string | undefined {
    return this.cleanText(value, field, REASON_MAX_LENGTH, issues);
  }

  private exclusionShape(
    exclusion: ExclusionInput,
    prefix: string,
    issues: FieldIssue[],
  ): ExclusionInput | undefined {
    if (!isPositiveId(exclusion?.programId)) {
      issues.push({ field: `${prefix}programId`, code: 'INVALID' });
    }
    const reason = this.cleanReason(
      exclusion?.reason,
      `${prefix}reason`,
      issues,
    );
    return reason === undefined || !isPositiveId(exclusion?.programId)
      ? undefined
      : { programId: exclusion.programId, reason };
  }

  /**
   * One entry per role. A role listed twice, an array that carries the
   * internal `*`, an empty array, or a scope the role does not take is
   * REJECTED, never merged: "Assessor on KP" plus "Assessor on all" has no
   * representation in `resultTypes: 'all' | string[]`, so asking for both is a
   * client error (T-3 forward pointer).
   */
  private roleShape(
    roles: RoleGrantInput[],
    issues: FieldIssue[],
  ): Array<{ grant: Grant; keys: string[]; index: number }> {
    const seen = new Set<string>();
    const shaped: Array<{ grant: Grant; keys: string[]; index: number }> = [];
    roles.forEach((entry, index) => {
      const at = `roles[${index}]`;
      const definition = GRANTABLE_ROLES.find((r) => r.code === entry?.role);
      if (!definition || seen.has(entry.role)) {
        issues.push({ field: `${at}.role`, code: 'INVALID' });
        return;
      }
      seen.add(entry.role);
      const scope = entry.resultTypes;
      if (definition.scopeType === 'global') {
        if (scope !== undefined && scope !== null) {
          issues.push({ field: `${at}.resultTypes`, code: 'INVALID' });
          return;
        }
        shaped.push({
          grant: { roleCode: entry.role, resultTypeKey: null },
          keys: [],
          index,
        });
        return;
      }
      if (scope === undefined || scope === null) {
        issues.push({ field: `${at}.resultTypes`, code: 'REQUIRED' });
        return;
      }
      if (scope === 'all') {
        shaped.push({
          grant: { roleCode: entry.role, resultTypeKey: ALL_RESULT_TYPES },
          keys: [],
          index,
        });
        return;
      }
      const keys = Array.isArray(scope) ? scope : [];
      const valid =
        Array.isArray(scope) &&
        keys.length > 0 &&
        new Set(keys).size === keys.length &&
        keys.every(
          (key) =>
            typeof key === 'string' &&
            key.trim() === key &&
            key !== '' &&
            key !== ALL_RESULT_TYPES,
        );
      if (!valid) {
        issues.push({ field: `${at}.resultTypes`, code: 'INVALID' });
        return;
      }
      for (const key of keys) {
        shaped.push({
          grant: { roleCode: entry.role, resultTypeKey: key },
          keys: [key],
          index,
        });
      }
    });
    return shaped;
  }

  private programShape(
    programs: ProgramScopeInput,
    field: string,
    issues: FieldIssue[],
  ): number[] {
    if (programs === 'all') return [];
    if (
      !Array.isArray(programs) ||
      programs.length === 0 ||
      !programs.every(isPositiveId)
    ) {
      issues.push({ field, code: 'INVALID' });
      return [];
    }
    return [...new Set(programs)];
  }

  /** Result type keys and program ids must exist in the catalogs. Only the catalogs the request needs are asked, and none before the shape is valid. */
  private async checkCatalogs(
    roles: Array<{ keys: string[]; index: number }>,
    programIds: number[],
    exclusionProgramIds: number[],
    exclusionFields: string[],
    issues: FieldIssue[],
    programField = 'programs',
  ): Promise<void> {
    if (roles.some((r) => r.keys.length > 0)) {
      const known = new Set(
        (await this.catalogs.listResultTypes()).map((t) => t.key),
      );
      const reported = new Set<number>();
      for (const role of roles) {
        if (
          role.keys.every((key) => known.has(key)) ||
          reported.has(role.index)
        )
          continue;
        reported.add(role.index);
        issues.push({
          field: `roles[${role.index}].resultTypes`,
          code: 'INVALID',
        });
      }
    }
    if (programIds.length > 0 || exclusionProgramIds.length > 0) {
      const known = new Set(
        (await this.catalogs.listSciencePrograms()).map((p) => p.id),
      );
      if (!programIds.every((id) => known.has(id))) {
        issues.push({ field: programField, code: 'INVALID' });
      }
      exclusionProgramIds.forEach((id, index) => {
        if (!known.has(id)) {
          issues.push({ field: exclusionFields[index]!, code: 'INVALID' });
        }
      });
    }
  }

  // -------------------------------------------------------------------------
  // Decision log (NFR-2)
  // -------------------------------------------------------------------------

  /**
   * One line per mutation, success or refusal: event, action, target id,
   * actor id, outcome, a reason code on a refusal, request id. Never an
   * email, a name, a nickname or a credential.
   */
  private async logged<T>(
    action: LogAction,
    ctx: AdminContext,
    targetId: number | null,
    work: () => Promise<T>,
    targetOf: (result: T) => number | null = () => targetId,
  ): Promise<T> {
    try {
      const result = await work();
      this.logger.log(this.line(action, ctx, targetOf(result), 'ok'));
      return result;
    } catch (error) {
      const forced =
        typeof error === 'object' && error !== null
          ? FORCED_LOG_REASONS.get(error)
          : undefined;
      const status = error instanceof HttpException ? error.getStatus() : 500;
      const body =
        error instanceof HttpException
          ? (error.getResponse() as { code?: unknown })
          : {};
      const reason =
        forced ??
        (typeof body.code === 'string' && /^[A-Z_]{1,64}$/.test(body.code)
          ? body.code
          : status < 500
            ? `http_${status}`
            : 'internal_error');
      const refused = status < 500 && forced === undefined;
      const line = this.line(
        action,
        ctx,
        targetId,
        refused ? 'refused' : 'error',
        reason,
      );
      if (refused) this.logger.warn(line);
      else this.logger.error(line);
      throw error;
    }
  }

  private line(
    action: LogAction,
    ctx: AdminContext,
    targetId: number | null,
    outcome: 'ok' | 'refused' | 'error',
    reason?: string,
  ): string {
    return JSON.stringify({
      event: 'users_admin',
      action,
      targetId,
      actorId: ctx.actorId,
      outcome,
      ...(reason === undefined ? {} : { reason }),
      requestId: ctx.requestId,
      // `none` | `taken_over`: the interceptor writes no line of its own for
      // a first or taken-over execution (design 7, Decision log).
      idempotency: ctx.idempotency?.outcome ?? 'none',
    });
  }
}

/** A whole state after the shape pass; `undefined` exclusions only exist alongside issues. */
interface StateShape {
  grants: Array<{ grant: Grant; keys: string[]; index: number }>;
  programs: number[];
  exclusions: Array<ExclusionInput | undefined>;
}

interface ValidCreate {
  email: string;
  firstName: string;
  lastName: string;
  nickname: string;
  accountType: AccountType;
  grants: Grant[];
  programs: number[];
  exclusions: ExclusionInput[];
}
