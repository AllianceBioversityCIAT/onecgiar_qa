import type {
  DraftWrite,
  FieldConfigCycle,
  FieldConfigStore,
  NewFieldConfigAuditValues,
  NewVersionValues,
  RevisionOutcome,
  VersionInsertOutcome,
} from '../../src/admin-config/field-config/field-config.store.js';
import type {
  FieldConfigRepositories,
  FieldConfigUnitOfWork,
} from '../../src/admin-config/field-config/field-config.unit-of-work.js';
import type { ConfigItem } from '../../src/admin-config/field-config/field-config-diff.js';
import type { TimelineStart } from '../../src/admin-config/field-config/field-config-versions.js';
import type { CycleStatus } from '../../src/database/drizzle/schema/cycles.js';
import type { FieldConfigAuditEvent } from '../../src/database/drizzle/schema/field-config-audit-events.js';
import type { FieldConfigDraftItem } from '../../src/database/drizzle/schema/field-config-draft-items.js';
import type { FieldConfigDraft } from '../../src/database/drizzle/schema/field-config-drafts.js';
import type { FieldConfigVersionItem } from '../../src/database/drizzle/schema/field-config-version-items.js';
import type { FieldConfigVersion } from '../../src/database/drizzle/schema/field-config-versions.js';
import { InMemoryAdminConfigDatabase } from './in-memory-admin-config.js';
import { roundTrip } from './in-memory-idempotency.js';
import type {
  InMemoryTransaction,
  IsolationLevel,
  StatementOptions,
} from './in-memory-stores.js';

// Fake DB ports of the field configuration (field-configuration T-5). They
// emulate what MySQL guarantees for the five `field_config_*` tables: the draft
// primary key, the item primary keys, UNIQUE (`cycle_id`, `number`) of a
// version (`uq_field_config_versions_cycle_number`), UNIQUE (`version_id`) of an
// audit row, and the FR-4 CHECK on every item (`chk_field_config_*_flags`): a
// violated key raises MySQL's 1062 as a driver-shaped error, a violated CHECK
// raises 3819. Foreign keys are not emulated.
//
// The transactional store adds the row locks of `InMemoryDatabase` and a round
// trip per statement (`setImmediate`, as `in-memory-idempotency.ts`), so two
// transactions started together interleave at every statement and a flow that
// forgets a lock races exactly as it would on MySQL. What each statement locks
// is what InnoDB locks:
// - `lockCycleShared` is `FOR SHARE` on the cycle row (`cycles:<id>`, the key a
//   cycle activation takes `X` on, so the two serialize and two shares coexist);
// - `lockDraft` and `ensureDraft` take the draft row `X`, held to the commit;
// - the conditional UPDATE of `bumpRevision` takes the draft row `X` too and
//   judges its WHERE on the row as committed AFTER the wait, so the revision is
//   checked under the lock, never from a read before it (DD-6);
// - an INSERT of a version takes the unique entry of its number, so a second
//   insert of the same number waits for the first transaction and then finds the
//   number taken (or free, after a rollback);
// - an upsert of items takes each item row `X`.
// Dropping a lock or the `revision` condition changes a concurrency outcome in
// the spec on purpose (its falsifiers). It cannot show InnoDB's own behavior
// (KZ-admin-config--cycle-timelines-1): T-11 is the HITL run on MySQL.

function duplicateEntry(key: string): never {
  throw Object.assign(new Error(`Duplicate entry for key '${key}'`), {
    code: 'ER_DUP_ENTRY',
    errno: 1062,
    sqlMessage: `Duplicate entry for key '${key}'`,
  });
}

function checkFailed(name: string): never {
  throw Object.assign(new Error(`Check constraint '${name}' is violated.`), {
    code: 'ER_CHECK_CONSTRAINT_VIOLATED',
    errno: 3819,
  });
}

/** A `datetime` column holds no fractions: MySQL rounds a value with milliseconds to the nearest second. */
const toDatetime = (value: Date) =>
  new Date(Math.round(value.getTime() / 1000) * 1000);

/** The FR-4 CHECK of the draft and the version items, on the row as it would be stored. */
function assertFlags(table: string, item: ConfigItem): void {
  if (!((!item.isCore && !item.isAiInput) || item.visibility === 'assessed')) {
    checkFailed(`chk_${table}_flags`);
  }
}

const byItem = (a: ConfigItem, b: ConfigItem) =>
  a.resultTypeKey.localeCompare(b.resultTypeKey) ||
  a.fieldKey.localeCompare(b.fieldKey);

const asItem = (row: ConfigItem): ConfigItem => ({
  resultTypeKey: row.resultTypeKey,
  fieldKey: row.fieldKey,
  visibility: row.visibility,
  isCore: row.isCore,
  isAiInput: row.isAiInput,
});

const draftLock = (cycleId: number) => `field_config_drafts:${cycleId}`;
const itemLock = (cycleId: number, item: ConfigItem) =>
  `field_config_draft_items:${cycleId}:${item.resultTypeKey}:${item.fieldKey}`;
const versionNumberLock = (cycleId: number, number: number) =>
  `field_config_versions:${cycleId}:${number}`;

/** The rows a store reads and writes: the committed arrays (autocommit) or a transaction's own copies. */
export interface FieldConfigTables {
  drafts: FieldConfigDraft[];
  draftItems: FieldConfigDraftItem[];
  versions: FieldConfigVersion[];
  versionItems: FieldConfigVersionItem[];
  audit: FieldConfigAuditEvent[];
}

/** The committed tables of the field configuration, over the cycles and timelines of one `InMemoryAdminConfigDatabase` and its row locks. */
export class InMemoryFieldConfigDatabase {
  readonly drafts: FieldConfigDraft[] = [];
  readonly draftItems: FieldConfigDraftItem[] = [];
  readonly versions: FieldConfigVersion[] = [];
  readonly versionItems: FieldConfigVersionItem[] = [];
  readonly auditEvents: FieldConfigAuditEvent[] = [];
  readonly tables: FieldConfigTables = {
    drafts: this.drafts,
    draftItems: this.draftItems,
    versions: this.versions,
    versionItems: this.versionItems,
    audit: this.auditEvents,
  };
  /**
   * Every statement the store ran, in the order they RAN (after their locks):
   * `cycle:share:1`, `draft:lock:1`, `draft:bump:1`. One entry is one round
   * trip, so its length is the statement count of NFR-5 (a refused or no-op
   * statement counts too).
   */
  readonly statementLog: string[] = [];
  /** The read statements among them. */
  readonly readLog: string[] = [];
  /**
   * The writes that changed a row, in the order they ran: `draft:bump:1`,
   * `version:insert:1:2`, `audit:2`. A rolled-back write stays in it, so an empty
   * log proves that no write ran at all.
   */
  readonly writeLog: string[] = [];
  /** The autocommit store over the committed rows (reads, seeding, inspection). */
  readonly store: InMemoryFieldConfigStore;
  private issuedVersions = 0;
  private issuedAudit = 0;

  /** Pass the admin-config world to share its cycles, timelines, row locks and idempotency rows. */
  constructor(
    readonly world: InMemoryAdminConfigDatabase = new InMemoryAdminConfigDatabase(),
  ) {
    this.store = new InMemoryFieldConfigStore(this);
  }

  /** The users world's database: the row locks and the idempotency rows. */
  get base() {
    return this.world.base;
  }

  /** A fresh `field_config_versions` key, unique across transactions that insert at the same time. */
  nextVersionId(): number {
    const highest = this.versions.reduce((max, v) => Math.max(max, v.id), 0);
    this.issuedVersions = Math.max(this.issuedVersions, highest) + 1;
    return this.issuedVersions;
  }

  /** A fresh `field_config_audit_events` key, unique across transactions that insert at the same time. */
  nextAuditEventId(): number {
    const highest = this.auditEvents.reduce((max, e) => Math.max(max, e.id), 0);
    this.issuedAudit = Math.max(this.issuedAudit, highest) + 1;
    return this.issuedAudit;
  }
}

/**
 * Autocommit `FieldConfigStore` over the committed rows. Every method is one
 * statement (`listTimelineStarts`, three) that waits a round trip and is counted
 * in `statementLog`; the locks and the read view of a transaction belong to
 * `TransactionalFieldConfigStore`.
 */
export class InMemoryFieldConfigStore implements FieldConfigStore {
  constructor(
    protected readonly db: InMemoryFieldConfigDatabase,
    protected readonly rows: FieldConfigTables = db.tables,
  ) {}

  /** Where the locks are taken and the read view is set: nowhere for autocommit, the transaction for the subclass. */
  protected execute<R>(
    _options: StatementOptions,
    run: () => R | Promise<R>,
  ): Promise<R> {
    return Promise.resolve(run());
  }

  private async statement<R>(
    kind: 'read' | 'write',
    label: string,
    options: StatementOptions,
    run: () => R,
  ): Promise<R> {
    await roundTrip();
    return this.execute(options, () => {
      this.db.statementLog.push(label);
      if (kind === 'read') this.db.readLog.push(label);
      return run();
    });
  }

  private applied(label: string): void {
    this.db.writeLog.push(label);
  }

  findCycle(cycleId: number): Promise<FieldConfigCycle | undefined> {
    return this.statement('read', `cycle:${cycleId}`, {}, () => {
      const row = this.db.world.cycles.find((c) => c.id === cycleId);
      return row && { id: row.id, year: row.year, status: row.status };
    });
  }

  findDraft(cycleId: number): Promise<FieldConfigDraft | undefined> {
    return this.statement('read', `draft:${cycleId}`, {}, () =>
      structuredClone(this.rows.drafts.find((d) => d.cycleId === cycleId)),
    );
  }

  listDraftItems(cycleId: number): Promise<ConfigItem[]> {
    return this.statement('read', `draft-items:${cycleId}`, {}, () =>
      this.rows.draftItems
        .filter((i) => i.cycleId === cycleId)
        .map(asItem)
        .sort(byItem),
    );
  }

  latestVersion(cycleId: number): Promise<FieldConfigVersion | undefined> {
    return this.statement('read', `version:latest:${cycleId}`, {}, () => {
      const own = this.rows.versions.filter((v) => v.cycleId === cycleId);
      return structuredClone(
        own.reduce<FieldConfigVersion | undefined>(
          (best, v) =>
            best === undefined || v.number > best.number ? v : best,
          undefined,
        ),
      );
    });
  }

  listVersions(cycleId: number): Promise<FieldConfigVersion[]> {
    return this.statement('read', `versions:${cycleId}`, {}, () =>
      structuredClone(
        this.rows.versions
          .filter((v) => v.cycleId === cycleId)
          .sort((a, b) => a.number - b.number),
      ),
    );
  }

  listVersionItems(
    versionId: number,
    resultTypeKey?: string,
  ): Promise<ConfigItem[]> {
    return this.statement('read', `version-items:${versionId}`, {}, () =>
      this.rows.versionItems
        .filter(
          (i) =>
            i.versionId === versionId &&
            (resultTypeKey === undefined || i.resultTypeKey === resultTypeKey),
        )
        .map(asItem)
        .sort(byItem),
    );
  }

  /** Three statements, as the adapter: the timelines of the cycle, then the steps and the scope rows keyed by the cycle. */
  async listTimelineStarts(cycleId: number): Promise<TimelineStart[]> {
    const { world } = this.db;
    const timelines = await this.statement(
      'read',
      `timelines:cycle:${cycleId}`,
      {},
      () =>
        world.timelines
          .filter((t) => t.cycleId === cycleId)
          .sort((a, b) => a.id - b.id),
    );
    const owned = (timelineId: number) =>
      world.timelines.some((t) => t.id === timelineId && t.cycleId === cycleId);
    const steps = await this.statement(
      'read',
      `steps:cycle:${cycleId}`,
      {},
      () => structuredClone(world.steps.filter((s) => owned(s.timelineId))),
    );
    const scope = await this.statement(
      'read',
      `scope:cycle:${cycleId}`,
      {},
      () =>
        structuredClone(
          world.resultTypes
            .filter((r) => owned(r.timelineId))
            .sort((a, b) => a.resultTypeKey.localeCompare(b.resultTypeKey)),
        ),
    );
    return timelines.map((timeline) => {
      const own = steps.filter((s) => s.timelineId === timeline.id);
      const first = own.reduce<(typeof own)[number] | undefined>(
        (best, s) =>
          best === undefined || s.position < best.position ? s : best,
        undefined,
      );
      const last = own.reduce<string | null>(
        (best, s) => (best === null || s.closesOn > best ? s.closesOn : best),
        null,
      );
      return {
        id: timeline.id,
        opensOn: first?.opensOn ?? null,
        closesOn: last,
        allResultTypes: timeline.allResultTypes,
        resultTypeKeys: scope
          .filter((r) => r.timelineId === timeline.id)
          .map((r) => r.resultTypeKey),
      };
    });
  }

  /** `SELECT ... FOR SHARE` of the cycle row: waits for an activation's exclusive lock, and holds the shared one to the commit. */
  lockCycleShared(cycleId: number): Promise<CycleStatus | undefined> {
    return this.statement(
      'read',
      `cycle:share:${cycleId}`,
      { current: true, locks: [[`cycles:${cycleId}`, 'S']] },
      () => this.db.world.cycles.find((c) => c.id === cycleId)?.status,
    );
  }

  /** `INSERT ... ON DUPLICATE KEY UPDATE` of the key onto itself: creates the row, or only locks it. */
  ensureDraft(cycleId: number): Promise<void> {
    return this.statement(
      'write',
      `draft:ensure:${cycleId}`,
      { current: true, locks: [[draftLock(cycleId), 'X']] },
      () => {
        if (this.rows.drafts.some((d) => d.cycleId === cycleId)) return;
        this.rows.drafts.push({
          cycleId,
          revision: 0,
          updatedAt: null,
          updatedBy: null,
        });
        this.applied(`draft:ensure:${cycleId}`);
      },
    );
  }

  /** `SELECT ... FOR UPDATE`: the X lock on the draft row, held to the commit; a second one waits and then reads what the first committed. */
  lockDraft(cycleId: number): Promise<FieldConfigDraft | undefined> {
    return this.statement(
      'read',
      `draft:lock:${cycleId}`,
      { current: true, locks: [[draftLock(cycleId), 'X']] },
      () =>
        structuredClone(this.rows.drafts.find((d) => d.cycleId === cycleId)),
    );
  }

  upsertDraftItems(
    cycleId: number,
    items: readonly ConfigItem[],
  ): Promise<void> {
    if (items.length === 0) return Promise.resolve();
    const locks = [...new Set(items.map((i) => itemLock(cycleId, i)))]
      .sort()
      .map((key) => [key, 'X'] as const);
    return this.statement(
      'write',
      `draft-items:upsert:${cycleId}`,
      { current: true, locks },
      () => {
        // One statement: every row is checked before any is applied.
        for (const item of items) assertFlags('field_config_draft_items', item);
        for (const item of items) {
          const row = this.rows.draftItems.find(
            (r) =>
              r.cycleId === cycleId &&
              r.resultTypeKey === item.resultTypeKey &&
              r.fieldKey === item.fieldKey,
          );
          if (row) {
            row.visibility = item.visibility;
            row.isCore = item.isCore;
            row.isAiInput = item.isAiInput;
          } else {
            this.rows.draftItems.push({ cycleId, ...asItem(item) });
          }
        }
        this.applied(`draft-items:upsert:${cycleId}`);
      },
    );
  }

  /**
   * `UPDATE ... WHERE cycle_id = ? [AND revision = ?]`: the revision is judged on
   * the row as it is NOW, after the wait for its lock, so a transaction that
   * waited for another one's commit sees that commit (DD-6). `updated_*` change
   * only with `change` (a draft edit, a discard); a publish leaves them (7.3).
   */
  bumpRevision(
    cycleId: number,
    change?: DraftWrite,
    expectedRevision?: number,
  ): Promise<RevisionOutcome> {
    return this.statement(
      'write',
      `draft:bump:${cycleId}`,
      { current: true, locks: [[draftLock(cycleId), 'X']] },
      (): RevisionOutcome => {
        const row = this.rows.drafts.find(
          (d) =>
            d.cycleId === cycleId &&
            (expectedRevision === undefined || d.revision === expectedRevision),
        );
        if (!row) return { kind: 'stale' };
        row.revision += 1;
        if (change !== undefined) {
          row.updatedAt = toDatetime(change.updatedAt);
          row.updatedBy = change.updatedBy;
        }
        this.applied(`draft:bump:${cycleId}`);
        return { kind: 'updated' };
      },
    );
  }

  /** The DELETE locks the item rows visible when it is issued. */
  deleteDraftItems(cycleId: number): Promise<void> {
    const locks = this.rows.draftItems
      .filter((i) => i.cycleId === cycleId)
      .map((i) => [itemLock(cycleId, i), 'X'] as const)
      .sort(([a], [b]) => a.localeCompare(b));
    return this.statement(
      'write',
      `draft-items:delete:${cycleId}`,
      { current: true, locks },
      () => {
        let removed = 0;
        for (let i = this.rows.draftItems.length - 1; i >= 0; i--) {
          if (this.rows.draftItems[i]!.cycleId === cycleId) {
            this.rows.draftItems.splice(i, 1);
            removed++;
          }
        }
        if (removed > 0) this.applied(`draft-items:delete:${cycleId}`);
      },
    );
  }

  /** `INSERT ... SELECT`: one statement; a key already in the draft refuses all of it (1062). */
  copyVersionToDraft(cycleId: number, versionId: number): Promise<void> {
    const locks = this.rows.versionItems
      .filter((i) => i.versionId === versionId)
      .map((i) => [itemLock(cycleId, i), 'X'] as const)
      .sort(([a], [b]) => a.localeCompare(b));
    return this.statement(
      'write',
      `draft-items:copy:${cycleId}`,
      { current: true, locks },
      () => {
        const source = this.rows.versionItems.filter(
          (i) => i.versionId === versionId,
        );
        for (const item of source) {
          if (
            this.rows.draftItems.some(
              (r) =>
                r.cycleId === cycleId &&
                r.resultTypeKey === item.resultTypeKey &&
                r.fieldKey === item.fieldKey,
            )
          ) {
            duplicateEntry('field_config_draft_items.PRIMARY');
          }
        }
        for (const item of source) {
          this.rows.draftItems.push({ cycleId, ...asItem(item) });
        }
        if (source.length > 0) this.applied(`draft-items:copy:${cycleId}`);
      },
    );
  }

  /**
   * `INSERT`: the unique entry of (`cycle_id`, `number`) is taken first, so an
   * insert of a number another transaction is inserting waits for it, then finds
   * the number taken (`duplicate`) or free after a rollback.
   */
  insertVersion(values: NewVersionValues): Promise<VersionInsertOutcome> {
    return this.statement(
      'write',
      `version:insert:${values.cycleId}:${values.number}`,
      {
        current: true,
        locks: [[versionNumberLock(values.cycleId, values.number), 'X']],
      },
      (): VersionInsertOutcome => {
        if (
          this.rows.versions.some(
            (v) => v.cycleId === values.cycleId && v.number === values.number,
          )
        ) {
          return { kind: 'duplicate' }; // uq_field_config_versions_cycle_number
        }
        const id = this.db.nextVersionId();
        this.rows.versions.push({
          id,
          cycleId: values.cycleId,
          number: values.number,
          catalogVersion: values.catalogVersion,
          publishedAt: toDatetime(values.publishedAt),
          publishedBy: values.publishedBy,
          requestId: values.requestId,
        });
        this.applied(`version:insert:${values.cycleId}:${values.number}`);
        return { kind: 'created', versionId: id };
      },
    );
  }

  insertVersionItems(
    versionId: number,
    items: readonly ConfigItem[],
  ): Promise<void> {
    if (items.length === 0) return Promise.resolve();
    return this.statement(
      'write',
      `version-items:insert:${versionId}`,
      { current: true },
      () => {
        const keys = new Set<string>();
        for (const item of items) {
          assertFlags('field_config_version_items', item);
          const key = `${item.resultTypeKey}:${item.fieldKey}`;
          if (
            keys.has(key) ||
            this.rows.versionItems.some(
              (r) =>
                r.versionId === versionId &&
                r.resultTypeKey === item.resultTypeKey &&
                r.fieldKey === item.fieldKey,
            )
          ) {
            duplicateEntry('field_config_version_items.PRIMARY');
          }
          keys.add(key);
        }
        for (const item of items) {
          this.rows.versionItems.push({ versionId, ...asItem(item) });
        }
        this.applied(`version-items:insert:${versionId}`);
      },
    );
  }

  /** On the transaction's own rows: it commits or rolls back with the publication (FR-11). */
  insertAuditEvent(values: NewFieldConfigAuditValues): Promise<void> {
    return this.statement(
      'write',
      `audit:${values.versionId}`,
      { current: true },
      () => {
        if (this.rows.audit.some((e) => e.versionId === values.versionId)) {
          duplicateEntry(
            'field_config_audit_events.uq_field_config_audit_events_version',
          );
        }
        this.rows.audit.push({
          id: this.db.nextAuditEventId(),
          cycleId: values.cycleId,
          versionId: values.versionId,
          actorId: values.actorId,
          action: values.action,
          changes: structuredClone(values.changes),
          timelines: structuredClone(values.timelines),
          requestId: values.requestId,
          createdAt: toDatetime(values.createdAt),
        });
        this.applied(`audit:${values.versionId}`);
      },
    );
  }
}

/**
 * `FieldConfigStore` inside one transaction: every statement waits a round trip,
 * takes its row locks first (they may wait for another transaction), then reads
 * what is committed now, over the transaction's own copies of the tables.
 */
class TransactionalFieldConfigStore extends InMemoryFieldConfigStore {
  constructor(
    private readonly tx: InMemoryTransaction,
    db: InMemoryFieldConfigDatabase,
    rows: FieldConfigTables,
  ) {
    super(db, rows);
  }

  protected override execute<R>(
    options: StatementOptions,
    run: () => R | Promise<R>,
  ): Promise<R> {
    return this.tx.statement(
      {
        ...options,
        tables: [
          this.rows.drafts,
          this.rows.draftItems,
          this.rows.versions,
          this.rows.versionItems,
          this.rows.audit,
        ],
      },
      run,
    );
  }
}

/**
 * `FieldConfigUnitOfWork` over `InMemoryFieldConfigDatabase`: commits when `work`
 * resolves, rolls back (writes dropped, locks released) when it throws. READ
 * COMMITTED by default, as the Drizzle unit of work pins it. The cycle row lock
 * is the one an activation and a timeline edit use (`cycles:<id>`), so they
 * serialize here as they do on MySQL; the idempotency store is the users world's
 * tx-bound one: same rows, same row locks, and its mark commits or rolls back
 * with the publication.
 */
export class InMemoryFieldConfigUnitOfWork implements FieldConfigUnitOfWork {
  begun = 0;
  committed = 0;
  rolledBack = 0;

  constructor(
    private readonly db: InMemoryFieldConfigDatabase,
    private readonly isolation: IsolationLevel = 'read committed',
  ) {}

  async run<T>(
    work: (repositories: FieldConfigRepositories) => Promise<T>,
  ): Promise<T> {
    this.begun++;
    const tx = this.db.base.begin(this.isolation);
    try {
      const drafts = tx.table(this.db.drafts, (row) => String(row.cycleId));
      const draftItems = tx.table(
        this.db.draftItems,
        (row) => `${row.cycleId}:${row.resultTypeKey}:${row.fieldKey}`,
      );
      const versions = tx.table(this.db.versions, (row) => String(row.id));
      const versionItems = tx.table(
        this.db.versionItems,
        (row) => `${row.versionId}:${row.resultTypeKey}:${row.fieldKey}`,
      );
      const audit = tx.table(this.db.auditEvents, (row) => String(row.id));
      const result = await work({
        fieldConfig: new TransactionalFieldConfigStore(tx, this.db, {
          drafts: drafts.rows,
          draftItems: draftItems.rows,
          versions: versions.rows,
          versionItems: versionItems.rows,
          audit: audit.rows,
        }),
        idempotency: tx.repositories().idempotency,
      });
      tx.commit();
      this.committed++;
      return result;
    } catch (error) {
      tx.rollback();
      this.rolledBack++;
      throw error;
    }
  }
}
