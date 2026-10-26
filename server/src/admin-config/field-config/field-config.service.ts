// @akili-spec admin-config/field-configuration
import { Inject, Injectable } from '@nestjs/common';
import {
  ADMIN_CONFIG_CLOCK,
  type AdminConfigClock,
} from '../admin-config.clock.js';
import {
  CycleNotFoundError,
  FieldConfigNoVersionError,
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
} from './field-config-versions.js';
import type {
  EffectiveFieldConfig,
  FieldConfigEffective,
} from './field-config.module.js';
import {
  FIELD_CONFIG_STORE,
  type FieldConfigCycle,
  type FieldConfigStore,
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
 * The read flows of the field configuration (design 7.2): the view, the publish
 * preview and the effective query. Reads work in any cycle status (FR-13), write
 * nothing and take no lock; the statement count of each flow is fixed whatever
 * the number of fields, items or timelines (NFR-5).
 */
@Injectable()
export class FieldConfigService implements FieldConfigEffective {
  constructor(
    @Inject(FIELD_CONFIG_STORE) private readonly store: FieldConfigStore,
    @Inject(FIELD_CATALOG_SOURCE) private readonly catalogs: FieldCatalogSource,
    @Inject(ADMIN_CONFIG_CLOCK) private readonly clock: AdminConfigClock,
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
    const named = new Map(timelines.map((t) => [t.id, t]));
    const entry = (id: number): PreviewTimeline => {
      const timeline = named.get(id)!;
      return { id, name: timeline.name, opensOn: timeline.opensOn };
    };

    return {
      revision: draft?.revision ?? 0,
      basedOn: latest?.number ?? null,
      changes,
      timelines: {
        receive: split.receive.map(entry),
        keep: split.keep.map((kept) => ({
          ...entry(kept.timelineId),
          version: kept.version === 'none' ? null : kept.version.number,
        })),
      },
    };
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
