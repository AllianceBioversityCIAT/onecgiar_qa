import { TestBed } from '@angular/core/testing';
import { NotificationsStore } from './notifications-store';

/** Lets the dynamic import behind `load()` resolve and the store settle. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('NotificationsStore', () => {
  let store: NotificationsStore;

  beforeEach(() => {
    store = TestBed.inject(NotificationsStore);
  });

  it('starts loading and becomes ready with the mock notifications', async () => {
    expect(store.state()).toBe('loading');
    await store.load();
    expect(store.state()).toBe('ready');
    expect(store.items().length).toBeGreaterThanOrEqual(9);
  });

  // (i) FR-7: the bell, the panel and the page read this one count.
  it('(i) unreadCount drops by one when an unread notification is marked read', async () => {
    await store.load();
    expect(store.unreadCount()).toBe(4);
    const unread = store.items().find((n) => n.unread)!;
    store.markRead(unread.id);
    expect(store.unreadCount()).toBe(3);
    expect(store.items().find((n) => n.id === unread.id)?.unread).toBe(false);
    // Opening it again, or an id that does not exist, changes nothing.
    store.markRead(unread.id);
    store.markRead('no-such-id');
    expect(store.unreadCount()).toBe(3);
  });

  // (j) FR-7: a no-op, without errors, when nothing is unread.
  it('(j) markAllRead twice is a no-op the second time and does not throw', async () => {
    await store.load();
    expect(store.unreadCount()).toBe(4);
    store.markAllRead();
    expect(store.unreadCount()).toBe(0);
    const afterFirst = store.items();
    expect(() => store.markAllRead()).not.toThrow();
    expect(store.unreadCount()).toBe(0);
    expect(store.items()).toBe(afterFirst);
  });

  // (k) FR-8: a simulated state is not overwritten by the real load resolving afterwards.
  it('(k) simulate("error") before load() resolves stays error', async () => {
    const loading = store.load();
    store.simulate('error');
    await loading;
    await settle();
    expect(store.state()).toBe('error');
  });

  it('simulate("loading") also survives a load() that resolves later', async () => {
    const loading = store.load();
    store.simulate('loading');
    await loading;
    expect(store.items().length).toBeGreaterThanOrEqual(9);
    expect(store.state()).toBe('loading');
  });

  // (l) FR-8: "Try again" leaves the simulated error and reaches ready.
  it('(l) retry() from error reaches ready', async () => {
    store.simulate('error');
    expect(store.state()).toBe('error');
    await store.retry();
    expect(store.state()).toBe('ready');
    expect(store.items().length).toBeGreaterThanOrEqual(9);
  });

  it('retry() after the data loaded keeps the read state', async () => {
    await store.load();
    store.markAllRead();
    store.simulate('error');
    await store.retry();
    expect(store.state()).toBe('ready');
    expect(store.unreadCount()).toBe(0);
  });
});
