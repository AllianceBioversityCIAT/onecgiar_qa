// P2-3911: issuing SP link codes and trading them for SP sessions
// (docs/sp-view/reporting-integration.md § 2, § 3).
import { Inject, Injectable } from '@nestjs/common';
import {
  ADMIN_CONFIG_CLOCK,
  type AdminConfigClock,
} from '../../admin-config/admin-config.clock.js';
import { CatalogService } from '../../users/catalogs/catalog.service.js';
import type { ScienceProgramOption } from '../../users/catalogs/catalogs.ports.js';
import { logSpAccess, withSpLog } from './sp-log.js';
import {
  SP_ACCESS_STORE,
  type SpAccessStore,
  type SpSessionPrincipal,
} from './sp-access.store.js';
import { newOpaqueSecret, sha256Hex } from './sp-tokens.js';
import { SpCodeInvalidError, SpProgramUnknownError } from './sp-view.errors.js';

/** A code works once and lasts 60 s (contract § 2). */
export const SP_CODE_TTL_MS = 60_000;
/** An SP session lasts 8 h from the exchange (contract § 3). */
export const SP_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export interface IssueSpCodeInput {
  email: string;
  name: string;
  programCode: string | null;
  isReportingAdmin: boolean;
}

export interface SpProgram {
  id: number;
  code: string;
  name: string;
}

/** `GET /sp/me`: who the session is and which programs it may open. */
export interface SpMe {
  user: { name: string };
  isReportingAdmin: boolean;
  program: SpProgram | null;
  programs: SpProgram[];
}

export interface IssuedSpCode {
  code: string;
  expiresAt: string;
}

export interface SpSessionAnswer {
  accessToken: string;
  expiresAt: string;
  user: { name: string };
  program: SpProgram | null;
  isReportingAdmin: boolean;
}

const programOf = (p: ScienceProgramOption): SpProgram => ({
  id: p.id,
  code: p.code,
  name: p.name,
});

@Injectable()
export class SpAccessService {
  constructor(
    @Inject(SP_ACCESS_STORE) private readonly store: SpAccessStore,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(ADMIN_CONFIG_CLOCK) private readonly clock: AdminConfigClock,
  ) {}

  /**
   * Issues a one-time code for the user the Reporting back vouches for. The
   * program code is resolved against the Science Program catalog (trimmed,
   * case-insensitive); unknown, or null for a non-admin, is
   * `SP_PROGRAM_UNKNOWN`. Only the SHA-256 of the code is stored.
   */
  issueCode(input: IssueSpCodeInput, requestId: string): Promise<IssuedSpCode> {
    return withSpLog(
      (outcome, reason) =>
        logSpAccess({ action: 'issue', outcome, reason, requestId }),
      async () => {
        let programId: number | null = null;
        if (input.programCode !== null) {
          const program = await this.findProgram(input.programCode);
          if (program === undefined) throw new SpProgramUnknownError();
          programId = program.id;
        } else if (!input.isReportingAdmin) {
          throw new SpProgramUnknownError();
        }
        const now = this.clock();
        const expiresAt = new Date(now.getTime() + SP_CODE_TTL_MS);
        const code = newOpaqueSecret();
        await this.store.insertCode({
          codeHash: sha256Hex(code),
          email: input.email.toLowerCase(),
          name: input.name,
          programId,
          isReportingAdmin: input.isReportingAdmin,
          createdAt: now,
          expiresAt,
        });
        return { code, expiresAt: expiresAt.toISOString() };
      },
    );
  }

  /**
   * Trades a code for an SP session (8 h). Unknown, used and expired codes
   * get one identical 401 `SP_CODE_INVALID`. The session token is random and
   * stored only as its SHA-256.
   */
  exchange(code: string, requestId: string): Promise<SpSessionAnswer> {
    return withSpLog(
      (outcome, reason) =>
        logSpAccess({ action: 'exchange', outcome, reason, requestId }),
      async () => {
        const now = this.clock();
        const token = newOpaqueSecret();
        const expiresAt = new Date(now.getTime() + SP_SESSION_TTL_MS);
        const session = await this.store.exchangeCode(sha256Hex(code), now, {
          tokenHash: sha256Hex(token),
          createdAt: now,
          expiresAt,
        });
        if (session === null) throw new SpCodeInvalidError();
        const program =
          session.programId === null
            ? null
            : await this.programById(session.programId);
        return {
          accessToken: token,
          expiresAt: expiresAt.toISOString(),
          user: { name: session.name },
          program,
          isReportingAdmin: session.isReportingAdmin,
        };
      },
    );
  }

  /**
   * The session's identity and programs: an admin may open every Science
   * Program of the catalog; anyone else only theirs.
   */
  async me(session: SpSessionPrincipal): Promise<SpMe> {
    const all = await this.allPrograms();
    const program =
      session.programId === null
        ? null
        : (all.find((p) => p.id === session.programId) ?? null);
    return {
      user: { name: session.name },
      isReportingAdmin: session.isReportingAdmin,
      program,
      programs: session.isReportingAdmin
        ? all
        : program === null
          ? []
          : [program],
    };
  }

  /** The catalog entry of a CLARISA id; null when the catalog no longer lists it. */
  async programById(id: number): Promise<SpProgram | null> {
    const found = (await this.catalog.listSciencePrograms()).find(
      (p) => p.id === id,
    );
    return found === undefined ? null : programOf(found);
  }

  /** Every Science Program of the catalog. */
  async allPrograms(): Promise<SpProgram[]> {
    return (await this.catalog.listSciencePrograms()).map(programOf);
  }

  private async findProgram(
    code: string,
  ): Promise<ScienceProgramOption | undefined> {
    const wanted = code.trim().toLowerCase();
    if (wanted.length === 0) return undefined;
    return (await this.catalog.listSciencePrograms()).find(
      (p) => p.code.trim().toLowerCase() === wanted,
    );
  }
}
