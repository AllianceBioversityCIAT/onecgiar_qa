// @akili-spec assessment/ai-suggestions
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ADMIN_CONFIG_CLOCK,
  type AdminConfigClock,
} from '../admin-config/admin-config.clock.js';
import {
  FIELD_CONFIG_EFFECTIVE,
  type FieldConfigEffective,
} from '../admin-config/field-config/field-config.module.js';
import {
  AI_ELIGIBLE_STATUS,
  aiRunIdOf,
  eligibleFields,
  productionFieldOf,
} from '../ai-suggestions/ai-config.js';
import {
  AI_JOBS_PUBLISHER,
  type AiJobMessage,
  type AiJobsPublisher,
} from '../ai-suggestions/ai-jobs.port.js';
import {
  AI_RUN_STORE,
  type AiRunStore,
} from '../ai-suggestions/ai-run.store.js';
import { snapshotKeyOf } from './load-rules.js';
import { AiJobsDisabledError } from '../ai-suggestions/ai-errors.js';
import { LoadNotFoundError } from './loads.errors.js';
import { LOADS_STORE, type LoadsStore } from './loads.store.js';

/** The load fields the jobs need. */
export interface AiEnqueueLoad {
  id: number;
  cycleId: number;
  timelineId: number;
}

/** A membership of a lot, as the runner planned it. */
export interface AiLotMembership {
  resultCode: number;
  resultTypeKey: string;
  snapshotSk: string;
  status: string;
}

/**
 * What one load keeps between its lots (DD-1): the jobs counted per result code
 * (SET, so a lot sent twice counts once) and the eligible fields per result
 * type (one configuration read per type and load; `null` = the configuration
 * could not be read, so the type gets no job).
 */
export class AiTally {
  readonly jobsByCode = new Map<number, number>();
  readonly fieldsByType = new Map<string, readonly string[] | null>();

  get expected(): number {
    let total = 0;
    for (const count of this.jobsByCode.values()) total += count;
    return total;
  }
}

/** FR-3: the answer of a re-enqueue. */
export interface AiRequeueResult {
  expected: number;
  sent: number;
  failed: number;
}

/** FR-3: the counters of a load's AI run. */
export interface AiRunStatus {
  runId: string;
  expected: number;
  produced: number;
  unavailable: number;
  failed: number;
  /** `produced + unavailable == expected` and `failed == 0` (the worker's rule). */
  complete: boolean;
}

export const AI_ENQUEUE = Symbol('AI_ENQUEUE');

/** The runner's view of the hook: never throws (NFR-1). */
export interface AiEnqueuePort {
  enqueueLot(
    load: AiEnqueueLoad,
    memberships: readonly AiLotMembership[],
    tally: AiTally,
  ): Promise<void>;
}

type Outcome = 'ok' | 'failed' | 'disabled';

/**
 * FR-2 and FR-3 of spec assessment/ai-suggestions: one SQS job per (pending
 * membership, eligible field) and the run's `expected` counter. Called by the
 * runner after a lot is recorded (DD-2: never for a snapshot without its
 * membership). Nothing here fails a lot or a load: every error is caught and
 * written as one `event:'ai_enqueue'` line with ids and counts only (NFR-1,
 * NFR-2); what was not sent is sent again with the re-enqueue route.
 */
@Injectable()
export class AiEnqueueService implements AiEnqueuePort {
  private readonly logger = new Logger(AiEnqueueService.name);

  constructor(
    @Inject(AI_JOBS_PUBLISHER) private readonly publisher: AiJobsPublisher,
    @Inject(AI_RUN_STORE) private readonly runs: AiRunStore,
    @Inject(FIELD_CONFIG_EFFECTIVE)
    private readonly fieldConfig: FieldConfigEffective,
    @Inject(LOADS_STORE) private readonly loads: LoadsStore,
    @Inject(ADMIN_CONFIG_CLOCK) private readonly clock: AdminConfigClock,
  ) {}

  async enqueueLot(
    load: AiEnqueueLoad,
    memberships: readonly AiLotMembership[],
    tally: AiTally,
  ): Promise<void> {
    try {
      if (!this.publisher.enabled) {
        this.log(load.id, 'lot', 'disabled', { jobs: 0 });
        return;
      }
      const pending = memberships.filter(
        (m) => m.status === AI_ELIGIBLE_STATUS,
      );
      const result = await this.sendFor(load, pending, tally);
      this.log(
        load.id,
        'lot',
        result.failed > 0 || result.counterFailed || result.skippedTypes > 0
          ? 'failed'
          : 'ok',
        {
          memberships: pending.length,
          jobs: result.jobs,
          sent: result.sent,
          failed: result.failed,
          expected: tally.expected,
          skippedTypes: result.skippedTypes,
          counterFailed: result.counterFailed ? 1 : 0,
        },
      );
    } catch (error) {
      // A defect of this hook still never reaches the lot.
      this.log(load.id, 'lot', 'failed', {
        error: error instanceof Error ? error.name : 'unknown',
      });
    }
  }

  /** FR-3: the run counters of a load (one GetItem). 404 for a load not of the timeline; 409 with no queue. */
  async status(timelineId: number, loadId: number): Promise<AiRunStatus> {
    await this.loadOf(timelineId, loadId);
    const runId = aiRunIdOf(loadId);
    const counters = (await this.runs.get(runId)) ?? {
      expected: 0,
      produced: 0,
      unavailable: 0,
      failed: 0,
    };
    // A run nobody wrote is not complete, even at 0 = 0 + 0.
    const written = counters.expected > 0;
    return {
      runId,
      ...counters,
      complete:
        written &&
        counters.produced + counters.unavailable === counters.expected &&
        counters.failed === 0,
    };
  }

  /** FR-3: the jobs of the load's current pending memberships, sent again. The worker skips what it already stored. */
  async requeue(timelineId: number, loadId: number): Promise<AiRequeueResult> {
    const load = await this.loadOf(timelineId, loadId);
    const memberships = await this.loads.listAiJobMemberships(loadId);
    const tally = new AiTally();
    const result = await this.sendFor(load, memberships, tally);
    const outcome: Outcome =
      result.failed > 0 || result.counterFailed || result.skippedTypes > 0
        ? 'failed'
        : 'ok';
    this.log(load.id, 'requeue', outcome, {
      memberships: memberships.length,
      jobs: result.jobs,
      sent: result.sent,
      failed: result.failed,
      expected: tally.expected,
      skippedTypes: result.skippedTypes,
      counterFailed: result.counterFailed ? 1 : 0,
    });
    return {
      expected: tally.expected,
      sent: result.sent,
      failed: result.failed,
    };
  }

  /** The load of the timeline: 404 first (as every load route), then 409 when no queue is configured (no silent no-op). */
  private async loadOf(
    timelineId: number,
    loadId: number,
  ): Promise<AiEnqueueLoad> {
    const row = await this.loads.findLoad(timelineId, loadId);
    if (row === undefined) throw new LoadNotFoundError(loadId);
    if (!this.publisher.enabled) throw new AiJobsDisabledError();
    return {
      id: row.load.id,
      cycleId: row.load.cycleId,
      timelineId: row.load.timelineId,
    };
  }

  private async sendFor(
    load: AiEnqueueLoad,
    memberships: readonly Omit<AiLotMembership, 'status'>[],
    tally: AiTally,
  ) {
    const runId = aiRunIdOf(load.id);
    const jobs: AiJobMessage[] = [];
    let skippedTypes = 0;
    for (const type of new Set(memberships.map((m) => m.resultTypeKey))) {
      if (!tally.fieldsByType.has(type)) {
        tally.fieldsByType.set(type, await this.fieldsOf(load, type));
      }
      if (tally.fieldsByType.get(type) === null) skippedTypes += 1;
    }
    for (const membership of memberships) {
      const fields = tally.fieldsByType.get(membership.resultTypeKey) ?? null;
      if (fields === null) continue;
      tally.jobsByCode.set(membership.resultCode, fields.length);
      const snapKey = snapshotKeyOf(membership.snapshotSk);
      for (const fieldKey of fields) {
        jobs.push({
          runId,
          resultCode: String(membership.resultCode),
          snapKey,
          fieldKey,
          // Contract 2.0.0: the version is per field (eligible ⇒ in production).
          promptVersion: productionFieldOf(fieldKey)!.promptVersion,
        });
      }
    }
    const sent =
      jobs.length === 0
        ? { sent: 0, failed: 0 }
        : await this.publisher.send(jobs);
    let counterFailed = false;
    if (jobs.length > 0) {
      try {
        await this.runs.setExpected(runId, tally.expected, this.clock());
      } catch {
        counterFailed = true;
      }
    }
    return { jobs: jobs.length, ...sent, skippedTypes, counterFailed };
  }

  /** FR-1 for one result type; `null` when its configuration cannot be read (the type gets no job, the lot goes on). */
  private async fieldsOf(
    load: AiEnqueueLoad,
    resultTypeKey: string,
  ): Promise<readonly string[] | null> {
    try {
      const config = await this.fieldConfig.effectiveFor(
        load.cycleId,
        load.timelineId,
        resultTypeKey,
      );
      return eligibleFields(config.items);
    } catch {
      return null;
    }
  }

  private log(
    loadId: number,
    route: 'lot' | 'requeue',
    outcome: Outcome,
    extra: Record<string, number | string>,
  ): void {
    const line = JSON.stringify({
      event: 'ai_enqueue',
      route,
      loadId,
      outcome,
      ...extra,
    });
    if (outcome === 'failed') this.logger.warn(line);
    else this.logger.log(line);
  }
}
