// @akili-spec assessment/ai-suggestions
/** One job of `contract/schema/ai-job-message.schema.json`. */
export interface AiJobMessage {
  runId: string;
  resultCode: string;
  snapKey: string;
  fieldKey: string;
  promptVersion: string;
}

export interface AiJobsSendResult {
  sent: number;
  failed: number;
}

export const AI_JOBS_PUBLISHER = Symbol('AI_JOBS_PUBLISHER');

/** Sends jobs to the worker's queue. Never throws: a failure is counted (NFR-1). */
export interface AiJobsPublisher {
  /** False when no queue is configured (DD-4): nothing is sent and no run counter is written. */
  readonly enabled: boolean;
  send(jobs: readonly AiJobMessage[]): Promise<AiJobsSendResult>;
}
