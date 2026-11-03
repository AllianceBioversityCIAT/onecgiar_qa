import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { discardGuard } from '../../ui/drawer/discard-guard';
import { UnsavedChanges } from './unsaved-changes';

@Component({ selector: 'qa-unsaved-host', template: '' })
class Host {
  readonly open = signal(true);
  readonly text = signal('');
  readonly discard = discardGuard(this.open, () => !!this.text().trim());
}

describe('UnsavedChanges', () => {
  it('is dirty only while a registered check says so, and stops counting once removed', () => {
    const unsaved = TestBed.inject(UnsavedChanges);
    const dirty = signal(false);
    const unregister = unsaved.register(() => dirty());
    expect(unsaved.anyDirty()).toBe(false);
    dirty.set(true);
    expect(unsaved.anyDirty()).toBe(true);
    unregister();
    expect(unsaved.anyDirty()).toBe(false);
  });

  it('tab close / reload is blocked while dirty', () => {
    const unsaved = TestBed.inject(UnsavedChanges);
    unsaved.register(() => true);
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaving a view asks only when something is dirty', () => {
    const unsaved = TestBed.inject(UnsavedChanges);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    expect(unsaved.confirmLeave()).toBe(true);
    expect(confirm).not.toHaveBeenCalled();

    unsaved.register(() => true);
    expect(unsaved.confirmLeave()).toBe(false);
    expect(confirm).toHaveBeenCalledOnce();
    confirm.mockRestore();
  });
});

describe('discardGuard', () => {
  it('closes at once when there is nothing typed', () => {
    const host = TestBed.createComponent(Host).componentInstance;
    host.discard.requestClose();
    expect(host.open()).toBe(false);
  });

  it('with text: the first close asks, Keep writing stays, Discard closes', () => {
    const host = TestBed.createComponent(Host).componentInstance;
    host.text.set('draft');

    expect(host.discard.guard()).toBe(false);
    expect(host.discard.confirming()).toBe(true);
    host.discard.keepWriting();
    expect(host.discard.confirming()).toBe(false);
    expect(host.open()).toBe(true);

    host.discard.requestClose();
    expect(host.open()).toBe(true);
    host.discard.discard();
    expect(host.open()).toBe(false);
  });

  it('an open drawer with text counts as unsaved for the page; closed, it does not', () => {
    const host = TestBed.createComponent(Host).componentInstance;
    const unsaved = TestBed.inject(UnsavedChanges);
    host.text.set('draft');
    expect(unsaved.anyDirty()).toBe(true);
    host.open.set(false);
    expect(unsaved.anyDirty()).toBe(false);
  });
});
