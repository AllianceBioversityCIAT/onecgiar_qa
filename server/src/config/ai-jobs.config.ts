import { registerAs } from '@nestjs/config';

/**
 * The AI job queue (spec assessment/ai-suggestions, DD-4). Optional: unset, the
 * sync sends no job (local development, an environment without
 * `sqs:SendMessage`). The region is the API's `AWS_REGION`; credentials come
 * from the default chain (the host's IAM role), never from env.
 */
export const aiJobsConfig = registerAs('aiJobs', () => ({
  queueUrl: process.env.AI_JOBS_QUEUE_URL || undefined,
  region: process.env.AWS_REGION!,
}));
