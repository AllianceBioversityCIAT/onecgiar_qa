// @akili-spec assessment/ai-suggestions
import { Logger } from '@nestjs/common';
import type { SQSClient } from '@aws-sdk/client-sqs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiJobMessage } from './ai-jobs.port.js';
import {
  SqsAiJobsPublisher,
  sqsClientConfig,
} from './sqs-ai-jobs.publisher.js';

const job = (n: number): AiJobMessage => ({
  runId: 'load-1',
  resultCode: String(1000 + n),
  snapKey: '2026#000001#00000011#0000000001',
  fieldKey: 'general.gender_tag',
  promptVersion: 'v2-1.0.0',
});

interface Entry {
  Id: string;
  MessageBody: string;
}

/** A fake SQS client: `answer` decides, per call, which entry ids fail (or throws). */
function fakeSqs(answer: (entries: Entry[], call: number) => string[]) {
  const calls: Entry[][] = [];
  const client = {
    send: vi.fn(async (command: { input: { Entries: Entry[] } }) => {
      const entries = command.input.Entries;
      calls.push(entries);
      const failed = answer(entries, calls.length);
      return {
        Successful: entries
          .filter((e) => !failed.includes(e.Id))
          .map((e) => ({ Id: e.Id })),
        Failed: failed.map((Id) => ({ Id, SenderFault: false, Code: 'x' })),
      };
    }),
  };
  return { client: client as unknown as SQSClient, calls };
}

const QUEUE = 'https://sqs.example/queue';

const build = (client: SQSClient | undefined, queueUrl?: string | null) => {
  const waits: number[] = [];
  const publisher = new SqsAiJobsPublisher(
    {
      queueUrl: queueUrl === null ? undefined : (queueUrl ?? QUEUE),
      region: 'us-east-1',
    },
    { credentials: undefined } as never,
    async (ms) => {
      waits.push(ms);
    },
    client,
  );
  return { publisher, waits };
};

afterEach(() => vi.restoreAllMocks());

describe('sqsClientConfig (same principal as DynamoDB)', () => {
  it('uses the DynamoDB keys when the host runs with an IAM user', () => {
    const credentials = { accessKeyId: 'id', secretAccessKey: 'secret' };
    expect(sqsClientConfig({ region: 'us-east-1' }, { credentials })).toEqual({
      region: 'us-east-1',
      credentials,
    });
  });

  it('leaves the default chain (the host role) when there are no keys', () => {
    expect(
      sqsClientConfig({ region: 'us-east-1' }, { credentials: undefined }),
    ).toEqual({ region: 'us-east-1' });
  });
});

describe('SqsAiJobsPublisher (FR-2, NFR-1)', () => {
  it('sends in batches of 10 with the job as the body', async () => {
    const sqs = fakeSqs(() => []);
    const { publisher, waits } = build(sqs.client);
    const jobs = Array.from({ length: 23 }, (_, i) => job(i));
    expect(await publisher.send(jobs)).toEqual({ sent: 23, failed: 0 });
    expect(sqs.calls.map((c) => c.length)).toEqual([10, 10, 3]);
    expect(JSON.parse(sqs.calls[0]![0]!.MessageBody)).toEqual(jobs[0]);
    expect(waits).toEqual([]);
  });

  it('retries only the failed entries, waiting 1 s then 4 s', async () => {
    const sqs = fakeSqs((entries, call) =>
      call === 1 ? ['1', '3'] : call === 2 ? ['3'] : [],
    );
    const { publisher, waits } = build(sqs.client);
    expect(await publisher.send([job(0), job(1), job(2), job(3)])).toEqual({
      sent: 4,
      failed: 0,
    });
    expect(sqs.calls.map((c) => c.map((e) => e.Id))).toEqual([
      ['0', '1', '2', '3'],
      ['1', '3'],
      ['3'],
    ]);
    expect(waits).toEqual([1000, 4000]);
  });

  it('counts what is still unsent after 3 tries and never throws', async () => {
    const client = {
      send: vi.fn(async () => {
        throw new Error('network');
      }),
    } as unknown as SQSClient;
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { publisher, waits } = build(client);
    expect(await publisher.send([job(0), job(1)])).toEqual({
      sent: 0,
      failed: 2,
    });
    expect(waits).toEqual([1000, 4000]);
  });

  it('is disabled without a queue: sends nothing and warns once at startup, without the env value', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const sqs = fakeSqs(() => []);
    const { publisher } = build(sqs.client, null);
    expect(publisher.enabled).toBe(false);
    expect(warn.mock.calls).toEqual([
      ['ai_jobs_disabled: no queue configured'],
    ]);
    expect(await publisher.send([job(0)])).toEqual({ sent: 0, failed: 0 });
    expect(sqs.calls).toEqual([]);
  });

  it('does not warn when a queue is configured', () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    build(fakeSqs(() => []).client);
    expect(warn).not.toHaveBeenCalled();
  });
});
