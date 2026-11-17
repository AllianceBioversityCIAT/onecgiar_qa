// P2-3911: in-memory fakes of the SP view stores, same contract as the Drizzle
// adapters (only hashes stored; the code is spent by a conditional update).
import type {
  NewSpCode,
  NewSpSession,
  SpAccessStore,
  SpSessionPrincipal,
} from '../../src/assessment/sp-view/sp-access.store.js';

export interface FakeSpCodeRow extends NewSpCode {
  id: number;
  usedAt: Date | null;
}

export interface FakeSpSessionRow extends NewSpSession {
  id: number;
  email: string;
  name: string;
  programId: number | null;
  isReportingAdmin: boolean;
}

export class InMemorySpAccessStore implements SpAccessStore {
  codes: FakeSpCodeRow[] = [];
  sessions: FakeSpSessionRow[] = [];
  /** Lookups of a session, to prove a guard refused before reading. */
  lookups = 0;

  insertCode(code: NewSpCode): Promise<void> {
    if (this.codes.some((c) => c.codeHash === code.codeHash)) {
      return Promise.reject(new Error('duplicate code_hash'));
    }
    this.codes.push({ ...code, id: this.codes.length + 1, usedAt: null });
    return Promise.resolve();
  }

  exchangeCode(
    codeHash: string,
    now: Date,
    session: NewSpSession,
  ): Promise<SpSessionPrincipal | null> {
    // The conditional UPDATE: unused, not expired, this hash.
    const row = this.codes.find(
      (c) =>
        c.codeHash === codeHash &&
        c.usedAt === null &&
        c.expiresAt.getTime() >= now.getTime(),
    );
    if (row === undefined) return Promise.resolve(null);
    row.usedAt = now;
    const inserted: FakeSpSessionRow = {
      ...session,
      id: this.sessions.length + 1,
      email: row.email,
      name: row.name,
      programId: row.programId,
      isReportingAdmin: row.isReportingAdmin,
    };
    this.sessions.push(inserted);
    return Promise.resolve(principalOf(inserted));
  }

  findLiveSession(
    tokenHash: string,
    now: Date,
  ): Promise<SpSessionPrincipal | null> {
    this.lookups++;
    const row = this.sessions.find(
      (s) => s.tokenHash === tokenHash && s.expiresAt.getTime() > now.getTime(),
    );
    return Promise.resolve(row === undefined ? null : principalOf(row));
  }
}

const principalOf = (s: FakeSpSessionRow): SpSessionPrincipal => ({
  id: s.id,
  email: s.email,
  name: s.name,
  programId: s.programId,
  isReportingAdmin: s.isReportingAdmin,
});
