import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UnsentItem, UnsentQueue } from '../../core/http/unsent-queue';
import { QaUnsentCenter } from './qa-unsent-center';

const item = (id: string): UnsentItem => ({
  id,
  method: 'PUT',
  url: 'https://api.test/api/v1/users/7',
  body: {},
  idempotencyKey: id,
  label: `Save ${id}`,
  ownerId: 1,
  createdAt: 0,
  attempts: 1,
  state: 'pending',
  error: null,
});

function fakeQueue(stored: UnsentItem[], undecided: string[]) {
  const items = signal(stored);
  const asked = signal(undecided);
  return {
    items,
    asked,
    count: computed(() => items().length),
    awaitingDecision: computed(() => items().filter((i) => asked().includes(i.id))),
    keepAwaiting: vi.fn(() => asked.set([])),
    retryAwaiting: vi.fn(async () => undefined),
    sendPending: vi.fn(async () => undefined),
    retryRejected: vi.fn(),
    dismiss: vi.fn(),
  };
}

describe('QaUnsentCenter', () => {
  function render(queue: ReturnType<typeof fakeQueue>) {
    TestBed.configureTestingModule({ providers: [{ provide: UnsentQueue, useValue: queue }] });
    const fixture = TestBed.createComponent(QaUnsentCenter);
    fixture.detectChanges();
    return fixture;
  }
  const listOpen = (fixture: ReturnType<typeof render>) => (fixture.componentInstance as unknown as { listOpen: () => boolean }).listOpen();

  it('opens the list by itself for writes kept from before this sign-in', () => {
    expect(listOpen(render(fakeQueue([item('a')], [])))).toBe(true);
  });

  it('a write that just failed is asked in the dialog alone: the list does not cover it', async () => {
    const queue = fakeQueue([], []);
    const fixture = render(queue);
    queue.items.set([item('a')]);
    queue.asked.set(['a']);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(listOpen(fixture)).toBe(false);
    expect(document.body.textContent).toContain('Could not send');
  });
});
