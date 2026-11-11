// @akili-spec assessment/step-1-assessment
import { readFileSync } from 'node:fs';
import {
  applicableFields,
  shapeCatalog,
} from '../../src/admin-config/field-config/field-config-catalog.js';
import type { ConfigItem } from '../../src/admin-config/field-config/field-config-diff.js';
import type { RomeMinute } from '../../src/admin-config/rome-date.js';
import type { AssessmentApp } from './assessment-app.js';
import { defaultFakeSteps } from './in-memory-assessment.js';
import { runRealLoad } from './real-load-writer.js';

// The shared world of the cross-cutting assessment suites (T-14): timeline 1
// with step 1 open on 2026-11-13, two policy-change assessors on it, and a
// pinned configuration. The suites call the routes over HTTP only.

const catalog = shapeCatalog(
  JSON.parse(
    readFileSync(
      new URL(
        '../../src/admin-config/field-config/fixtures/reporting-qa-catalog-2026.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ),
);
export const APPLICABLE = applicableFields(catalog, 'policy_change').map(
  (f) => f.key,
);
export const ASSESSED = APPLICABLE.slice(0, 12);
export const VIEW_ONLY = APPLICABLE.slice(12, 17);

/** A clock inside step 1 of `stepOneWindow`. */
export const IN_STEP_1 = new Date('2026-11-13T10:00:00Z');

const minute = (value: string) => value as RomeMinute;

/** Step 1 open 12-20 Nov 2026; steps 2 and 3 as the fake default. */
export const stepOneWindow = () => [
  {
    position: 1,
    name: 'Step 1',
    audience: 'assessors' as const,
    opensAt: minute('2026-11-12T09:00'),
    closesAt: minute('2026-11-20T17:30'),
  },
  ...defaultFakeSteps().slice(1),
];

/**
 * Timeline 1, the two assessors, their nicknames and a configuration with
 * `core` as the core fields (all of them Assessed). Memberships are added by
 * the caller (`addMembership`).
 */
export function seedTimeline(
  a: AssessmentApp,
  core: readonly string[] = [],
): void {
  a.world.timelines.push({
    id: 1,
    name: 'Official',
    kind: 'official',
    steps: stepOneWindow(),
  });
  for (const user of [a.users.policy, a.users.policy2]) {
    a.world.timelineUsers.push({
      timelineId: 1,
      userId: user.id,
      roleCode: 'ASSESSOR',
    });
  }
  a.world.users.push(
    { id: a.users.policy.id, nickname: a.users.policy.nickname ?? null },
    { id: a.users.policy2.id, nickname: a.users.policy2.nickname ?? null },
  );
  const items: ConfigItem[] = APPLICABLE.map((fieldKey) => ({
    resultTypeKey: 'policy_change',
    fieldKey,
    visibility: ASSESSED.includes(fieldKey)
      ? 'assessed'
      : VIEW_ONLY.includes(fieldKey)
        ? 'view_only'
        : 'hidden',
    isCore: core.includes(fieldKey),
    isAiInput: false,
  }));
  a.world.fieldConfigItems['policy_change'] = items;
  a.world.versionItems[1] = { policy_change: items };
}

/** One membership of timeline 1. */
export function addMembership(
  a: AssessmentApp,
  options: { id?: number; resultCode?: number; title?: string } = {},
): void {
  a.world.memberships.push({
    id: options.id ?? 1,
    timelineId: 1,
    resultCode: options.resultCode ?? 5001,
    title: options.title ?? 'A title',
    programId: 1,
    resultTypeKey: 'policy_change',
    resultId: 777 + (options.id ?? 1),
  });
}

export const resultPath = (
  suffix: string,
  code: number | string = 5001,
  timelineId: number | string = 1,
) => `/timelines/${timelineId}/results/${code}/assessment${suffix}`;

/**
 * A membership whose snapshot the real runner wrote (its key and snapshot are
 * copied into the app), so a comment can copy a value from it.
 */
export async function addSnapshotMembership(
  a: AssessmentApp,
  values: Record<string, unknown>,
  options: { id?: number; title?: string } = {},
): Promise<void> {
  const real = await runRealLoad([{ resultId: 1001, values }]);
  const written = real.memberships[0]!;
  for (const snapshot of await real.snapshots.history(written.resultCode)) {
    await a.snapshots.put(snapshot);
  }
  addMembership(a, {
    ...options,
    resultCode: written.resultCode,
  });
  a.world.memberships.at(-1)!.snapshotSk = written.snapshotSk;
}
