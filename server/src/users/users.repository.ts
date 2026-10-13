import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE } from '../database/drizzle/drizzle.constants.js';
import type { DrizzleDB } from '../database/drizzle/drizzle.module.js';
import {
  users,
  type NewUser,
  type User,
} from '../database/drizzle/schema/users.js';
import {
  DuplicateUserError,
  InvalidEmailError,
  isDuplicateKeyError,
} from './users.errors.js';

export const USERS_STORE = Symbol('USERS_STORE');

/** The persistence port of `UsersRepository` (TRD section 4, Repository). */
export interface UsersStore {
  findById(id: number): Promise<User | undefined>;
  findByEmail(email: string): Promise<User | undefined>;
  findByCognitoSub(sub: string): Promise<User | undefined>;
  insert(
    values: NewUser,
  ): Promise<{ kind: 'created'; user: User } | { kind: 'duplicate' }>;
}

export interface CreateUserInput {
  email: string;
  cognitoSub?: string | null;
  cognitoUsername?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  authSource?: User['authSource'];
  createdBy?: number | null;
}

const EMAIL_MAX_LENGTH = 255;

/** Trimmed and lowercase, as the table requires (FR-1). */
export function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (
    normalized.length === 0 ||
    normalized.length > EMAIL_MAX_LENGTH ||
    !normalized.includes('@') ||
    normalized.startsWith('@') ||
    normalized.endsWith('@')
  ) {
    throw new InvalidEmailError();
  }
  return normalized;
}

/**
 * An empty `sub` is stored as NULL: two '' values would collide on the unique
 * index `uq_users_cognito_sub` (NULLs never collide).
 */
export function normalizeCognitoSub(
  sub: string | null | undefined,
): string | null {
  return sub == null || sub.trim() === '' ? null : sub;
}

@Injectable()
export class UsersRepository {
  constructor(@Inject(USERS_STORE) private readonly store: UsersStore) {}

  findById(id: number): Promise<User | undefined> {
    return this.store.findById(id);
  }

  findByEmail(email: string): Promise<User | undefined> {
    return this.store.findByEmail(normalizeEmail(email));
  }

  async findByCognitoSub(sub: string): Promise<User | undefined> {
    const normalized = normalizeCognitoSub(sub);
    return normalized === null
      ? undefined
      : this.store.findByCognitoSub(normalized);
  }

  async create(input: CreateUserInput): Promise<User> {
    const result = await this.store.insert({
      email: normalizeEmail(input.email),
      cognitoSub: normalizeCognitoSub(input.cognitoSub),
      cognitoUsername: input.cognitoUsername ?? null,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      authSource: input.authSource ?? 'sso',
      createdBy: input.createdBy ?? null,
    });
    if (result.kind === 'duplicate') throw new DuplicateUserError();
    return result.user;
  }

  /**
   * Returns the user with this email, creating it when absent. A lost insert
   * race (another writer created it between the lookup and the insert) is
   * resolved by re-reading the winner.
   */
  async findOrCreateByEmail(
    email: string,
    defaults: Omit<CreateUserInput, 'email'> = {},
  ): Promise<{ user: User; created: boolean }> {
    const existing = await this.findByEmail(email);
    if (existing) return { user: existing, created: false };
    try {
      return { user: await this.create({ ...defaults, email }), created: true };
    } catch (error) {
      if (!(error instanceof DuplicateUserError)) throw error;
      const winner = await this.findByEmail(email);
      if (!winner) throw error;
      return { user: winner, created: false };
    }
  }
}

type UsersDb = Pick<DrizzleDB, 'select' | 'insert'>;

/** Drizzle adapter of `UsersStore`. */
@Injectable()
export class DrizzleUsersStore implements UsersStore {
  constructor(@Inject(DRIZZLE) private readonly db: UsersDb) {}

  async findById(id: number) {
    const [row] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return row;
  }

  async findByEmail(email: string) {
    const [row] = await this.db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    return row;
  }

  async findByCognitoSub(sub: string) {
    const [row] = await this.db
      .select()
      .from(users)
      .where(eq(users.cognitoSub, sub))
      .limit(1);
    return row;
  }

  async insert(values: NewUser) {
    try {
      const [header] = await this.db.insert(users).values(values);
      const user = await this.findById(header.insertId);
      if (!user) throw new Error('Inserted user could not be read back');
      return { kind: 'created' as const, user };
    } catch (error) {
      if (isDuplicateKeyError(error)) return { kind: 'duplicate' as const };
      throw error;
    }
  }
}
