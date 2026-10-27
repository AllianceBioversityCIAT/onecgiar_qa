// @akili-spec admin-config/field-configuration
import {
  HttpException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { errorBody } from '../../common/error-codes.js';
import type { IdempotencyStore } from '../../common/idempotency/idempotency.store.js';
import type {
  FieldConfigAuditChanges,
  FieldConfigAuditTimelines,
} from '../../database/drizzle/schema/field-config-audit-events.js';
import { FieldValidationError } from '../../users/users.errors.js';
import {
  ADMIN_CONFIG_CLOCK,
  type AdminConfigClock,
} from '../admin-config.clock.js';
import type {
  AdminConfigAction,
  AdminConfigContext,
} from '../admin-config.context.js';
import { validateDraftEdit, type DraftEditItem } from './field-config-rules.js';
import {
  CycleClosedError,
  CycleNotFoundError,
  FieldConfigNoVersionError,
  FieldConfigNothingToPublishError,
  FieldConfigRevisionStaleError,
  FieldConfigTypeNotInTimelineError,
  TimelineNotFoundError,
} from '../admin-config.errors.js';
import {
  FIELD_CATALOG_SOURCE,
  type FieldCatalogSource,
} from './field-catalog.ports.js';
import {
  applicableFields,
  type FieldCatalog,
  type FieldRequirement,
} from './field-config-catalog.js';
import {
  diffConfig,
  type ConfigItem,
  type FieldChange,
  type OptionSet,
} from './field-config-diff.js';
import {
  receiveAndKeep,
  versionFor,
  type PublishedVersion,
  type ReceiveAndKeep,
} from './field-config-versions.js';
import type {
  EffectiveFieldConfig,
  FieldConfigEffective,
} from './field-config.module.js';
import {
  FIELD_CONFIG_UNIT_OF_WORK,
  type FieldConfigRepositories,
  type FieldConfigUnitOfWork,
} from './field-config.unit-of-work.js';
import {
  FIELD_CONFIG_STORE,
  type FieldConfigCycle,
  type FieldConfigStore,
  type NamedTimelineStart,
} from './field-config.store.js';

export interface FieldView {
  key: string;
  label: string;
  description?: string;
  requirement: FieldRequirement;
  isNew: boolean;
  unclassified: boolean;
  draft: OptionSet;
  published: OptionSet | null;
}

export interface SectionView {
  key: string;
  label: string;
  fields: FieldView[];
}

export interface ResultTypeView {
  key: string;
  label: string;
  level: string;
  sections: SectionView[];
}

export interface NotInCatalogView {
  resultTypeKey: string;
  fieldKey: string;
  draft: OptionSet;
}

/** The configuration view of a cycle (design 6). */
export interface FieldConfigView {
  cycleId: number;
  year: number;
  catalogVersion: string;
  revision: number;
  latestVersion: { number: number; publishedAt: Date } | null;
  resultTypes: ResultTypeView[];
  notInCatalog: NotInCatalogView[];
}

export interface PreviewTimeline {
  id: number;
  name: string;
  opensOn: string | null;
}

/** The publish preview (design 6, FR-7). */
export interface FieldConfigPreview {
  revision: number;
  basedOn: number | null;
  changes: FieldChange[];
  timelines: {
    receive: PreviewTimeline[];
    /** `version` is the number the timeline keeps, `null` when it resolves to none. */
    keep: Array<PreviewTimeline & { version: number | null }>;
  };
}

/** The answer of a publication (design 6): the new version and the receive / keep lists it was computed with. */
export interface PublishResult {
  version: { number: number; publishedAt: Date; catalogVersion: string };
  timelines: FieldConfigPreview['timelines'];
}

const HIDDEN: OptionSet = {
  visibility: 'hidden',
  isCore: false,
  isAiInput: false,
};

const optionSetOf = (row: ConfigItem): OptionSet => ({
  visibility: row.visibility,
  isCore: row.isCore,
  isAiInput: row.isAiInput,
});

const keyOf = (type: string, field: string) => JSON.stringify([type, field]);

/**
 * A copy cut to the whole second. `published_at`, `updated_at` and the audit
 * time are `datetime` columns without fractions, so MySQL would round a
 * millisecond value on its own: 23:59:59.6 Rome would store as the opening day
 * of a timeline that opens the next day and break DD-5. Cut here, the instant
 * the lists judge, the instant stored and the instant answered are one value.
 */
function wholeSecond(date: Date): Date {
  const cut = new Date(date);
  cut.setUTCMilliseconds(0);
  return cut;
}

/**
 * True when `error` (or a `cause` up to two levels down, where the query builder
 * wraps the driver error) is MySQL's 1213 `ER_LOCK_DEADLOCK` or 1205
 * `ER_LOCK_WAIT_TIMEOUT`: the transaction lost a lock conflict. Nothing was
 * committed.
 */
function isLockContention(error: unknown): boolean {
  for (
    let current: unknown = error, depth = 0;
    current instanceof Error && depth < 3;
    current = (current as Error & { cause?: unknown }).cause, depth++
  ) {
    const { code, errno } = current as Error & {
      code?: unknown;
      errno?: unknown;
    };
    if (code === 'ER_LOCK_DEADLOCK' || errno === 1213) return true;
    if (code === 'ER_LOCK_WAIT_TIMEOUT' || errno === 1205) return true;
  }
  return false;
}

/**
 * A write transaction that lost a lock conflict (deadlock or lock wait
 * timeout): 503 `SERVICE_UNAVAILABLE`, retryable, nothing committed, the same
 * answer as `CycleActivationBusyError`. It is rethrown, never retried here
 * (KZ-admin-config--cycle-timelines-1). The driver error is the `cause`, never
 * part of the answer.
 */
export class FieldConfigBusyError extends ServiceUnavailableException {
  constructor(cause?: unknown) {
    super(errorBody('SERVICE_UNAVAILABLE'), { cause });
  }
}

/** The receive and keep lists as the preview and the publish answer show them. */
function describeLists(
  timelines: readonly NamedTimelineStart[],
  split: ReceiveAndKeep,
): FieldConfigPreview['timelines'] {
  const named = new Map(timelines.map((t) => [t.id, t]));
  const entry = (id: number): PreviewTimeline => {
    const timeline = named.get(id)!;
    return { id, name: timeline.name, opensOn: timeline.opensAt };
  };
  return {
    receive: split.receive.map(entry),
    keep: split.keep.map((kept) => ({
      ...entry(kept.timelineId),
      version: kept.version === 'none' ? null : kept.version.number,
    })),
  };
}

/**
 * The flows of the field configuration (design 7.2). The reads (the view, the
 * publish preview and the effective query) work in any cycle status (FR-13),
 * write nothing and take no lock. The writes (draft edit, discard, publish) run
 * the answer order of design 6, refuse a closed cycle (FR-13) and log one
 * decision line each (NFR-7). The statement count of each flow is fixed whatever
 * the number of fields, items or timelines (NFR-5).
 */
@Injectable()
export class FieldConfigService implements FieldConfigEffective {
  private readonly logger = new Logger(FieldConfigService.name);

  constructor(
    @Inject(FIELD_CONFIG_STORE) private readonly store: FieldConfigStore,
    @Inject(FIELD_CATALOG_SOURCE) private readonly catalogs: FieldCatalogSource,
    @Inject(ADMIN_CONFIG_CLOCK) private readonly clock: AdminConfigClock,
    @Inject(FIELD_CONFIG_UNIT_OF_WORK)
    private readonly unitOfWork: FieldConfigUnitOfWork,
  ) {}

  /** The cycle, or 404; then the catalog of ITS year (DD-4): a missing catalog is 409, Reporting down is 503, never an empty list (FR-2). */
  private async cycleAndCatalog(
    cycleId: number,
  ): Promise<{ cycle: FieldConfigCycle; catalog: FieldCatalog }> {
    const cycle = await this.store.findCycle(cycleId);
    if (cycle === undefined) throw new CycleNotFoundError(cycleId);
    return { cycle, catalog: await this.catalogs.forYear(cycle.year) };
  }

  async view(cycleId: number): Promise<FieldConfigView> {
    const { cycle, catalog } = await this.cycleAndCatalog(cycleId);
    return this.viewOf(cycle, catalog);
  }

  /** The view over a cycle and a catalog already read: a write answers with it without a second catalog read (NFR-5). */
  private async viewOf(
    cycle: FieldConfigCycle,
    catalog: FieldCatalog,
  ): Promise<FieldConfigView> {
    const cycleId = cycle.id;
    const [draft, draftItems, latest] = await Promise.all([
      this.store.findDraft(cycleId),
      this.store.listDraftItems(cycleId),
      this.store.latestVersion(cycleId),
    ]);
    const published =
      latest === undefined ? [] : await this.store.listVersionItems(latest.id);

    const draftBy = new Map(
      draftItems.map((row) => [keyOf(row.resultTypeKey, row.fieldKey), row]),
    );
    const publishedBy = new Map(
      published.map((row) => [keyOf(row.resultTypeKey, row.fieldKey), row]),
    );
    const shown = new Set<string>();

    const resultTypes = catalog.resultTypes.map((type): ResultTypeView => {
      const fields = applicableFields(catalog, type.key);
      const sections = catalog.sections.flatMap((section): SectionView[] => {
        const own = fields.filter((field) => field.section === section.key);
        if (own.length === 0) return [];
        return [
          {
            key: section.key,
            label: section.label,
            fields: own.map((field): FieldView => {
              const key = keyOf(type.key, field.key);
              shown.add(key);
              const stored = draftBy.get(key);
              const version = publishedBy.get(key);
              return {
                key: field.key,
                label: field.label,
                ...(field.description === undefined
                  ? {}
                  : { description: field.description }),
                requirement: field.requirement,
                isNew: field.isNew,
                unclassified: stored === undefined,
                draft: stored === undefined ? HIDDEN : optionSetOf(stored),
                published: version === undefined ? null : optionSetOf(version),
              };
            }),
          },
        ];
      });
      return { key: type.key, label: type.label, level: type.level, sections };
    });

    return {
      cycleId: cycle.id,
      year: cycle.year,
      catalogVersion: catalog.catalogVersion,
      revision: draft?.revision ?? 0,
      latestVersion:
        latest === undefined
          ? null
          : { number: latest.number, publishedAt: latest.publishedAt },
      resultTypes,
      // A draft option set the catalog no longer lists for its type (S-7, DD-12).
      notInCatalog: draftItems
        .filter((row) => !shown.has(keyOf(row.resultTypeKey, row.fieldKey)))
        .map((row) => ({
          resultTypeKey: row.resultTypeKey,
          fieldKey: row.fieldKey,
          draft: optionSetOf(row),
        })),
    };
  }

  async preview(cycleId: number): Promise<FieldConfigPreview> {
    const { catalog } = await this.cycleAndCatalog(cycleId);
    const now = this.clock();
    const [draft, draftItems, versions, timelines] = await Promise.all([
      this.store.findDraft(cycleId),
      this.store.listDraftItems(cycleId),
      this.store.listVersions(cycleId),
      this.store.listTimelineStarts(cycleId),
    ]);
    const latest = versions.reduce<(typeof versions)[number] | undefined>(
      (best, row) =>
        best === undefined || row.number > best.number ? row : best,
      undefined,
    );
    const latestItems =
      latest === undefined
        ? null
        : await this.store.listVersionItems(latest.id);

    const changes = diffConfig(draftItems, latestItems, catalog);
    const changedTypes = [...new Set(changes.map((c) => c.resultTypeKey))];
    const published: PublishedVersion[] = versions;
    const split = receiveAndKeep(timelines, published, changedTypes, now);

    return {
      revision: draft?.revision ?? 0,
      basedOn: latest?.number ?? null,
      changes,
      timelines: describeLists(timelines, split),
    };
  }

  // @akili-spec admin-config/field-configuration
  /**
   * FR-4, FR-5, S-10, S-14 (design 6, 7.2): edit the draft. Answer order, first
   * that applies wins: 404, closed cycle 409, the catalog 409 / 503, every rule
   * problem in one 400, the same-values answer. All of it reads without a lock
   * and opens no transaction, so a refusal writes nothing. Each item describes
   * the WHOLE option set: a flag left out is stored `false`, also on an
   * `assessed` item (S-14), and "same values" compares the stored items with the
   * items so normalised. The one write is one transaction: the cycle `FOR
   * SHARE` (closed re-checked), the draft row created and locked, one upsert
   * (the later write of a field wins), and the revision bump with `updated_at/by`.
   * The bump has no expected revision: an edit always wins, so a 0-row bump is a
   * bug, never a 409 stale.
   */
  updateDraft(
    ctx: AdminConfigContext,
    cycleId: number,
    items: readonly DraftEditItem[],
  ): Promise<FieldConfigView> {
    return this.logged('field_config_update', ctx, cycleId, async () => {
      const now = wholeSecond(this.clock());
      const { cycle, catalog } = await this.writableCycle(cycleId);
      const issues = validateDraftEdit(catalog, items);
      if (issues.length > 0) throw new FieldValidationError(issues);

      const wanted = items.map((row): ConfigItem => ({
        resultTypeKey: row.resultTypeKey,
        fieldKey: row.fieldKey,
        visibility: row.visibility,
        isCore: row.isCore ?? false,
        isAiInput: row.isAiInput ?? false,
      }));
      const stored = new Map(
        (await this.store.listDraftItems(cycleId)).map((row) => [
          keyOf(row.resultTypeKey, row.fieldKey),
          row,
        ]),
      );
      // A field with no stored row is a change even when it says `hidden`: it
      // stops being unclassified in the view.
      const unchanged = wanted.every((row) => {
        const current = stored.get(keyOf(row.resultTypeKey, row.fieldKey));
        return (
          current !== undefined &&
          current.visibility === row.visibility &&
          current.isCore === row.isCore &&
          current.isAiInput === row.isAiInput
        );
      });
      if (unchanged) return this.viewOf(cycle, catalog);

      await this.transaction(async ({ fieldConfig }) => {
        await this.lockOpenCycle(fieldConfig, cycleId);
        await fieldConfig.ensureDraft(cycleId);
        await fieldConfig.lockDraft(cycleId);
        await fieldConfig.upsertDraftItems(cycleId, wanted);
        await this.bumpAsDraftWrite(fieldConfig, cycleId, now, ctx);
      });
      return this.viewOf(cycle, catalog);
    });
  }

  // @akili-spec admin-config/field-configuration
  /**
   * FR-6 (design 7.2): reset the draft to the latest version, or to empty with
   * none. The catalog is read before the transaction because the answer is the
   * view: a missing catalog refuses before anything is written. One
   * transaction: the cycle `FOR SHARE`, the draft row created and locked, the
   * latest version read under that lock (a publish holds it too), the draft
   * items deleted BEFORE the version's are copied (the copy is one `INSERT ...
   * SELECT` that the primary key would refuse over old rows), then the revision
   * moves with `updated_at/by`: a discard is a draft write (design 7.3).
   */
  discardDraft(
    ctx: AdminConfigContext,
    cycleId: number,
  ): Promise<FieldConfigView> {
    return this.logged('field_config_discard', ctx, cycleId, async () => {
      const now = wholeSecond(this.clock());
      const { cycle, catalog } = await this.writableCycle(cycleId);
      await this.transaction(async ({ fieldConfig }) => {
        await this.lockOpenCycle(fieldConfig, cycleId);
        await fieldConfig.ensureDraft(cycleId);
        await fieldConfig.lockDraft(cycleId);
        const latest = await fieldConfig.latestVersion(cycleId);
        await fieldConfig.deleteDraftItems(cycleId);
        if (latest !== undefined) {
          await fieldConfig.copyVersionToDraft(cycleId, latest.id);
        }
        await this.bumpAsDraftWrite(fieldConfig, cycleId, now, ctx);
      });
      return this.viewOf(cycle, catalog);
    });
  }

  // @akili-spec admin-config/field-configuration
  /**
   * FR-8, FR-11, FR-12, NFR-3 (design 6, 7.2, DD-6, DD-7): publish the draft the
   * ADMIN reviewed as a new immutable version. Answer order: 404, closed 409,
   * the catalog, then the revision against the UNLOCKED draft (stale 409, a
   * cycle never edited reads as revision 0), then an empty diff (nothing to
   * publish 409). Stale is judged first, so an old revision never reads as
   * "nothing to publish". The diff, the version's rows and the receive / keep
   * lists are computed from data read BEFORE the transaction (DD-7), with the
   * clock read once and cut to the whole second: that one instant judges the
   * lists, is the version's `published_at` and the audit time (DD-5).
   *
   * The transaction (lock order cycle `FOR SHARE`, draft `FOR UPDATE`, DD-6):
   * the conditional `UPDATE ... WHERE revision = ?` decides a race by its
   * affected rows (0 = 409 stale), the number is read under the lock, then the
   * version, its items (every applicable field, unclassified as hidden: DD-2),
   * ONE audit row and the key mark. A `duplicate` on the version insert is the
   * same 409 stale. No retry (KZ-admin-config--cycle-timelines-1). The bump
   * passes no `change`: a publish leaves `updated_*` as the last draft write set
   * them.
   */
  publish(
    ctx: AdminConfigContext,
    cycleId: number,
    revision: number,
  ): Promise<PublishResult> {
    return this.logged('field_config_publish', ctx, cycleId, async () => {
      const now = wholeSecond(this.clock());
      const { catalog } = await this.writableCycle(cycleId);

      // The draft row BEFORE its items: an edit that lands between the two reads
      // moves the revision, so the conditional UPDATE refuses this publication.
      const draft = await this.store.findDraft(cycleId);
      if ((draft?.revision ?? 0) !== revision) {
        throw new FieldConfigRevisionStaleError();
      }
      const [draftItems, versions, timelines] = await Promise.all([
        this.store.listDraftItems(cycleId),
        this.store.listVersions(cycleId),
        this.store.listTimelineStarts(cycleId),
      ]);
      const latest = versions.reduce<(typeof versions)[number] | undefined>(
        (best, row) =>
          best === undefined || row.number > best.number ? row : best,
        undefined,
      );
      const latestItems =
        latest === undefined
          ? null
          : await this.store.listVersionItems(latest.id);

      const changes = diffConfig(draftItems, latestItems, catalog);
      if (changes.length === 0) throw new FieldConfigNothingToPublishError();

      const changedTypes = [...new Set(changes.map((c) => c.resultTypeKey))];
      const split = receiveAndKeep(timelines, versions, changedTypes, now);

      // One row per APPLICABLE field of every type, in catalog order; a field
      // with no draft row is hidden. A draft row whose field left the catalog
      // is not applicable, so it drops out (S-7, DD-12).
      const draftBy = new Map(
        draftItems.map((row) => [keyOf(row.resultTypeKey, row.fieldKey), row]),
      );
      const rows = catalog.resultTypes.flatMap((type) =>
        applicableFields(catalog, type.key).map((field): ConfigItem => {
          const stored = draftBy.get(keyOf(type.key, field.key));
          return {
            resultTypeKey: type.key,
            fieldKey: field.key,
            ...(stored === undefined ? HIDDEN : optionSetOf(stored)),
          };
        }),
      );
      const auditChanges: FieldConfigAuditChanges = Object.fromEntries(
        changes.map((c) => [
          `${c.resultTypeKey}.${c.fieldKey}`,
          { before: c.before, after: c.after },
        ]),
      );
      const auditTimelines: FieldConfigAuditTimelines = {
        receive: split.receive,
        keep: split.keep.map((kept) => ({
          id: kept.timelineId,
          version: kept.version === 'none' ? null : kept.version.number,
        })),
      };

      const number = await this.transaction(
        async ({ fieldConfig, idempotency }) => {
          await this.lockOpenCycle(fieldConfig, cycleId);
          await fieldConfig.lockDraft(cycleId);
          // The database decides the race: the revision is in the WHERE.
          const bumped = await fieldConfig.bumpRevision(
            cycleId,
            undefined,
            revision,
          );
          if (bumped.kind === 'stale')
            throw new FieldConfigRevisionStaleError();

          const current = await fieldConfig.latestVersion(cycleId);
          const created = await fieldConfig.insertVersion({
            cycleId,
            number: (current?.number ?? 0) + 1,
            catalogVersion: catalog.catalogVersion,
            publishedAt: now,
            publishedBy: ctx.actorId,
            requestId: ctx.requestId,
          });
          // Another publication took the number: the same answer as a stale revision.
          if (created.kind === 'duplicate') {
            throw new FieldConfigRevisionStaleError();
          }
          await fieldConfig.insertVersionItems(created.versionId, rows);
          await fieldConfig.insertAuditEvent({
            cycleId,
            versionId: created.versionId,
            actorId: ctx.actorId,
            action: 'publish',
            changes: auditChanges,
            timelines: auditTimelines,
            requestId: ctx.requestId,
            createdAt: now,
          });
          await this.markExecuted(idempotency, ctx, created.versionId);
          return (current?.number ?? 0) + 1;
        },
      );

      return {
        version: {
          number,
          publishedAt: now,
          catalogVersion: catalog.catalogVersion,
        },
        timelines: describeLists(timelines, split),
      };
    });
  }

  /**
   * The answer of a publication as recorded (DD-9), for the idempotency replay
   * reader: the version and the receive / keep lists AS STORED in its audit row,
   * never recomputed. Names and `opensOn` are joined from the timelines now (the
   * audit row keeps ids and version numbers only). One read, no lock, no write.
   * The version and its audit row commit together with the key mark, so a
   * missing one is a bug: it throws, and the interceptor answers 503.
   */
  async replayPublish(versionId: number): Promise<PublishResult> {
    const publication = await this.store.findPublication(versionId);
    if (publication === undefined) {
      throw new Error(`Publication ${versionId} has no version or audit row`);
    }
    const { version, timelines: stored } = publication;
    const named = new Map(
      (await this.store.listTimelineStarts(version.cycleId)).map((t) => [
        t.id,
        t,
      ]),
    );
    const entry = (id: number): PreviewTimeline => ({
      id,
      name: named.get(id)?.name ?? '',
      opensOn: named.get(id)?.opensAt ?? null,
    });
    return {
      version: {
        number: version.number,
        publishedAt: version.publishedAt,
        catalogVersion: version.catalogVersion,
      },
      timelines: {
        receive: stored.receive.map(entry),
        keep: stored.keep.map((kept) => ({
          ...entry(kept.id),
          version: kept.version,
        })),
      },
    };
  }

  /** The cycle, or 404; a closed cycle refuses every write (FR-13); then the catalog of ITS year (design 6, steps 1 to 3). Nothing is locked. */
  private async writableCycle(
    cycleId: number,
  ): Promise<{ cycle: FieldConfigCycle; catalog: FieldCatalog }> {
    const cycle = await this.store.findCycle(cycleId);
    if (cycle === undefined) throw new CycleNotFoundError(cycleId);
    if (cycle.status === 'closed') throw new CycleClosedError();
    return { cycle, catalog: await this.catalogs.forYear(cycle.year) };
  }

  /** First statement of every write transaction (design 7.3, P-11): the cycle row held shared, closed re-checked under it. */
  private async lockOpenCycle(
    fieldConfig: FieldConfigStore,
    cycleId: number,
  ): Promise<void> {
    const status = await fieldConfig.lockCycleShared(cycleId);
    if (status === undefined) throw new CycleNotFoundError(cycleId);
    if (status === 'closed') throw new CycleClosedError();
  }

  /** The draft edit and the discard always win: no expected revision, so 0 rows means the locked row vanished, never a stale 409. */
  private async bumpAsDraftWrite(
    fieldConfig: FieldConfigStore,
    cycleId: number,
    now: Date,
    ctx: AdminConfigContext,
  ): Promise<void> {
    const outcome = await fieldConfig.bumpRevision(cycleId, {
      updatedAt: now,
      updatedBy: ctx.actorId,
    });
    if (outcome.kind === 'stale') {
      throw new Error(
        'The locked draft row was not found for its revision bump',
      );
    }
  }

  /** One write transaction. A lost lock conflict (1213, 1205) is the retryable 503, rethrown and never retried here. */
  private async transaction<T>(
    work: (repositories: FieldConfigRepositories) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.unitOfWork.run(work);
    } catch (error) {
      if (isLockContention(error)) throw new FieldConfigBusyError(error);
      throw error;
    }
  }

  /**
   * The exactly-once fence (P-1): `in_progress` -> `executed` for a keyed
   * request, in the business transaction, so the mark commits with the version.
   * The stored target is the version id (design 7.6). No handle (no
   * `Idempotency-Key`) = nothing to mark.
   */
  private async markExecuted(
    idempotency: Pick<IdempotencyStore, 'markExecuted'>,
    ctx: AdminConfigContext,
    versionId: number,
  ): Promise<void> {
    if (ctx.idempotency === undefined) return;
    await idempotency.markExecuted(ctx.idempotency.reservation, versionId);
  }

  /**
   * One decision line per write, success or refusal (design 7.5, NFR-7): event,
   * action, target id (the cycle), actor id, outcome, a reason code on a refusal
   * or an error, request id. Never an item, a revision or any other part of the
   * body.
   */
  private async logged<T>(
    action: AdminConfigAction,
    ctx: AdminConfigContext,
    cycleId: number,
    work: () => Promise<T>,
  ): Promise<T> {
    try {
      const result = await work();
      this.logger.log(this.line(action, ctx, cycleId, 'ok'));
      return result;
    } catch (error) {
      const status = error instanceof HttpException ? error.getStatus() : 500;
      const body =
        error instanceof HttpException
          ? (error.getResponse() as { code?: unknown })
          : {};
      const reason =
        typeof body.code === 'string' && /^[A-Z_]{1,64}$/.test(body.code)
          ? body.code
          : status < 500
            ? `http_${status}`
            : 'internal_error';
      const refused = status < 500;
      const line = this.line(
        action,
        ctx,
        cycleId,
        refused ? 'refused' : 'error',
        reason,
      );
      if (refused) this.logger.warn(line);
      else this.logger.error(line);
      throw error;
    }
  }

  private line(
    action: AdminConfigAction,
    ctx: AdminConfigContext,
    targetId: number,
    outcome: 'ok' | 'refused' | 'error',
    reason?: string,
  ): string {
    return JSON.stringify({
      event: 'admin_config',
      action,
      targetId,
      actorId: ctx.actorId,
      outcome,
      ...(reason === undefined ? {} : { reason }),
      requestId: ctx.requestId,
      // `none` | `taken_over`: the interceptor writes no line of its own for a
      // first or taken-over execution.
      idempotency: ctx.idempotency?.outcome ?? 'none',
    });
  }

  async effectiveFor(
    cycleId: number,
    timelineId: number,
    resultTypeKey: string,
  ): Promise<EffectiveFieldConfig> {
    const timelines = await this.store.listTimelineStarts(cycleId);
    const timeline = timelines.find((t) => t.id === timelineId);
    if (timeline === undefined) throw new TimelineNotFoundError(timelineId);
    if (
      !timeline.allResultTypes &&
      !timeline.resultTypeKeys.includes(resultTypeKey)
    ) {
      throw new FieldConfigTypeNotInTimelineError(timelineId, resultTypeKey);
    }
    const versions = await this.store.listVersions(cycleId);
    const resolved = versionFor(timeline, versions, this.clock());
    // 'none': no version counts, or none exists at all (T-4 pointer): one error.
    if (resolved === 'none') throw new FieldConfigNoVersionError(timelineId);
    const version = versions.find((row) => row.number === resolved.number);
    if (version === undefined) throw new FieldConfigNoVersionError(timelineId);
    return {
      timelineId,
      resultTypeKey,
      version: resolved.number,
      provisional: resolved.provisional,
      items: await this.store.listVersionItems(version.id, resultTypeKey),
    };
  }
}

export type { ConfigItem, FieldCatalog };
