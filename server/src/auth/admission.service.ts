import { Inject, Injectable } from '@nestjs/common';
import type { AuthSource, User } from '../database/drizzle/schema/users.js';
import {
  CurrentUserCache,
  isLiveAssignment,
  toAuthenticatedUser,
  type AuthenticatedUser,
} from '../users/current-user.cache.js';
import { RoleAssignmentsRepository } from '../users/role-assignments.repository.js';
import { DuplicateUserError } from '../users/users.errors.js';
import {
  normalizeEmail,
  UsersRepository,
  type ReadOptions,
  type UserPatch,
} from '../users/users.repository.js';
import {
  EmailCollisionError,
  EmailNotVerifiedError,
  NoActiveRolesError,
  UserInactiveError,
  UserNotRegisteredError,
} from './auth.errors.js';
import { InvalidTokenError, TokenVerifier } from './token-verifier.service.js';

export const ADMISSION_UNIT_OF_WORK = Symbol('ADMISSION_UNIT_OF_WORK');

/** The repositories of one transaction (DD-10). */
export interface AdmissionRepositories {
  users: UsersRepository;
  assignments: RoleAssignmentsRepository;
}

/** Runs `work` in one database transaction: it commits when `work` resolves, rolls back when it throws. */
export interface AdmissionUnitOfWork {
  run<T>(work: (repositories: AdmissionRepositories) => Promise<T>): Promise<T>;
}

/** `login` = a token was just acquired; `refresh` = FR-13, which never creates a user. */
export type AdmissionMode = 'login' | 'refresh';

export interface AdmissionResult {
  user: AuthenticatedUser;
  /** The `cognito:username` claim, for the refresh cookie (DD-2); null when the token has none. */
  cognitoUsername: string | null;
}

/** What admission needs from a verified id token. */
interface IdentityClaims {
  sub: string;
  email: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  authSource: AuthSource;
  /** `email_verified` is boolean `true` or the string `"true"`; anything else, or absent, is not verified. */
  emailVerified: boolean;
}

const NAME_MAX_LENGTH = 100;

/**
 * The one place the id token's claim names are known (premises P-10, P-12 are
 * UNVERIFIED until T-11 decodes real tokens): SSO users carry `identities`,
 * the username is `cognito:username`, names are `given_name` / `family_name`,
 * the verification flag is `email_verified`. Anything unusable is a 401.
 */
export function readClaims(payload: object): IdentityClaims {
  const claims = payload as Record<string, unknown>;
  const text = (name: string): string | null => {
    const value = claims[name];
    return typeof value === 'string' && value.trim() !== '' ? value : null;
  };
  const identities = claims['identities'];
  const sub = text('sub');
  const rawEmail = text('email');
  if (sub === null || rawEmail === null) throw new InvalidTokenError();
  let email: string;
  try {
    email = normalizeEmail(rawEmail);
  } catch {
    throw new InvalidTokenError();
  }
  const name = (claim: string) =>
    text(claim)?.trim().slice(0, NAME_MAX_LENGTH) ?? null;
  return {
    sub,
    email,
    username: text('cognito:username'),
    firstName: name('given_name'),
    lastName: name('family_name'),
    // SSO only for a non-empty array; every other shape is custom, which is
    // the stricter side: it needs a verified email and live assignments.
    authSource:
      Array.isArray(identities) && identities.length > 0 ? 'sso' : 'custom',
    emailVerified:
      claims['email_verified'] === true || claims['email_verified'] === 'true',
  };
}

/**
 * FR-8: resolves the QA user of a verified id token and decides whether it is
 * admitted (design 7.2, DD-10). Everything runs in one transaction and nothing
 * is written before the decision to admit, so a refusal leaves no trace.
 *
 * Where each decision comes from (DD-10: the latest committed state, never a
 * plain SELECT, which serves the transaction's snapshot):
 * - Link, 409, unverified email (steps 2 and 3): the candidate's row read
 *   `FOR UPDATE` by id; the link itself is the conditional
 *   `UPDATE ... WHERE cognito_sub IS NULL`, and when it changes no row, the
 *   row read `FOR UPDATE` again.
 * - Active (step 5): that locked row, or the row this transaction inserted.
 * - A custom user's live assignment (step 6): its active `role_assignments`
 *   rows `FOR SHARE`, then their `roles` `FOR SHARE` by primary key. Shared
 *   locks: logins do not wait for each other, while a revoke or a role
 *   deactivation committed first is read, and one that comes later waits for
 *   this transaction. No decision depends on an SSO user's assignments: they
 *   are read plainly, for the response only, which may lag by one transaction.
 * The lock order is `users` → `role_assignments` → `roles`, as in every flow.
 *
 * Plain reads name the candidate (by `sub`, else by email), so that a first
 * login takes no gap lock before its insert. Two outcomes rest on them, and
 * neither can admit on stale data:
 * - "No such user" (step 4): it refuses a custom token or a refresh; an SSO
 *   login inserts, and an insert that collides with a row committed since the
 *   snapshot is resolved with locking reads.
 * - A locked candidate that no longer matches (its email moved since the
 *   snapshot) is no one's to link and no collision; no other candidate is
 *   searched, so it ends as "no such user" too.
 */
@Injectable()
export class AdmissionService {
  constructor(
    @Inject(TokenVerifier) private readonly verifier: TokenVerifier,
    @Inject(ADMISSION_UNIT_OF_WORK)
    private readonly unitOfWork: AdmissionUnitOfWork,
    @Inject(CurrentUserCache) private readonly cache: CurrentUserCache,
  ) {}

  async resolve(
    idToken: string,
    options: { mode: AdmissionMode },
  ): Promise<AdmissionResult> {
    // Step 1: signature, issuer, audience, expiry (a failure is a 401).
    const claims = readClaims(await this.verifier.verifyId(idToken));

    const result = await this.unitOfWork.run((repositories) =>
      this.admit(repositories, claims, options.mode),
    );

    // After the commit (never inside the transaction): from here on a cache
    // read in this process sees the change (FR-11). Other processes catch up
    // within the cache TTL. Every admission wrote the row (step 7), so every
    // one invalidates; a refusal throws before getting here.
    this.cache.invalidate(result.user.id);
    return result;
  }

  private async admit(
    { users, assignments }: AdmissionRepositories,
    claims: IdentityClaims,
    mode: AdmissionMode,
  ): Promise<AdmissionResult> {
    // Steps 2 and 3.
    let user = await this.locate(users, claims);

    // Step 4.
    if (!user) {
      if (mode === 'refresh' || claims.authSource === 'custom') {
        throw new UserNotRegisteredError();
      }
      user = await this.createSsoUser(users, claims);
    }

    // Step 5: `user` is the locked row (or the row this transaction inserted).
    if (!user.isActive) throw new UserInactiveError();

    // Step 6: the same notion of live assignment as FR-11. A custom user's
    // assignments and their roles are read FOR SHARE, after the user row; an
    // SSO user's only feed the response and are read plainly.
    const views = await assignments.findActiveViewsByUserId(user.id, {
      forShare: claims.authSource === 'custom',
    });
    if (claims.authSource === 'custom' && !views.some(isLiveAssignment)) {
      throw new NoActiveRolesError();
    }

    // Step 2, the write half: nothing is linked before the decision to admit.
    if (user.cognitoSub === null) {
      user = await this.linkSub(users, user, claims.sub);
    }

    // Step 7 (plus the auth source from the token), on a refresh as well as on
    // a login.
    user = await users.update(user.id, this.changes(user, claims));

    return {
      user: toAuthenticatedUser(user, views),
      cognitoUsername: claims.username,
    };
  }

  /**
   * Steps 2 and 3. Plain reads find a candidate: the user of this `sub`, else
   * the one of this email (the lookups of a login that may find nothing are
   * plain, so they take no gap lock). The decision is then taken on that row
   * read `FOR UPDATE` by id, as it stands now. `options` makes the candidate
   * lookups locking reads too, for the caller that knows its snapshot predates
   * the row (the retry after a lost insert race).
   */
  private async locate(
    users: UsersRepository,
    claims: IdentityClaims,
    options?: ReadOptions,
  ): Promise<User | undefined> {
    const candidate =
      (await users.findByCognitoSub(claims.sub, options)) ??
      (await users.findByEmail(claims.email, options));
    if (!candidate) return undefined;
    const row = await users.findById(candidate.id, { forUpdate: true });
    return row && this.judge(row, claims);
  }

  /**
   * The rules of steps 2 and 3 on a locked row. The user of this `sub` is
   * found whatever its email. Any other row concerns this login only through
   * its email, so a row whose email has moved on since the snapshot is no one's
   * to link and no collision. An email held by another `sub` is a collision. A
   * custom token links by email only when its email is verified; an SSO email
   * comes from the CGIAR directory, so it needs no flag.
   */
  private judge(row: User, claims: IdentityClaims): User | undefined {
    if (row.cognitoSub === claims.sub) return row;
    if (row.email !== claims.email) return undefined;
    if (row.cognitoSub !== null) throw new EmailCollisionError();
    if (claims.authSource === 'custom' && !claims.emailVerified) {
      throw new EmailNotVerifiedError();
    }
    return row;
  }

  /**
   * Step 2, the link: conditional on the `sub` still being empty, so another
   * login's link is never overwritten. When it lost, the row as it stands now
   * decides: the same `sub` (a double login) continues with that row, another
   * `sub` is a collision (step 3).
   */
  private async linkSub(
    users: UsersRepository,
    user: User,
    sub: string,
  ): Promise<User> {
    const link = await users.linkCognitoSub(user.id, sub);
    if (link.linked) return user;
    if (link.user.cognitoSub !== sub) throw new EmailCollisionError();
    return link.user;
  }

  /**
   * Creates the GUEST row of a first SSO login. Losing the insert race to a
   * concurrent first login of the same person resolves to the winner's row:
   * the re-read is a locking read, because the transaction's snapshot predates
   * the winner's commit (DD-10).
   */
  private async createSsoUser(
    users: UsersRepository,
    claims: IdentityClaims,
  ): Promise<User> {
    try {
      return await users.create({
        email: claims.email,
        cognitoSub: claims.sub,
        cognitoUsername: claims.username,
        firstName: claims.firstName,
        lastName: claims.lastName,
        authSource: 'sso',
        lastLoginAt: new Date(),
        createdBy: null,
      });
    } catch (error) {
      if (!(error instanceof DuplicateUserError)) throw error;
      const winner = await this.locate(users, claims, { forUpdate: true });
      if (!winner) throw error;
      return winner;
    }
  }

  /** What the token changes in the stored user, plus the login date (step 7), which every admission stamps. */
  private changes(user: User, claims: IdentityClaims): UserPatch {
    const patch: UserPatch = {};
    if (user.authSource !== claims.authSource) {
      patch.authSource = claims.authSource;
    }
    if (claims.username !== null && user.cognitoUsername !== claims.username) {
      patch.cognitoUsername = claims.username;
    }
    // An email the token does not vouch for is not stored: the CGIAR directory
    // vouches for an SSO email, `email_verified` for a custom one.
    if (
      user.email !== claims.email &&
      (claims.authSource === 'sso' || claims.emailVerified)
    ) {
      patch.email = claims.email;
    }
    if (claims.firstName !== null && user.firstName !== claims.firstName) {
      patch.firstName = claims.firstName;
    }
    if (claims.lastName !== null && user.lastName !== claims.lastName) {
      patch.lastName = claims.lastName;
    }
    patch.lastLoginAt = new Date();
    return patch;
  }
}
