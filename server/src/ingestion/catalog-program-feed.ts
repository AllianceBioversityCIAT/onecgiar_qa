// @akili-spec ingestion/step-1-loads
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  SCIENCE_PROGRAM_SOURCE,
  type ScienceProgramOption,
  type ScienceProgramSource,
} from '../users/catalogs/catalogs.ports.js';
import { ReportingResultsFeedClient } from './reporting-results-feed.client.js';
import {
  FeedError,
  type FeedDetails,
  type FeedDetailsQuery,
  type FeedIntake,
  type FeedIntakeQuery,
  type FeedListQuery,
  type FeedPage,
  type FeedRelease,
  type FeedReleaseQuery,
  type ResultsFeed,
} from './results-feed.port.js';

/** How long the program catalog is reused between feed pages and loads. */
const PROGRAMS_FRESH_MS = 10 * 60 * 1000;

/**
 * Puts the QA program ids on the feed. Reporting identifies a program by its
 * own `clarisa_initiatives.id` (SP01 = 50), while QA's catalog, the timeline
 * scope and the SP session use the CLARISA `cgiar-entities` id (SP01 = 441).
 * The official code is the only key both share, so:
 * - a program filter goes out as `program_codes`, never as `program_ids`;
 * - every item and `byProgram` row comes back with the QA catalog id.
 * A code missing from the catalog keeps Reporting's id and is logged (no
 * personal data); a filter id missing from the catalog fails the call, since
 * dropping it would widen the scope.
 */
@Injectable()
export class CatalogProgramResultsFeed implements ResultsFeed {
  private readonly logger = new Logger(CatalogProgramResultsFeed.name);
  private cached?: { at: number; programs: ScienceProgramOption[] };

  constructor(
    private readonly inner: ReportingResultsFeedClient,
    @Inject(SCIENCE_PROGRAM_SOURCE)
    private readonly programs: ScienceProgramSource,
  ) {}

  async list(query: FeedListQuery): Promise<FeedPage> {
    const programs = await this.catalog();
    const idByCode = new Map(programs.map((p) => [p.code, p.id]));
    const codeById = new Map(programs.map((p) => [p.id, p.code]));
    const { programIds, ...rest } = query;
    let programCodes = query.programCodes;
    if (programIds?.length) {
      programCodes = programIds.map((id) => {
        const code = codeById.get(id);
        if (code === undefined) throw new FeedError('unavailable');
        return code;
      });
    }
    const page = await this.inner.list({
      ...rest,
      ...(programCodes?.length ? { programCodes } : {}),
    });
    const toQa = (clarisaId: number, code: string): number => {
      const id = idByCode.get(code);
      if (id === undefined) {
        this.logger.warn(`program_not_in_catalog code=${code}`);
        return clarisaId;
      }
      return id;
    };
    return {
      ...page,
      breakdown: {
        ...page.breakdown,
        byProgram: page.breakdown.byProgram.map((row) => ({
          ...row,
          clarisaId: toQa(row.clarisaId, row.code),
        })),
      },
      items: page.items.map((item) => ({
        ...item,
        program: {
          ...item.program,
          clarisaId: toQa(item.program.clarisaId, item.program.code),
        },
      })),
    };
  }

  details(query: FeedDetailsQuery): Promise<FeedDetails> {
    return this.inner.details(query);
  }

  intake(query: FeedIntakeQuery): Promise<FeedIntake> {
    return this.inner.intake(query);
  }

  release(query: FeedReleaseQuery): Promise<FeedRelease> {
    return this.inner.release(query);
  }

  private async catalog(): Promise<ScienceProgramOption[]> {
    const now = Date.now();
    if (this.cached && now - this.cached.at < PROGRAMS_FRESH_MS) {
      return this.cached.programs;
    }
    try {
      const programs = await this.programs.list();
      this.cached = { at: now, programs };
      return programs;
    } catch {
      if (this.cached) return this.cached.programs;
      throw new FeedError('unavailable');
    }
  }
}
