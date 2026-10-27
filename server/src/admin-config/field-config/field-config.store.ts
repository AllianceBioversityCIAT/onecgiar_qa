// @akili-spec admin-config/field-configuration
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { DRIZZLE } from '../../database/drizzle/drizzle.constants.js';
import type { DrizzleDB } from '../../database/drizzle/drizzle.module.js';
import {
  cycles,
  type Cycle,
  type CycleStatus,
} from '../../database/drizzle/schema/cycles.js';
import {
  fieldConfigAuditEvents,
  type FieldConfigAuditAction,
  type FieldConfigAuditChanges,
  type FieldConfigAuditTimelines,
} from '../../database/drizzle/schema/field-config-audit-events.js';
import { fieldConfigDraftItems } from '../../database/drizzle/schema/field-config-draft-items.js';
import {
  fieldConfigDrafts,
  type FieldConfigDraft,
} from '../../database/drizzle/schema/field-config-drafts.js';
import { fieldConfigVersionItems } from '../../database/drizzle/schema/field-config-version-items.js';
import {
  fieldConfigVersions,
  type FieldConfigVersion,
} from '../../database/drizzle/schema/field-config-versions.js';
import { timelineResultTypes } from '../../database/drizzle/schema/timeline-result-types.js';
import { timelineSteps } from '../../database/drizzle/schema/timeline-steps.js';
import { timelines } from '../../database/drizzle/schema/timelines.js';
import { isDuplicateKeyError } from '../../users/users.errors.js';
import type { ConfigItem } from './field-config-diff.js';
import type { TimelineStart } from './field-config-versions.js';

export const FIELD_CONFIG_STORE = Symbol('FIELD_CONFIG_STORE');

/**
 * A timeline as the preview lists it: the dates and scope the pure rules read,
 * plus its `name` for the receive and keep lists (FR-7). Added at T-6: the same
 * first statement of `listTimelineStarts` carries it, so the count stays three.
 */
export type NamedTimelineStart = TimelineStart & { name: string };

/** The cycle as the module reads it: the catalog is read for its `year`, and a closed cycle refuses writes (FR-13). */
export type FieldConfigCycle = Pick<Cycle, 'id' | 'year' | 'status'>;

/** Who wrote the draft and when: `updated_at` and `updated_by` are set together (`chk_field_config_drafts_updated`). */
export interface DraftWrite {
  updatedAt: Date;
  updatedBy: number;
}

/**
 * How the UPDATE of the draft's revision ended: applied, or refused because the
 * revision moved (or the draft row is gone). The affected-row count decides,
 * never a read before it (design 7.3, DD-6).
 */
export type RevisionOutcome = { kind: 'updated' } | { kind: 'stale' };

/** The values of a new version (`number` counts the cycle's versions from 1). */
export interface NewVersionValues {
  cycleId: number;
  number: number;
  catalogVersion: string;
  publishedAt: Date;
  publishedBy: number;
  requestId: string | null;
}

/**
 * How the insert of a version ended: written, or refused by
 * `uq_field_config_versions_cycle_number`, the database backstop of two
 * publications that both computed the same number (FR-8, DD-6). `duplicate` is
 * the same answer to the caller as `stale`: nothing was published.
 */
export type VersionInsertOutcome =
  { kind: 'created'; versionId: number } | { kind: 'duplicate' };

/** One audit row of a publication (FR-11, DD-10): `createdAt` is the publish instant. */
export interface NewFieldConfigAuditValues {
  cycleId: number;
  versionId: number;
  actorId: number;
  action: FieldConfigAuditAction;
  changes: FieldConfigAuditChanges;
  timelines: FieldConfigAuditTimelines;
  requestId: string | null;
  createdAt: Date;
}

/**
 * The persistence port of the field configuration (design 3, 5, 7.3). Rules
 * live in `FieldConfigService` and the pure functions of this folder.
 *
 * Every method is ONE statement, except `listTimelineStarts` (three), so the
 * number of statements of a request depends on the flow and never on the number
 * of fields, draft items or timelines (NFR-5). Reads never lock and never write.
 */
export interface FieldConfigStore {
  /** The cycle's id, year and status. A plain read. */
  findCycle(cycleId: number): Promise<FieldConfigCycle | undefined>;
  /** The draft row (`revision`, last writer); `undefined` while nobody wrote a draft (DD-10). A plain read. */
  findDraft(cycleId: number): Promise<FieldConfigDraft | undefined>;
  /** Every draft item of the cycle, ordered by result type then field key: ONE statement. */
  listDraftItems(cycleId: number): Promise<ConfigItem[]>;
  /** The cycle's highest-numbered version, `undefined` with none: ONE statement, through the unique (`cycle_id`, `number`) index. */
  latestVersion(cycleId: number): Promise<FieldConfigVersion | undefined>;
  /** Every version of the cycle, lowest number first (number and publish instant feed `versionFor`): ONE statement. */
  listVersions(cycleId: number): Promise<FieldConfigVersion[]>;
  /** The items of one version, ordered by result type then field key, for one result type or for all: ONE statement. */
  listVersionItems(
    versionId: number,
    resultTypeKey?: string,
  ): Promise<ConfigItem[]>;
  /**
   * What `receiveAndKeep` and `versionFor` need of the cycle's timelines
   * (design 7.3, DD-1): ids, scope and dates, from THREE statements whatever the
   * number of timelines, even none (timelines of the cycle, their steps, their
   * scope rows; the last two are keyed by the cycle through a subquery, not by
   * the ids of the first). `opensOn` is step 1's, `closesOn` the latest
   * `closes_on`, both `null` for a timeline with no steps. No load signal is read
   * (DD-8a). Ordered by timeline id. It mirrors `TimelinesService.respond()`.
   */
  listTimelineStarts(cycleId: number): Promise<NamedTimelineStart[]>;

  /**
   * `SELECT status FROM cycles WHERE id = ? FOR SHARE` (design 7.3, P-11): the
   * same lock as a timeline edit, assign or remove, so an activation that closes
   * the cycle (it takes `FOR UPDATE`) waits for the write or is seen by it.
   * `undefined` = no such cycle.
   */
  lockCycleShared(cycleId: number): Promise<CycleStatus | undefined>;
  /**
   * `INSERT` the draft row with revision 0 if the cycle has none, else change
   * nothing (`ON DUPLICATE KEY UPDATE` of the key onto itself): the first draft
   * write creates the row (DD-10). It leaves the row locked by this transaction.
   */
  ensureDraft(cycleId: number): Promise<void>;
  /**
   * `SELECT ... FOR UPDATE` of the draft row (DD-6: the cycle row first, then
   * this one). Waits for a transaction that holds the row and answers what that
   * transaction committed, so the caller sees the revision as it is NOW.
   * `undefined` = no draft row.
   */
  lockDraft(cycleId: number): Promise<FieldConfigDraft | undefined>;
  /**
   * One multi-row `INSERT ... ON DUPLICATE KEY UPDATE`: the later write of a
   * (type, field) wins (S-10). No statement for an empty list.
   */
  upsertDraftItems(
    cycleId: number,
    items: readonly ConfigItem[],
  ): Promise<void>;
  /**
   * `UPDATE field_config_drafts SET revision = revision + 1 [, updated_at = ?,
   * updated_by = ?] WHERE cycle_id = ? [AND revision = ?]` (DD-6, design 7.3).
   * `change` is the draft write's author: a draft edit and a discard pass it; a
   * publish does not, so it leaves `updated_*` as the last draft write set them
   * (design 7.2 publish step 3). With `expectedRevision` the revision is in the
   * WHERE and the affected-row count decides: 0 rows is `stale`. Without it (a
   * draft edit or a discard, which always win) the bump is unconditional and
   * 0 rows only means the row is gone.
   */
  bumpRevision(
    cycleId: number,
    change?: DraftWrite,
    expectedRevision?: number,
  ): Promise<RevisionOutcome>;
  /** `DELETE` every draft item of the cycle (a discard, FR-6). */
  deleteDraftItems(cycleId: number): Promise<void>;
  /** `INSERT ... SELECT`: the version's items become the draft's items, in ONE statement (FR-6). The draft items were deleted first. */
  copyVersionToDraft(cycleId: number, versionId: number): Promise<void>;
  /**
   * `INSERT`; a number already taken in the cycle
   * (`uq_field_config_versions_cycle_number`, MySQL 1062) is `duplicate`. Any
   * other failure is thrown. The caller reads the number under the draft lock.
   */
  insertVersion(values: NewVersionValues): Promise<VersionInsertOutcome>;
  /** One multi-row `INSERT`, one row per applicable field (DD-2). No statement for an empty list. */
  insertVersionItems(
    versionId: number,
    items: readonly ConfigItem[],
  ): Promise<void>;
  /** `INSERT` one audit row; append-only, written on the publication's transaction (FR-11, DD-10). */
  insertAuditEvent(values: NewFieldConfigAuditValues): Promise<void>;
  /**
   * A publication as recorded: the version and the receive / keep lists of its
   * audit row (DD-9), ONE statement through the unique `version_id`. Added at
   * T-8 for the idempotency replay reader. `undefined` = no such version.
   */
  findPublication(versionId: number): Promise<Publication | undefined>;
}

/** What a replay needs of a publication: its version and the lists stored in its audit row. */
export interface Publication {
  version: FieldConfigVersion;
  timelines: FieldConfigAuditTimelines;
}

type FieldConfigDb = Pick<DrizzleDB, 'select' | 'insert' | 'update' | 'delete'>;

const itemColumns = (
  table: typeof fieldConfigDraftItems | typeof fieldConfigVersionItems,
) => ({
  resultTypeKey: table.resultTypeKey,
  fieldKey: table.fieldKey,
  visibility: table.visibility,
  isCore: table.isCore,
  isAiInput: table.isAiInput,
});

/** Drizzle adapter of `FieldConfigStore`. `db` is the pool for reads or a transaction handle (`DrizzleFieldConfigUnitOfWork`). */
@Injectable()
export class DrizzleFieldConfigStore implements FieldConfigStore {
  constructor(@Inject(DRIZZLE) private readonly db: FieldConfigDb) {}

  async findCycle(cycleId: number): Promise<FieldConfigCycle | undefined> {
    const [row] = await this.db
      .select({ id: cycles.id, year: cycles.year, status: cycles.status })
      .from(cycles)
      .where(eq(cycles.id, cycleId))
      .limit(1);
    return row;
  }

  async findDraft(cycleId: number): Promise<FieldConfigDraft | undefined> {
    const [row] = await this.db
      .select()
      .from(fieldConfigDrafts)
      .where(eq(fieldConfigDrafts.cycleId, cycleId))
      .limit(1);
    return row;
  }

  listDraftItems(cycleId: number): Promise<ConfigItem[]> {
    return this.db
      .select(itemColumns(fieldConfigDraftItems))
      .from(fieldConfigDraftItems)
      .where(eq(fieldConfigDraftItems.cycleId, cycleId))
      .orderBy(
        asc(fieldConfigDraftItems.resultTypeKey),
        asc(fieldConfigDraftItems.fieldKey),
      );
  }

  async findPublication(versionId: number): Promise<Publication | undefined> {
    const [row] = await this.db
      .select({
        version: fieldConfigVersions,
        timelines: fieldConfigAuditEvents.timelines,
      })
      .from(fieldConfigVersions)
      .innerJoin(
        fieldConfigAuditEvents,
        eq(fieldConfigAuditEvents.versionId, fieldConfigVersions.id),
      )
      .where(eq(fieldConfigVersions.id, versionId))
      .limit(1);
    return row;
  }

  async latestVersion(
    cycleId: number,
  ): Promise<FieldConfigVersion | undefined> {
    const [row] = await this.db
      .select()
      .from(fieldConfigVersions)
      .where(eq(fieldConfigVersions.cycleId, cycleId))
      .orderBy(desc(fieldConfigVersions.number))
      .limit(1);
    return row;
  }

  listVersions(cycleId: number): Promise<FieldConfigVersion[]> {
    return this.db
      .select()
      .from(fieldConfigVersions)
      .where(eq(fieldConfigVersions.cycleId, cycleId))
      .orderBy(asc(fieldConfigVersions.number));
  }

  listVersionItems(
    versionId: number,
    resultTypeKey?: string,
  ): Promise<ConfigItem[]> {
    return this.db
      .select(itemColumns(fieldConfigVersionItems))
      .from(fieldConfigVersionItems)
      .where(
        resultTypeKey === undefined
          ? eq(fieldConfigVersionItems.versionId, versionId)
          : and(
              eq(fieldConfigVersionItems.versionId, versionId),
              eq(fieldConfigVersionItems.resultTypeKey, resultTypeKey),
            ),
      )
      .orderBy(
        asc(fieldConfigVersionItems.resultTypeKey),
        asc(fieldConfigVersionItems.fieldKey),
      );
  }

  async listTimelineStarts(cycleId: number): Promise<NamedTimelineStart[]> {
    // Three statements whatever the number of timelines, even none: the steps
    // and the scope rows are keyed by the cycle through a subquery, so no
    // statement waits for the ids of the one before it and none is skipped.
    const rows = await this.db
      .select({
        id: timelines.id,
        name: timelines.name,
        allResultTypes: timelines.allResultTypes,
      })
      .from(timelines)
      .where(eq(timelines.cycleId, cycleId))
      .orderBy(asc(timelines.id));
    const ofCycle = this.db
      .select({ id: timelines.id })
      .from(timelines)
      .where(eq(timelines.cycleId, cycleId));
    const steps = await this.db
      .select({
        timelineId: timelineSteps.timelineId,
        position: timelineSteps.position,
        opensOn: timelineSteps.opensOn,
        closesOn: timelineSteps.closesOn,
      })
      .from(timelineSteps)
      .where(inArray(timelineSteps.timelineId, ofCycle));
    const scope = await this.db
      .select({
        timelineId: timelineResultTypes.timelineId,
        resultTypeKey: timelineResultTypes.resultTypeKey,
      })
      .from(timelineResultTypes)
      .where(inArray(timelineResultTypes.timelineId, ofCycle))
      .orderBy(asc(timelineResultTypes.resultTypeKey));

    return rows.map((row) => {
      const own = steps.filter((step) => step.timelineId === row.id);
      // Step 1 is the lowest position; the finish is the latest `closes_on`.
      // Dates are `YYYY-MM-DD` strings, compared as strings (P-13).
      const first = own.reduce<(typeof own)[number] | undefined>(
        (best, step) =>
          best === undefined || step.position < best.position ? step : best,
        undefined,
      );
      const last = own.reduce<string | null>(
        (best, step) =>
          best === null || step.closesOn > best ? step.closesOn : best,
        null,
      );
      return {
        id: row.id,
        name: row.name,
        opensOn: first?.opensOn ?? null,
        closesOn: last,
        allResultTypes: row.allResultTypes,
        resultTypeKeys: scope
          .filter((entry) => entry.timelineId === row.id)
          .map((entry) => entry.resultTypeKey),
      };
    });
  }

  async lockCycleShared(cycleId: number): Promise<CycleStatus | undefined> {
    const [row] = await this.db
      .select({ status: cycles.status })
      .from(cycles)
      .where(eq(cycles.id, cycleId))
      .limit(1)
      .for('share');
    return row?.status;
  }

  async ensureDraft(cycleId: number): Promise<void> {
    // The key onto itself: on a duplicate the row is only locked, never changed.
    await this.db
      .insert(fieldConfigDrafts)
      .values({ cycleId })
      .onDuplicateKeyUpdate({ set: { cycleId } });
  }

  async lockDraft(cycleId: number): Promise<FieldConfigDraft | undefined> {
    const [row] = await this.db
      .select()
      .from(fieldConfigDrafts)
      .where(eq(fieldConfigDrafts.cycleId, cycleId))
      .limit(1)
      .for('update');
    return row;
  }

  async upsertDraftItems(
    cycleId: number,
    items: readonly ConfigItem[],
  ): Promise<void> {
    if (items.length === 0) return;
    // `VALUES()` is deprecated since MySQL 8.0.20 but still supported on 8.x;
    // the row-alias form has no drizzle builder. The column is unqualified on
    // purpose, as in the schema's CHECKs.
    await this.db
      .insert(fieldConfigDraftItems)
      .values(items.map((item) => ({ cycleId, ...item })))
      .onDuplicateKeyUpdate({
        set: {
          visibility: sql`values(${sql.identifier('visibility')})`,
          isCore: sql`values(${sql.identifier('is_core')})`,
          isAiInput: sql`values(${sql.identifier('is_ai_input')})`,
        },
      });
  }

  async bumpRevision(
    cycleId: number,
    change?: DraftWrite,
    expectedRevision?: number,
  ): Promise<RevisionOutcome> {
    // The revision is in the WHERE, so the database decides (DD-6, KZ
    // cycle-timelines-1): a row whose revision moved matches nothing. The
    // revision always changes, so `affectedRows` counts the matched row. Without
    // `change` (a publish) `updated_*` are not in the SET: both stay as they
    // were, which keeps `chk_field_config_drafts_updated` (both or none).
    const [header] = await this.db
      .update(fieldConfigDrafts)
      .set({
        revision: sql`${fieldConfigDrafts.revision} + 1`,
        ...(change === undefined
          ? {}
          : { updatedAt: change.updatedAt, updatedBy: change.updatedBy }),
      })
      .where(
        expectedRevision === undefined
          ? eq(fieldConfigDrafts.cycleId, cycleId)
          : and(
              eq(fieldConfigDrafts.cycleId, cycleId),
              eq(fieldConfigDrafts.revision, expectedRevision),
            ),
      );
    return header.affectedRows > 0 ? { kind: 'updated' } : { kind: 'stale' };
  }

  async deleteDraftItems(cycleId: number): Promise<void> {
    await this.db
      .delete(fieldConfigDraftItems)
      .where(eq(fieldConfigDraftItems.cycleId, cycleId));
  }

  async copyVersionToDraft(cycleId: number, versionId: number): Promise<void> {
    await this.db.insert(fieldConfigDraftItems).select((qb) =>
      qb
        .select({
          cycleId: sql<number>`${cycleId}`.as('cycle_id'),
          resultTypeKey: fieldConfigVersionItems.resultTypeKey,
          fieldKey: fieldConfigVersionItems.fieldKey,
          visibility: fieldConfigVersionItems.visibility,
          isCore: fieldConfigVersionItems.isCore,
          isAiInput: fieldConfigVersionItems.isAiInput,
        })
        .from(fieldConfigVersionItems)
        .where(eq(fieldConfigVersionItems.versionId, versionId)),
    );
  }

  async insertVersion(values: NewVersionValues): Promise<VersionInsertOutcome> {
    try {
      const [header] = await this.db.insert(fieldConfigVersions).values(values);
      return { kind: 'created', versionId: header.insertId };
    } catch (error) {
      // The only unique key this insert can hit is (`cycle_id`, `number`): the
      // id is generated. Another publication took the number first, which is
      // the same answer as a stale revision (FR-8, DD-6); no retry (KZ).
      if (isDuplicateKeyError(error)) return { kind: 'duplicate' };
      throw error;
    }
  }

  async insertVersionItems(
    versionId: number,
    items: readonly ConfigItem[],
  ): Promise<void> {
    if (items.length === 0) return;
    await this.db
      .insert(fieldConfigVersionItems)
      .values(items.map((item) => ({ versionId, ...item })));
  }

  async insertAuditEvent(values: NewFieldConfigAuditValues): Promise<void> {
    await this.db.insert(fieldConfigAuditEvents).values(values);
  }
}
