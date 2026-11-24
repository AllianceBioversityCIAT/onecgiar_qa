import { TestBed } from '@angular/core/testing';
import { FieldsPublishConfirm } from './fields-publish-confirm';

describe('FieldsPublishConfirm', () => {
  async function render(keep: { id: number; name: string; opensOn: string | null; version: number | null }[]) {
    const fixture = TestBed.createComponent(FieldsPublishConfirm);
    fixture.componentRef.setInput('groups', [{ typeKey: 'kp', type: 'Knowledge product', changes: [{ id: 'year', name: 'Reporting year', description: 'Hidden, was View only' }] }]);
    fixture.componentRef.setInput('timelines', { receive: [], keep });
    fixture.componentRef.setInput('open', true);
    fixture.autoDetectChanges();
    await fixture.whenStable();
    await new Promise((r) => setTimeout(r, 30));
    await fixture.whenStable();
    return fixture;
  }

  const note = 'Hidden and View only changes reach them now; Assessed and Core changes don';

  it('tells that visibility changes still reach timelines that keep their version (F-005)', async () => {
    await render([{ id: 43, name: 'December testing batch', opensOn: null, version: 7 }]);
    expect(document.body.textContent).toContain('Keep their current version');
    expect(document.body.textContent).toContain(note);
  });

  it('shows no note when no timeline keeps its version', async () => {
    await render([]);
    expect(document.body.textContent).not.toContain(note);
  });
});
