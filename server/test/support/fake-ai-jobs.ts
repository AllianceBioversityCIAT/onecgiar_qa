// @akili-spec assessment/ai-suggestions
import type {
  EffectiveFieldConfig,
  FieldConfigEffective,
} from '../../src/admin-config/field-config/field-config.module.js';
import type { ConfigItem } from '../../src/admin-config/field-config/field-config-diff.js';
import type {
  AiJobMessage,
  AiJobsPublisher,
  AiJobsSendResult,
} from '../../src/ai-suggestions/ai-jobs.port.js';
import type {
  AiRunCounters,
  AiRunStore,
} from '../../src/ai-suggestions/ai-run.store.js';
import { assertAiSchema } from './ai-contract.js';

/** Records every job; each body is checked against the worker's schema. */
export class FakeAiJobsPublisher implements AiJobsPublisher {
  enabled = true;
  readonly sent: AiJobMessage[] = [];
  /** Throws on the next calls (a defect the hook must contain). */
  throwing = false;
  /** Reports this many jobs of each call as failed. */
  failPerCall = 0;

  async send(jobs: readonly AiJobMessage[]): Promise<AiJobsSendResult> {
    if (this.throwing) throw new Error('sqs_down');
    for (const job of jobs) assertAiSchema('ai-job-message', job);
    const failed = Math.min(this.failPerCall, jobs.length);
    this.sent.push(...jobs.slice(failed));
    return { sent: jobs.length - failed, failed };
  }
}

/** `expected` per run, SET as the real store does. */
export class FakeAiRunStore implements AiRunStore {
  readonly expected = new Map<string, number>();
  readonly writes: Array<{ runId: string; expected: number }> = [];
  throwing = false;

  async setExpected(runId: string, expected: number): Promise<void> {
    if (this.throwing) throw new Error('dynamo_down');
    this.writes.push({ runId, expected });
    this.expected.set(runId, expected);
  }

  /** What the worker counted, by run (set by a test). */
  readonly worker = new Map<string, Omit<AiRunCounters, 'expected'>>();

  async get(runId: string): Promise<AiRunCounters | null> {
    const expected = this.expected.get(runId);
    const worker = this.worker.get(runId);
    if (expected === undefined && worker === undefined) return null;
    return {
      expected: expected ?? 0,
      produced: worker?.produced ?? 0,
      unavailable: worker?.unavailable ?? 0,
      failed: worker?.failed ?? 0,
    };
  }
}

const AI_FIELDS_BY_TYPE: Record<string, string[]> = {
  innovation_development: [
    'general.gender_tag',
    'general.climate_tag',
    'innovation_dev.readiness_level',
  ],
  policy_change: ['general.gender_tag', 'general.poverty_tag'],
  knowledge_product: ['general.gender_tag'],
};

/**
 * `effectiveFor` over a fixed table: the listed fields are AI input, plus one
 * marked field that is not in production (never a job). A type in `failing`
 * throws, as an unreadable configuration does.
 */
export class FakeFieldConfigEffective implements FieldConfigEffective {
  readonly failing = new Set<string>();
  readonly calls: string[] = [];

  async effectiveFor(
    _cycleId: number,
    timelineId: number,
    resultTypeKey: string,
  ): Promise<EffectiveFieldConfig> {
    this.calls.push(resultTypeKey);
    if (this.failing.has(resultTypeKey)) throw new Error('no_version');
    const item = (fieldKey: string): ConfigItem => ({
      resultTypeKey,
      fieldKey,
      visibility: 'assessed',
      isCore: false,
      isAiInput: true,
    });
    return {
      timelineId,
      resultTypeKey,
      version: 1,
      provisional: false,
      items: [
        ...(AI_FIELDS_BY_TYPE[resultTypeKey] ?? []).map(item),
        item('general.title'),
      ],
    };
  }

  currentFor(
    cycleId: number,
    timelineId: number,
    resultTypeKey: string,
  ): Promise<EffectiveFieldConfig> {
    return this.effectiveFor(cycleId, timelineId, resultTypeKey);
  }

  async versionItems(): Promise<ConfigItem[]> {
    return [];
  }
  async latestVersionItems(): Promise<ConfigItem[] | null> {
    return null;
  }
}
