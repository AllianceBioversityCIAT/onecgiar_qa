import { cycleShortName } from './cycle-label';

describe('cycleShortName', () => {
  it('drops the word "cycle" so the line does not repeat it', () => {
    expect(cycleShortName('2026 cycle')).toBe('2026');
    expect(cycleShortName('Cycle 2027')).toBe('2027');
  });

  it('keeps names without the word, and a name that is only the word', () => {
    expect(cycleShortName('2026')).toBe('2026');
    expect(cycleShortName('Recycled 2026')).toBe('Recycled 2026');
    expect(cycleShortName('Cycle')).toBe('Cycle');
    expect(cycleShortName('Q1 cycle review')).toBe('Q1 cycle review');
    expect(cycleShortName('2026 cycle-2')).toBe('2026 cycle-2');
  });
});
