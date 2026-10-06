import { TestBed } from '@angular/core/testing';
import { SIDEBAR_COLLAPSED_KEY, ShellState } from './shell-state';

describe('ShellState', () => {
  beforeEach(() => localStorage.clear());

  it('starts expanded with the drawer closed', () => {
    const state = TestBed.inject(ShellState);
    expect(state.collapsed()).toBe(false);
    expect(state.drawerOpen()).toBe(false);
  });

  it('remembers the collapsed choice for the next visit', () => {
    TestBed.inject(ShellState).toggleCollapsed();
    expect(localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBe('true');

    TestBed.resetTestingModule();
    expect(TestBed.inject(ShellState).collapsed()).toBe(true);
  });

  it('keeps working when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const state = TestBed.inject(ShellState);
    state.toggleCollapsed();
    expect(state.collapsed()).toBe(true);
    vi.restoreAllMocks();
  });
});
