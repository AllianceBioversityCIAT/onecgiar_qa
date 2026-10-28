import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { QaButtonImports } from '../button/qa-button';
import { QaLoadingImports, skeletonRows } from './qa-loading';

@Component({
  imports: [QaButtonImports, QaLoadingImports],
  template: `
    <button
      id="save"
      hlmBtn
      qaBtn
      tone="primary"
      type="button"
      [loading]="saving()"
      (click)="clicks = clicks + 1"
    >
      Save
    </button>
    <button id="off" hlmBtn qaBtn type="button" [disabled]="true" [loading]="saving()">Off</button>
    <qa-loading label="Loading the team">
      @for (i of rows; track i) {
        <qa-skeleton class="h-3 w-20" />
      }
    </qa-loading>
    <ul>
      @for (n of items; track n) {
        <li [qaReveal]="$index">{{ n }}</li>
      }
    </ul>
  `,
})
class Host {
  readonly saving = signal(false);
  clicks = 0;
  readonly rows = skeletonRows();
  readonly items = ['a', 'b', 'c'];
}

describe('loading kit', () => {
  function setup() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return {
      fixture,
      el,
      host: fixture.componentInstance,
      save: el.querySelector<HTMLButtonElement>('#save')!,
    };
  }

  it('a loading button spins, is disabled and ignores clicks; it comes back when done', async () => {
    const { fixture, host, save } = setup();
    host.saving.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(save.disabled).toBe(true);
    expect(save.getAttribute('aria-busy')).toBe('true');
    expect(save.classList).toContain('qa-btn-busy');
    save.click();
    expect(host.clicks).toBe(0);

    host.saving.set(false);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(save.disabled).toBe(false);
    expect(save.hasAttribute('aria-busy')).toBe(false);
    expect(save.classList).not.toContain('qa-btn-busy');
    save.click();
    expect(host.clicks).toBe(1);
  });

  it('ending a load keeps a button that is disabled for another reason disabled', async () => {
    const { fixture, host, el } = setup();
    host.saving.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    host.saving.set(false);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(el.querySelector<HTMLButtonElement>('#off')!.disabled).toBe(true);
  });

  it('a list skeleton shows 10 hidden placeholders and announces the load once', () => {
    const { el } = setup();
    const status = el.querySelector('qa-loading')!;
    expect(status.getAttribute('role')).toBe('status');
    expect(status.getAttribute('aria-busy')).toBe('true');
    expect(status.textContent).toContain('Loading the team…');
    const blocks = el.querySelectorAll('qa-skeleton');
    expect(blocks.length).toBe(10);
    expect(blocks[0].getAttribute('aria-hidden')).toBe('true');
  });

  it('list items come in one after another', () => {
    const { el } = setup();
    const items = [...el.querySelectorAll<HTMLElement>('li')];
    expect(items.every((li) => li.classList.contains('qa-reveal'))).toBe(true);
    expect(items.map((li) => li.style.getPropertyValue('--qa-i'))).toEqual(['0', '1', '2']);
  });
});
