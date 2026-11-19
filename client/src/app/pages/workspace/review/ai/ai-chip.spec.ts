import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AiChip } from './ai-chip';
import { AiChipVm, toAiChipVm } from './ai-chip.vm';

const red = toAiChipVm({
  status: 'available',
  valueKind: 'level',
  fieldKey: 'general.gender_tag',
  suggestionId: 's1',
  signal: 'red',
  suggestedValue: 0,
  explanation: 'No activity targets gender.',
  evidenceQuote: '',
  quoteVerified: false,
  evidenceSource: null,
  promptVersion: 'v2-1.0.0',
  modelId: 'm',
});
const green: AiChipVm = {
  ...(red as Extract<AiChipVm, { kind: 'available' }>),
  signal: 'green',
  label: 'Looks consistent',
};
const irl = toAiChipVm({
  status: 'available',
  valueKind: 'level',
  fieldKey: 'innovation_dev.readiness_level',
  suggestionId: 's2',
  signal: 'amber',
  suggestedValue: 4,
  explanation: 'Tested in two countries.',
  evidenceQuote: 'tested in Kenya and Uganda',
  quoteVerified: true,
  evidenceSource: null,
  promptVersion: 'v2-1.0.0',
  modelId: 'm',
  copiedByReviewer: true,
});

@Component({
  imports: [AiChip],
  template: `<qa-ai-chip
    [vm]="vm()"
    [readOnly]="readOnly()"
    (copyToComment)="copied.push($event)"
    (shown)="shown.push($event)"
  />`,
})
class Host {
  readonly vm = signal<AiChipVm>(red);
  readonly readOnly = signal(false);
  copied: string[] = [];
  shown: string[] = [];
}

function render(vm: AiChipVm, readOnly = false) {
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.vm.set(vm);
  fixture.componentInstance.readOnly.set(readOnly);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

describe('AiChip', () => {
  it('shows a red tag as "Review" with its explanation, never "Incorrect"', () => {
    const { el } = render(red);
    expect(el.querySelector('[data-testid="ai-signal"]')?.textContent?.trim()).toBe('Review');
    expect(el.querySelector('qa-ai-chip')?.getAttribute('aria-label')).toBe(
      'AI suggestion: Review',
    );
    expect(el.textContent).toContain('No activity targets gender.');
    expect(el.textContent).not.toMatch(/incorrect/i);
  });

  it('keeps the line breaks of the explanation (bullets one per line)', () => {
    const { el } = render({
      ...red,
      explanation: '- Novelty: a new process.\n- Positive change: farmers adopt it.',
    } as typeof red);
    const p = el.querySelector<HTMLElement>('[data-testid="ai-explanation"]')!;
    expect(p.classList).toContain('whitespace-pre-line');
    expect(p.textContent?.trim()).toBe('- Novelty: a new process.\n- Positive change: farmers adopt it.');
  });

  it('copies to the comment through the page, never by itself', () => {
    const { fixture, el } = render(red);
    const button = [...el.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Copy to comment'),
    );
    button!.click();
    expect(fixture.componentInstance.copied).toEqual(['general.gender_tag']);
  });

  it('read-only (TPB, ADMIN) has no copy button and shows the reviewer mark', () => {
    const { el } = render(irl, true);
    expect(el.textContent).not.toContain('Copy to comment');
    expect(el.querySelector('[data-testid="ai-mark"]')?.textContent).toBe('Copied by the reviewer');
  });

  it('shows IRL / IUL as the supported level with the quote', () => {
    const { el } = render(irl);
    expect(el.textContent).toContain('Evidence explicitly supports level 4');
    expect(el.querySelector('blockquote')?.textContent).toContain('tested in Kenya and Uganda');
  });

  it('a green tag hides its explanation behind a named toggle', () => {
    const { fixture, el } = render(green);
    expect(el.querySelector('[data-testid="ai-explanation"]')).toBeNull();
    const toggle = el.querySelector<HTMLButtonElement>('button[aria-label="Show AI explanation"]')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="ai-explanation"]')).not.toBeNull();
  });

  it('says why a suggestion is not available and offers no copy', () => {
    const { el } = render({
      kind: 'unavailable',
      fieldKey: 'general.climate_tag',
      label: 'Suggestion not available',
      reason: 'The evidence links are private or need a login.',
    });
    expect(el.textContent).toContain('Suggestion not available');
    expect(el.querySelector('[data-testid="ai-reason"]')?.textContent).toContain('private');
    expect(el.textContent).not.toContain('Copy to comment');
  });

  it('says a pending suggestion is in progress', () => {
    const { el } = render({
      kind: 'pending',
      fieldKey: 'general.poverty_tag',
      label: 'Suggestion in progress',
    });
    expect(el.textContent).toContain('Suggestion in progress');
  });

  it('reports shown once rendered, only for an available suggestion', async () => {
    const { fixture } = render(red);
    await fixture.whenStable();
    expect(fixture.componentInstance.shown).toEqual(['general.gender_tag']);
    const pending = render({ kind: 'pending', fieldKey: 'x', label: 'Suggestion in progress' });
    await pending.fixture.whenStable();
    expect(pending.fixture.componentInstance.shown).toEqual([]);
  });
});
