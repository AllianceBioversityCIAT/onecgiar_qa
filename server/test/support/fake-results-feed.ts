import type {
  FeedDetails,
  FeedDetailsQuery,
  FeedIntake,
  FeedIntakeQuery,
  FeedListQuery,
  FeedPage,
  FeedRelease,
  FeedReleaseQuery,
  ResultsFeed,
} from '../../src/ingestion/results-feed.port.js';

type Ops = {
  list: [FeedListQuery, FeedPage];
  details: [FeedDetailsQuery, FeedDetails];
  intake: [FeedIntakeQuery, FeedIntake];
  release: [FeedReleaseQuery, FeedRelease];
};
type Op = keyof Ops;

export interface FeedCall {
  op: Op;
  query: unknown;
}

/**
 * In-memory `ResultsFeed`: records every call in order and answers from a
 * script per operation (a value, an `Error` to throw, or a function of the
 * query). An operation with nothing scripted fails loudly.
 */
export class FakeResultsFeed implements ResultsFeed {
  readonly calls: FeedCall[] = [];
  private readonly scripts: Record<Op, unknown[]> = {
    list: [],
    details: [],
    intake: [],
    release: [],
  };

  /** Queue answers for `op`; the last one repeats once the queue is down to it. */
  script<O extends Op>(
    op: O,
    ...answers: Array<Ops[O][1] | Error | ((q: Ops[O][0]) => Ops[O][1])>
  ): this {
    this.scripts[op].push(...answers);
    return this;
  }

  callsOf(op: Op): unknown[] {
    return this.calls.filter((c) => c.op === op).map((c) => c.query);
  }

  list(q: FeedListQuery): Promise<FeedPage> {
    return this.answer('list', q);
  }
  details(q: FeedDetailsQuery): Promise<FeedDetails> {
    return this.answer('details', q);
  }
  intake(q: FeedIntakeQuery): Promise<FeedIntake> {
    return this.answer('intake', q);
  }
  release(q: FeedReleaseQuery): Promise<FeedRelease> {
    return this.answer('release', q);
  }

  private answer<O extends Op>(op: O, query: Ops[O][0]): Promise<Ops[O][1]> {
    this.calls.push({ op, query });
    const queue = this.scripts[op];
    if (queue.length === 0)
      return Promise.reject(
        new Error(`FakeResultsFeed: nothing scripted for ${op}`),
      );
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next instanceof Error) return Promise.reject(next);
    if (typeof next === 'function')
      return Promise.resolve((next as (q: Ops[O][0]) => Ops[O][1])(query));
    return Promise.resolve(next as Ops[O][1]);
  }
}
