import { TestBed } from '@angular/core/testing';
import { BACKGROUND_KEY, BackgroundStore } from './background-store';

describe('BackgroundStore', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to the dunes', () => {
    expect(TestBed.inject(BackgroundStore).active().id).toBe('dunes');
  });

  it('remembers the chosen background', () => {
    TestBed.inject(BackgroundStore).select('silk');
    TestBed.resetTestingModule();
    const store = TestBed.inject(BackgroundStore);
    store.restore();
    expect(store.active().id).toBe('silk');
  });

  it('ignores unknown ids, stored or selected', () => {
    localStorage.setItem(BACKGROUND_KEY, 'nope');
    const store = TestBed.inject(BackgroundStore);
    store.restore();
    store.select('also-nope');
    expect(store.active().id).toBe('dunes');
  });
});
