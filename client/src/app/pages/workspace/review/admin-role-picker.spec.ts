import { TestBed } from '@angular/core/testing';
import { ActingRole } from '../../../core/api/acting-role';
import { AdminRolePicker } from './admin-role-picker';

describe('AdminRolePicker (admin/acts-as-reviewer)', () => {
  const render = (roles: readonly ActingRole[], role: ActingRole | null) => {
    const fixture = TestBed.createComponent(AdminRolePicker);
    fixture.componentRef.setInput('roles', roles);
    fixture.componentRef.setInput('role', role);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const picked: (ActingRole | null)[] = [];
    fixture.componentInstance.roleChange.subscribe((r) => picked.push(r));
    return { fixture, el, picked };
  };

  it('offers Read only and only the roles the result admits', () => {
    const { el } = render(['LEAD_ASSESSOR'], null);
    const labels = [...el.querySelectorAll('label')].map((l) => l.textContent?.trim());
    expect(labels).toEqual(['Read only', 'Lead Assessor']);
    expect(el.querySelector('[data-testid="admin-acting-note"]')).toBeNull();
  });

  it('offers TPB and PPU when the result admits them (P2-3916, P2-3917)', () => {
    const { el } = render(['TPB', 'PPU'], 'PPU');
    const labels = [...el.querySelectorAll('label')].map((l) => l.textContent?.trim());
    expect(labels).toEqual(['Read only', 'TPB', 'PPU']);
    expect(el.querySelector('[data-testid="admin-acting-note"]')?.textContent).toContain('acting as PPU');
  });

  it('says which role the Admin acts as', () => {
    const { el } = render(['ASSESSOR'], 'ASSESSOR');
    expect(el.querySelector('[data-testid="admin-acting-note"]')?.textContent).toContain('acting as Assessor');
  });

  it('emits the picked role, and null for Read only', () => {
    const { el, picked, fixture } = render(['ASSESSOR'], null);
    const radios = el.querySelectorAll<HTMLInputElement>('input[type="radio"]');
    radios[1].click();
    fixture.detectChanges();
    expect(picked).toEqual(['ASSESSOR']);
    fixture.componentRef.setInput('role', 'ASSESSOR');
    fixture.detectChanges();
    radios[0].click();
    fixture.detectChanges();
    expect(picked).toEqual(['ASSESSOR', null]);
  });
});
