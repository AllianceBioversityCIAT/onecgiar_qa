import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ExportFieldGroup, ExportFieldPicker } from './export-field-picker';

const GROUPS: readonly ExportFieldGroup[] = [
  { id: 'general', name: 'General information', fields: [{ id: 'title', label: 'Title' }, { id: 'level', label: 'Level' }] },
  { id: 'geo', name: 'Geographic location', fields: [{ id: 'focus', label: 'Geographic focus' }] },
];

@Component({
  imports: [ExportFieldPicker],
  template: `<qa-export-field-picker [groups]="groups" [(value)]="value" />`,
})
class Host {
  readonly groups = GROUPS;
  readonly value = signal<readonly string[]>(['title', 'level', 'focus']);
}

function setup() {
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const el: HTMLElement = fixture.nativeElement;
  const box = (name: string) =>
    [...el.querySelectorAll<HTMLButtonElement>('[role="checkbox"]')].find((b) => b.textContent?.includes(name)) as HTMLButtonElement;
  const click = (b: HTMLButtonElement) => {
    b.click();
    fixture.detectChanges();
  };
  return { fixture, el, box, click };
}

describe('ExportFieldPicker', () => {
  it('starts with every field and section checked', () => {
    const { el, box } = setup();
    expect(el.textContent).toContain('3 of 3 selected');
    expect(box('General information').getAttribute('aria-checked')).toBe('true');
    expect(el.textContent).toContain('Clear all');
  });

  it('marks a section as mixed when only part of it is checked, and fills it on the next click', () => {
    const { fixture, box, click } = setup();
    click(box('Title'));
    expect(box('General information').getAttribute('aria-checked')).toBe('mixed');
    expect(fixture.componentInstance.value()).toEqual(['level', 'focus']);
    click(box('General information'));
    // Order follows the review page, not the click order.
    expect(fixture.componentInstance.value()).toEqual(['title', 'level', 'focus']);
  });

  it('clears a full section and clears or selects everything from the header', () => {
    const { fixture, el, box, click } = setup();
    click(box('General information'));
    expect(fixture.componentInstance.value()).toEqual(['focus']);
    const toggleAll = () => [...el.querySelectorAll('button')].find((b) => /all$/.test(b.textContent?.trim() ?? '')) as HTMLButtonElement;
    click(toggleAll());
    expect(fixture.componentInstance.value()).toEqual(['title', 'level', 'focus']);
    click(toggleAll());
    expect(fixture.componentInstance.value()).toEqual([]);
    expect(el.textContent).toContain('0 of 3 selected');
  });
});
