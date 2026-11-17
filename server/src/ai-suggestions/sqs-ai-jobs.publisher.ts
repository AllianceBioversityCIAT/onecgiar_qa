// @akili-spec assessment/ai-suggestions
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import {
  SQSClient,
  SendMessageBatchCommand,
  type SendMessageBatchRequestEntry,
} from '@aws-sdk/client-sqs';
import { aiJobsConfig } from '../config/ai-jobs.config.js';
import type {
  AiJobMessage,
  AiJobsPublisher,
  AiJobsSendResult,
} from './ai-jobs.port.js';

/** SQS takes at most 10 entries per batch. */
export const SQS_BATCH = 10;
/** FR-2: 3 tries, waiting 1 s and then 4 s (the same as the loads, DD-8 of ingestion). */
export const AI_SEND_WAITS_MS = [1_000, 4_000] as const;

export const AI_JOBS_PAUSE = Symbol('AI_JOBS_PAUSE');
export type AiJobsPause = (ms: number) => Promise<void>;
export const defaultAiJobsPause: AiJobsPause = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const AI_SQS_CLIENT = Symbol('AI_SQS_CLIENT');

/**
 * `SendMessageBatch` in groups of 10. A failed entry (or a failed call) is
 * retried twice; what is still unsent is counted as `failed`, never thrown
 * (NFR-1). Logs carry counts only (NFR-2).
 */
@Injectable()
export class SqsAiJobsPublisher implements AiJobsPublisher {
  private readonly logger = new Logger(SqsAiJobsPublisher.name);
  private readonly client: SQSClient | null;
  private readonly queueUrl: string | undefined;
  readonly enabled: boolean;

  constructor(
    @Inject(aiJobsConfig.KEY) config: ConfigType<typeof aiJobsConfig>,
    @Inject(AI_JOBS_PAUSE) private readonly pause: AiJobsPause,
    @Optional() @Inject(AI_SQS_CLIENT) client?: SQSClient,
  ) {
    this.queueUrl = config.queueUrl;
    this.enabled = this.queueUrl !== undefined;
    this.client = this.enabled
      ? (client ?? new SQSClient({ region: config.region }))
      : null; // No silent disable: one fixed warning at startup, never the env value.
    if (!this.enabled) {
      this.logger.warn('ai_jobs_disabled: no queue configured');
    }
  }

  async send(jobs: readonly AiJobMessage[]): Promise<AiJobsSendResult> {
    if (this.client === null || jobs.length === 0) {
      return { sent: 0, failed: 0 };
    }
    let sent = 0;
    let failed = 0;
    for (let at = 0; at < jobs.length; at += SQS_BATCH) {
      const left = await this.sendBatch(jobs.slice(at, at + SQS_BATCH));
      sent += Math.min(SQS_BATCH, jobs.length - at) - left;
      failed += left;
    }
    return { sent, failed };
  }

  /** Returns how many entries of the batch are still unsent after the tries. */
  private async sendBatch(batch: readonly AiJobMessage[]): Promise<number> {
    let pending: SendMessageBatchRequestEntry[] = batch.map((job, index) => ({
      Id: String(index),
      MessageBody: JSON.stringify(job),
    }));
    for (let attempt = 0; attempt <= AI_SEND_WAITS_MS.length; attempt += 1) {
      if (attempt > 0) await this.pause(AI_SEND_WAITS_MS[attempt - 1]);
      try {
        const answer = await this.client!.send(
          new SendMessageBatchCommand({
            QueueUrl: this.queueUrl,
            Entries: pending,
          }),
        );
        const failedIds = new Set((answer.Failed ?? []).map((f) => f.Id));
        pending = pending.filter((entry) => failedIds.has(entry.Id));
      } catch (error) {
        this.logger.warn(
          `ai_jobs_send_error attempt=${attempt + 1} entries=${pending.length} name=${(error as Error).name}`,
        );
      }
      if (pending.length === 0) return 0;
    }
    return pending.length;
  }
}
