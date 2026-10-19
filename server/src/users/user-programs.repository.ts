import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { DRIZZLE } from '../database/drizzle/drizzle.constants.js';
import type { DrizzleDB } from '../database/drizzle/drizzle.module.js';
import {
  userProgramExclusions,
  type NewUserProgramExclusion,
  type UserProgramExclusion,
} from '../database/drizzle/schema/user-program-exclusions.js';
import { userPrograms } from '../database/drizzle/schema/user-programs.js';
import type { ProgramScopeView } from './effective-scope.js';
import {
  ExclusionExistsError,
  ExclusionNotFoundError,
  ExclusionNotManualError,
  ExclusionNotReportingError,
  ExclusionReasonError,
  InvalidProgramIdError,
  isDuplicateKeyError,
} from './users.errors.js';

export const USER_PROGRAMS_STORE = Symbol('USER_PROGRAMS_STORE');

/** `forUpdate` = a locking read (`SELECT ... FOR UPDATE`): the latest committed rows, locked until the transaction ends (DD-10). */
export interface ProgramReadOptions {
  forUpdate?: boolean;
}

/** How an exclusion ends: the row keeps who, when and why (DD-5, DD-12). */
export interface ExclusionEnd {
  status: 'removed' | 'dismissed';
  /** null = ended by the system; the repository allows it for a `reporting` removal only (DD-12). */
  endedBy: number | null;
  endReason: string | null;
  at: Date;
}

/** The persistence port of `UserProgramsRepository` (design 4, 5). */
export interface UserProgramsStore {
  /** `user_programs` of the user, ascending; empty = all programs (DD-4). */
  findScope(userId: number, options?: ProgramReadOptions): Promise<number[]>;
  addPrograms(userId: number, programIds: number[]): Promise<void>;
  removePrograms(userId: number, programIds: number[]): Promise<void>;
  /** Every exclusion row of the user, history included, oldest first. */
  findExclusions(
    userId: number,
    options?: ProgramReadOptions,
  ): Promise<UserProgramExclusion[]>;
  findActiveExclusions(userId: number): Promise<UserProgramExclusion[]>;
  findExclusionById(
    userId: number,
    id: number,
    options?: ProgramReadOptions,
  ): Promise<UserProgramExclusion | undefined>;
  /** `duplicate` = the user already has an active exclusion of this program (`active_key`). */
  insertExclusion(
    values: NewUserProgramExclusion,
  ): Promise<
    { kind: 'created'; exclusion: UserProgramExclusion } | { kind: 'duplicate' }
  >;
  /** `UPDATE ... WHERE id = ? AND status = 'active'`: true when a row ended. */
  endExclusion(id: number, end: ExclusionEnd): Promise<boolean>;
}

const EXCLUSION_REASON_MAX_LENGTH = 500;
const UNSIGNED_INT_MAX = 4294967295;

/** The reason as stored: trimmed, never empty, at most 500 characters (FR-4, the schema CHECKs). */
function cleanReason(reason: string | null | undefined): string {
  const text = typeof reason === 'string' ? reason.trim() : '';
  if (text.length === 0) {
    throw new ExclusionReasonError('REQUIRED', EXCLUSION_REASON_MAX_LENGTH);
  }
  if (text.length > EXCLUSION_REASON_MAX_LENGTH) {
    throw new ExclusionReasonError('TOO_LONG', EXCLUSION_REASON_MAX_LENGTH);
  }
  return text;
}

/**
 * Every end or creation an admin triggers names the admin (DD-12, T-1
 * review): the type says so, and this makes a caller that bypasses the type
 * (an `as` cast, plain JavaScript) fail before anything is written.
 */
function requireActor(actor: unknown): number {
  if (typeof actor !== 'number' || !Number.isInteger(actor) || actor < 1) {
    throw new Error('An admin change of an exclusion needs the actor id');
  }
  return actor;
}

/**
 * The only writer of `user_programs` and `user_program_exclusions` (design 4,
 * DD-4, DD-5). Decisions read with a lock (`forUpdate`, DD-10) under the user
 * row lock of the unit of work; rows are never deleted (history is the
 * point), a removal or a dismissal flips `status` and keeps who, when, why.
 */
@Injectable()
export class UserProgramsRepository {
  constructor(
    @Inject(USER_PROGRAMS_STORE) private readonly store: UserProgramsStore,
  ) {}

  /** What `CurrentUserCache` loads with the user: the scope and the ACTIVE exclusions only. */
  async findScopeView(userId: number): Promise<ProgramScopeView> {
    const programScope = await this.store.findScope(userId);
    const active = await this.store.findActiveExclusions(userId);
    return {
      programScope,
      exclusions: active.map((row) => ({
        programId: row.programId,
        status: row.status,
      })),
    };
  }

  findScope(userId: number, options?: ProgramReadOptions): Promise<number[]> {
    return this.store.findScope(userId, options);
  }

  /** Every exclusion row of the user, ended ones included. */
  findExclusions(
    userId: number,
    options?: ProgramReadOptions,
  ): Promise<UserProgramExclusion[]> {
    return this.store.findExclusions(userId, options);
  }

  /**
   * Sets the program scope by diff (the new programs are inserted, the
   * missing ones deleted, the rest untouched); `[]` = all programs. Whether a
   * program exists is the catalog's rule, checked by the service (FR-4).
   */
  async replaceScope(
    userId: number,
    programIds: readonly number[],
  ): Promise<{ before: number[]; after: number[] }> {
    const wanted = [...new Set(programIds)].sort((a, b) => a - b);
    for (const id of wanted) {
      if (!Number.isInteger(id) || id < 1 || id > UNSIGNED_INT_MAX) {
        throw new InvalidProgramIdError();
      }
    }
    const before = await this.store.findScope(userId, { forUpdate: true });
    const toAdd = wanted.filter((id) => !before.includes(id));
    const toRemove = before.filter((id) => !wanted.includes(id));
    await this.store.removePrograms(userId, toRemove);
    await this.store.addPrograms(userId, toAdd);
    return { before, after: wanted };
  }

  /** FR-4, manual exclusion: always with a reason and the admin who added it. */
  async addManualExclusion(input: {
    userId: number;
    programId: number;
    reason: string;
    createdBy: number;
  }): Promise<UserProgramExclusion> {
    const createdBy = requireActor(input.createdBy);
    const reason = cleanReason(input.reason);
    const result = await this.store.insertExclusion({
      userId: input.userId,
      programId: input.programId,
      origin: 'manual',
      reason,
      createdBy,
    });
    if (result.kind === 'duplicate') throw new ExclusionExistsError();
    return result.exclusion;
  }

  /** FR-4, remove a manual exclusion: `ended_by` is the admin, never null. */
  async removeManualExclusion(input: {
    userId: number;
    exclusionId: number;
    endedBy: number;
    endReason?: string | null;
  }): Promise<UserProgramExclusion> {
    const endedBy = requireActor(input.endedBy);
    const endReason =
      input.endReason == null || input.endReason.trim() === ''
        ? null
        : cleanReason(input.endReason);
    const row = await this.findActive(input.userId, input.exclusionId);
    if (row.origin !== 'manual') throw new ExclusionNotManualError();
    return this.end(row, { status: 'removed', endedBy, endReason });
  }

  /** FR-4, dismiss a Reporting exclusion: a reason is required, `ended_by` is the admin. */
  async dismissReportingExclusion(input: {
    userId: number;
    exclusionId: number;
    endedBy: number;
    reason: string;
  }): Promise<UserProgramExclusion> {
    const endedBy = requireActor(input.endedBy);
    const endReason = cleanReason(input.reason);
    const row = await this.findActive(input.userId, input.exclusionId);
    if (row.origin !== 'reporting') throw new ExclusionNotReportingError();
    return this.end(row, { status: 'dismissed', endedBy, endReason });
  }

  /**
   * DD-12: the system ends a Reporting exclusion as `removed`, with no actor.
   * The only end without one; the schema CHECK allows exactly this case.
   */
  async endReportingExclusionAsSystem(input: {
    userId: number;
    exclusionId: number;
  }): Promise<UserProgramExclusion> {
    const row = await this.findActive(input.userId, input.exclusionId);
    if (row.origin !== 'reporting') throw new ExclusionNotReportingError();
    return this.end(row, { status: 'removed', endedBy: null, endReason: null });
  }

  /** The user's ACTIVE exclusion, read FOR UPDATE; ended rows and other users' rows are absent. */
  private async findActive(
    userId: number,
    exclusionId: number,
  ): Promise<UserProgramExclusion> {
    const row = await this.store.findExclusionById(userId, exclusionId, {
      forUpdate: true,
    });
    if (!row || row.status !== 'active') {
      throw new ExclusionNotFoundError(exclusionId);
    }
    return row;
  }

  private async end(
    row: UserProgramExclusion,
    end: Omit<ExclusionEnd, 'at'>,
  ): Promise<UserProgramExclusion> {
    // DD-12, last line of defence before the DB CHECK: no actor only for a Reporting removal.
    if (
      end.endedBy === null &&
      !(row.origin === 'reporting' && end.status === 'removed')
    ) {
      throw new Error('This end of an exclusion needs the actor id');
    }
    const ended = await this.store.endExclusion(row.id, {
      ...end,
      at: new Date(),
    });
    // The conditional UPDATE matched nothing: it ended between the read and the write.
    if (!ended) throw new ExclusionNotFoundError(row.id);
    const after = await this.store.findExclusionById(row.userId, row.id, {
      forUpdate: true,
    });
    if (!after) throw new ExclusionNotFoundError(row.id);
    return after;
  }
}

type ProgramsDb = Pick<DrizzleDB, 'select' | 'insert' | 'update' | 'delete'>;

/** Drizzle adapter of `UserProgramsStore`. */
@Injectable()
export class DrizzleUserProgramsStore implements UserProgramsStore {
  constructor(@Inject(DRIZZLE) private readonly db: ProgramsDb) {}

  async findScope(userId: number, options: ProgramReadOptions = {}) {
    const query = this.db
      .select({ programId: userPrograms.programId })
      .from(userPrograms)
      .where(eq(userPrograms.userId, userId))
      .orderBy(asc(userPrograms.programId));
    const rows = await (options.forUpdate ? query.for('update') : query);
    return rows.map((row) => row.programId);
  }

  async addPrograms(userId: number, programIds: number[]) {
    if (programIds.length === 0) return;
    await this.db
      .insert(userPrograms)
      .values(programIds.map((programId) => ({ userId, programId })));
  }

  async removePrograms(userId: number, programIds: number[]) {
    if (programIds.length === 0) return;
    await this.db
      .delete(userPrograms)
      .where(
        and(
          eq(userPrograms.userId, userId),
          inArray(userPrograms.programId, programIds),
        ),
      );
  }

  async findExclusions(userId: number, options: ProgramReadOptions = {}) {
    const query = this.db
      .select()
      .from(userProgramExclusions)
      .where(eq(userProgramExclusions.userId, userId))
      .orderBy(asc(userProgramExclusions.id));
    return options.forUpdate ? await query.for('update') : await query;
  }

  findActiveExclusions(userId: number) {
    return this.db
      .select()
      .from(userProgramExclusions)
      .where(
        and(
          eq(userProgramExclusions.userId, userId),
          eq(userProgramExclusions.status, 'active'),
        ),
      )
      .orderBy(asc(userProgramExclusions.id));
  }

  async findExclusionById(
    userId: number,
    id: number,
    options: ProgramReadOptions = {},
  ) {
    const query = this.db
      .select()
      .from(userProgramExclusions)
      .where(
        and(
          eq(userProgramExclusions.id, id),
          eq(userProgramExclusions.userId, userId),
        ),
      )
      .limit(1);
    const [row] = await (options.forUpdate ? query.for('update') : query);
    return row;
  }

  async insertExclusion(values: NewUserProgramExclusion) {
    try {
      const [header] = await this.db
        .insert(userProgramExclusions)
        .values(values);
      const [exclusion] = await this.db
        .select()
        .from(userProgramExclusions)
        .where(eq(userProgramExclusions.id, header.insertId))
        .limit(1);
      if (!exclusion)
        throw new Error('Inserted exclusion could not be read back');
      return { kind: 'created' as const, exclusion };
    } catch (error) {
      if (isDuplicateKeyError(error)) return { kind: 'duplicate' as const };
      throw error;
    }
  }

  async endExclusion(id: number, end: ExclusionEnd) {
    const [header] = await this.db
      .update(userProgramExclusions)
      .set({
        status: end.status,
        endedBy: end.endedBy,
        endReason: end.endReason,
        endedAt: end.at,
      })
      .where(
        and(
          eq(userProgramExclusions.id, id),
          eq(userProgramExclusions.status, 'active'),
        ),
      );
    return header.affectedRows > 0;
  }
}
