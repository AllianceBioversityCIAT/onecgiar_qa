// P2-3911: persistence of the SP link codes and SP sessions (port + Drizzle
// adapter). Only hashes are stored and looked up.
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, gte, isNull } from 'drizzle-orm';
import { DRIZZLE } from '../../database/drizzle/drizzle.constants.js';
import type { DrizzleDB } from '../../database/drizzle/drizzle.module.js';
import {
  spLinkCodes,
  spSessions,
} from '../../database/drizzle/schema/sp-access.js';

export const SP_ACCESS_STORE = Symbol('SP_ACCESS_STORE');

/** Who an SP code or session stands for (Reporting decided it; QA trusts the machine call). */
export interface SpIdentity {
  email: string;
  name: string;
  /** CLARISA id of the program; null only for a Reporting admin who sent none. */
  programId: number | null;
  isReportingAdmin: boolean;
}

/** A live SP session, as the guard attaches it to the request. */
export interface SpSessionPrincipal extends SpIdentity {
  id: number;
}

export interface NewSpCode extends SpIdentity {
  codeHash: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface NewSpSession {
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface SpAccessStore {
  insertCode(code: NewSpCode): Promise<void>;
  /**
   * In ONE transaction: marks the code used by a conditional UPDATE (unused and
   * not expired at `now`), and only when exactly that row changed, reads it and
   * inserts the session. Null when the code is unknown, used or expired.
   */
  exchangeCode(
    codeHash: string,
    now: Date,
    session: NewSpSession,
  ): Promise<SpSessionPrincipal | null>;
  /** The session with this token hash that is still live at `now`, or null. */
  findLiveSession(
    tokenHash: string,
    now: Date,
  ): Promise<SpSessionPrincipal | null>;
}

@Injectable()
export class DrizzleSpAccessStore implements SpAccessStore {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async insertCode(code: NewSpCode): Promise<void> {
    await this.db.insert(spLinkCodes).values({
      codeHash: code.codeHash,
      email: code.email,
      name: code.name,
      programId: code.programId,
      isReportingAdmin: code.isReportingAdmin,
      createdAt: code.createdAt,
      expiresAt: code.expiresAt,
    });
  }

  exchangeCode(
    codeHash: string,
    now: Date,
    session: NewSpSession,
  ): Promise<SpSessionPrincipal | null> {
    return this.db.transaction(
      async (tx) => {
        // The database decides: of two concurrent exchanges of one code, only
        // one UPDATE matches the row (used_at IS NULL), the other gets 0 rows.
        const [header] = await tx
          .update(spLinkCodes)
          .set({ usedAt: now })
          .where(
            and(
              eq(spLinkCodes.codeHash, codeHash),
              isNull(spLinkCodes.usedAt),
              gte(spLinkCodes.expiresAt, now),
            ),
          );
        if (header.affectedRows !== 1) return null;
        const [code] = await tx
          .select({
            email: spLinkCodes.email,
            name: spLinkCodes.name,
            programId: spLinkCodes.programId,
            isReportingAdmin: spLinkCodes.isReportingAdmin,
          })
          .from(spLinkCodes)
          .where(eq(spLinkCodes.codeHash, codeHash));
        if (code === undefined) return null;
        const [inserted] = await tx.insert(spSessions).values({
          tokenHash: session.tokenHash,
          email: code.email,
          name: code.name,
          programId: code.programId,
          isReportingAdmin: code.isReportingAdmin,
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
        });
        return { id: inserted.insertId, ...code };
      },
      { isolationLevel: 'read committed' },
    );
  }

  async findLiveSession(
    tokenHash: string,
    now: Date,
  ): Promise<SpSessionPrincipal | null> {
    const [row] = await this.db
      .select({
        id: spSessions.id,
        email: spSessions.email,
        name: spSessions.name,
        programId: spSessions.programId,
        isReportingAdmin: spSessions.isReportingAdmin,
      })
      .from(spSessions)
      .where(
        and(eq(spSessions.tokenHash, tokenHash), gt(spSessions.expiresAt, now)),
      )
      .limit(1);
    return row ?? null;
  }
}
