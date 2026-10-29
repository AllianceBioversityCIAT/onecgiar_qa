/**
 * Field configuration per cycle of the admin config API (`/api/v1/cycles/:id/field-config`, ADMIN only).
 * Copied by hand from the server contract
 * (`docs/specs/archive/2026-10-27-admin-config--field-configuration/front-contract.md`, Juanda 27-oct-2026): keep in sync.
 */

export type FieldVisibility = 'hidden' | 'view_only' | 'assessed';

/** `conditional`: not required, but Reporting has a `required_when` rule (the rule itself is not sent). */
export type FieldRequirement = 'required' | 'conditional' | 'optional';

/** Whole option set of one field. Core and AI input only go with `assessed` (400 `NOT_ASSESSED` otherwise). */
export interface FieldOptions {
  readonly visibility: FieldVisibility;
  readonly isCore: boolean;
  readonly isAiInput: boolean;
}

export interface FieldConfigField {
  readonly key: string;
  readonly label: string;
  readonly description?: string;
  readonly requirement: FieldRequirement;
  /** Always false today: Reporting sends no flag. Do not build UI on it yet. */
  readonly isNew: boolean;
  /** No draft row yet (reads hidden, both flags off). Only before the field's first classification. */
  readonly unclassified: boolean;
  readonly draft: FieldOptions;
  /** Latest published version; null before any publication. */
  readonly published: FieldOptions | null;
}

export interface FieldConfigSection {
  readonly key: string;
  readonly label: string;
  readonly fields: readonly FieldConfigField[];
}

export interface FieldConfigResultType {
  readonly key: string;
  readonly label: string;
  readonly level: string;
  readonly sections: readonly FieldConfigSection[];
}

/** A draft row whose field the catalog no longer lists for that type: read only. */
export interface FieldNotInCatalog {
  readonly resultTypeKey: string;
  readonly fieldKey: string;
  readonly draft: FieldOptions;
}

export interface FieldConfigView {
  readonly cycleId: number;
  readonly year: number;
  readonly catalogVersion: string;
  /** Draft revision (0 for a cycle never edited). Publish sends the preview's. */
  readonly revision: number;
  readonly latestVersion: { readonly number: number; readonly publishedAt: string } | null;
  readonly resultTypes: readonly FieldConfigResultType[];
  readonly notInCatalog: readonly FieldNotInCatalog[];
}

export interface FieldConfigEdit extends FieldOptions {
  readonly resultTypeKey: string;
  readonly fieldKey: string;
}

export interface FieldConfigChange {
  readonly resultTypeKey: string;
  readonly fieldKey: string;
  /** null when the latest version has no row (counts as hidden). */
  readonly before: FieldOptions | null;
  readonly after: FieldOptions;
}

/** A timeline that has not started: it will use the new version. `opensOn` = step 1's day (Rome), null without steps. */
export interface ReceivingTimeline {
  readonly id: number;
  readonly name: string;
  readonly opensOn: string | null;
}

/** A started timeline: keeps the version it started with (`null` = it started with no configuration). */
export interface KeepingTimeline extends ReceivingTimeline {
  readonly version: number | null;
}

export interface PublishTimelines {
  readonly receive: readonly ReceivingTimeline[];
  readonly keep: readonly KeepingTimeline[];
}

export interface FieldConfigPreview {
  readonly revision: number;
  readonly basedOn: number | null;
  readonly changes: readonly FieldConfigChange[];
  readonly timelines: PublishTimelines;
}

export interface FieldConfigPublishResult {
  readonly version: { readonly number: number; readonly publishedAt: string; readonly catalogVersion: string };
  readonly timelines: PublishTimelines;
}

export const FIELD_CONFIG_ERROR = {
  CATALOG_MISSING: 'FIELD_CONFIG_CATALOG_MISSING',
  REVISION_STALE: 'FIELD_CONFIG_REVISION_STALE',
  NOTHING_TO_PUBLISH: 'FIELD_CONFIG_NOTHING_TO_PUBLISH',
  CYCLE_CLOSED: 'CYCLES_CLOSED',
} as const;
