import { cyclePanelView } from './cycle-panel';

describe('cyclePanelView', () => {
  it('draws one segment per step and puts the closing time on its own line', () => {
    expect(cyclePanelView('Step 2 of 5 · closes 20 Nov, 23:59 CET')).toEqual({
      step: 'Step 2 of 5',
      detail: 'Closes 20 Nov, 23:59 CET',
      segments: ['done', 'current', 'upcoming', 'upcoming', 'upcoming'],
    });
  });

  it('marks every step done when the batch has finished', () => {
    expect(cyclePanelView('All 4 steps completed').segments).toEqual(['done', 'done', 'done', 'done']);
  });

  it('shows other lines as they are, with no bar', () => {
    expect(cyclePanelView('Waiting for results')).toEqual({ step: 'Waiting for results', detail: '', segments: [] });
    expect(cyclePanelView('No main batch yet').segments).toEqual([]);
  });
});
