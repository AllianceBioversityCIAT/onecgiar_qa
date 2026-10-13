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
    authSource: (
      Array.isArray(identities) ? identities.length > 0 : identities != null
    )
      ? 'sso'
      : 'custom',
    emailVerified:
      claims['email_verified'] === true || claims['email_verified'] === 'true',
  };
}

/**
 * FR-8: resolves the QA user of a verified id token and decides whether it is
 * admitted (design 7.2, DD-10). Everything runs in one transaction and nothing
 * is written before the decision to admit, so a refusal leaves no trace.
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

    // Step 5.
    if (!user.isActive) throw new UserInactiveError();

    // Step 6: the same notion of live assignment as FR-11.
    const views = await assignments.findActiveViewsByUserId(user.id);
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
   * Step 2: the user of this `sub`, else the pre-registered user of this email
   * (empty `sub`, linked later by `linkSub`). Step 3: an email held by another
   * `sub` is a collision. A custom token links by email only when its email is
   * verified; an SSO email comes from the CGIAR directory, so it needs no flag.
   */
  private async locate(
    users: UsersRepository,
    claims: IdentityClaims,
    options?: ReadOptions,
  ): Promise<User | undefined> {
    const bySub = await users.findByCognitoSub(claims.sub, options);
    if (bySub) return bySub;
    const byEmail = await users.findByEmail(claims.email, options);
    if (byEmail && byEmail.cognitoSub !== null) throw new EmailCollisionError();
    if (byEmail && claims.authSource === 'custom' && !claims.emailVerified) {
      throw new EmailNotVerifiedError();
    }
    return byEmail;
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
    if (user.email !== claims.email) patch.email = claims.email;
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
