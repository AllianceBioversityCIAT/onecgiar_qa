import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AvailableSuggestionView } from '../../../../core/api/ai-suggestions.models';
import { needsReason, reasonError, validateWithReason } from './ai-reason';
import { AiReasonDialog } from './ai-reason-dialog';

const ai = (suggestedValue: number): AvailableSuggestionView => ({
  status: 'available',
  valueKind: 'level',
  fieldKey: 'innovation_dev.readiness_level',
  suggestionId: 's',
  signal: 'red',
  suggestedValue,
  explanation: '',
  evidenceQuote: 'q',
  quoteVerified: true,
  evidenceSource: null,
  promptVersion: 'v',
  modelId: 'm',
});

describe('needsReason (FR-10)', () => {
  it('asks when the reported IRL / IUL is 2 or more above the AI', () => {
    expect(needsReason('innovation_dev.readiness_level', 5, ai(3))).toBe(true);
    expect(needsReason('innovation_use.use_level.innovation_use_level', 9, ai(0))).toBe(true);
  });

  it('does not ask at a difference of 1, below the AI, or without an available suggestion', () => {
    expect(needsReason('innovation_dev.readiness_level', 4, ai(3))).toBe(false);
    expect(needsReason('innovation_dev.readiness_level', 1, ai(3))).toBe(false);
    expect(needsReason('innovation_dev.readiness_level', 9, null)).toBe(false);
    expect(needsReason('innovation_dev.readiness_level', null, ai(0))).toBe(false);
  });

  it('never asks on an Impact Area tag', () => {
    expect(needsReason('general.gender_tag', 2, ai(0))).toBe(false);
  });
});

describe('reasonError', () => {
  it.each([
    ['', 'Write why the reported level holds.'],
    ['   ', 'Write why the reported level holds.'],
    ['two\nlines', 'Keep the reason on one line.'],
    ['x'.repeat(201), 'Keep the reason under 201 characters.'],
  ])('refuses %j', (text, message) => expect(reasonError(text)).toBe(message));

  it('accepts one line of up to 200 characters', () => {
    expect(reasonError('x'.repeat(200))).toBeNull();
  });
});

describe('validateWithReason', () => {
  it('records the event first, then validates', async () => {
    const order: string[] = [];
    const store = {
      validatedAbove: async (field: string, level: number, reason: string) => {
        order.push(`event ${field} ${level} ${reason}`);
      },
    };
    const result = await validateWithReason(
      store,
      'innovation_dev.readiness_level',
      6,
      '  Annex  ',
      async () => {
        order.push('validate');
        return 'ok';
      },
    );
    expect(result).toBe('ok');
    expect(order).toEqual(['event innovation_dev.readiness_level 6 Annex', 'validate']);
  });
});

@Component({
  imports: [AiReasonDialog],
  template: `<qa-ai-reason-dialog
    [(open)]="open"
    [aiLevel]="3"
    [reportedLevel]="6"
    (confirmed)="saved.push($event)"
    (cancelled)="cancels = cancels + 1"
  />`,
})
class Host {
  readonly open = signal(true);
  saved: string[] = [];
  cancels = 0;
}

describe('AiReasonDialog', () => {
  const setup = () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const doc = document;
    const input = () => doc.querySelector<HTMLInputElement>('#ai-reason')!;
    const button = (text: string) =>
      [...doc.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;
    return { fixture, input, button };
  };

  it('keeps Save disabled until there is a reason, then emits it trimmed and closes', async () => {
    const { fixture, input, button } = setup();
    await fixture.whenStable();
    expect(button('Save and validate').disabled).toBe(true);
    input().value = ' Second pilot in the annex ';
    input().dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(button('Save and validate').disabled).toBe(false);
    button('Save and validate').click();
    fixture.detectChanges();
    expect(fixture.componentInstance.saved).toEqual(['Second pilot in the annex']);
    expect(fixture.componentInstance.open()).toBe(false);
  });

  it('Esc or a click outside clears the reason: the next opening starts empty', async () => {
    const { fixture, input } = setup();
    await fixture.whenStable();
    input().value = 'Half typed';
    input().dispatchEvent(new Event('input'));
    fixture.detectChanges();
    // What Esc and the overlay do: the dialog sets open to false.
    fixture.componentInstance.open.set(false);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(input().value).toBe('');
    expect(fixture.componentInstance.saved).toEqual([]);
  });

  it('Cancel saves nothing', async () => {
    const { fixture, input, button } = setup();
    await fixture.whenStable();
    input().value = 'Something';
    input().dispatchEvent(new Event('input'));
    fixture.detectChanges();
    button('Cancel').click();
    fixture.detectChanges();
    expect(fixture.componentInstance.saved).toEqual([]);
    expect(fixture.componentInstance.cancels).toBe(1);
    expect(fixture.componentInstance.open()).toBe(false);
  });
});
