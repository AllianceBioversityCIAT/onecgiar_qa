// @akili-spec ingestion/step-1-loads
import {
  FeedError,
  type FeedListItem,
  type FeedListQuery,
  type ResultsFeed,
} from './results-feed.port.js';

/** Feed pages are read 200 at a time (design 7.1 step 2, 7.3 step 1). */
export const FEED_PAGE_SIZE = 200;

/**
 * Every page of a listing until `total` results are read (FR-1, FR-3). The
 * preview and the run read the feed through this one function, so they can
 * never disagree on what a scope lists.
 */
export async function listEveryPage(
  feed: Pick<ResultsFeed, 'list'>,
  query: Omit<FeedListQuery, 'page' | 'pageSize'>,
): Promise<FeedListItem[]> {
  const items: FeedListItem[] = [];
  let page = 1;
  let total: number;
  do {
    const read = await feed.list({
      ...query,
      page,
      pageSize: FEED_PAGE_SIZE,
    });
    total = read.total;
    // A page with nothing on it before `total` is reached would never end:
    // the feed is not telling the truth, and a short count would be wrong.
    if (read.items.length === 0 && items.length < total) {
      throw new FeedError('unavailable');
    }
    items.push(...read.items);
    page++;
  } while (items.length < total);
  return items;
}
