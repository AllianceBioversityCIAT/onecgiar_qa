import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { CyclesApi } from '../core/api/cycles-api';
import { ActiveCycle, cardLine } from './active-cycle';

const step = (position: number, state: string, opensAt: string, closesAt: string, requiresLoad = false) => ({
  position,
  name: `Step ${position} name`,
  audience: ['assessors', 'programs', 'lead_assessors', 'tpb', 'ppu'][position - 1],
  opensAt,
  closesAt,
  round: position < 3 ? 1 : 2,
  requiresLoad,
  state,
});
const official = (steps: unknown[], status = 'live') => ({
  id: 27,
  cycleId: 34,
  name: 'Main',
  kind: 'official',
  allPrograms: true,
  programIds: [],
  allResultTypes: true,
  resultTypeKeys: [],
  steps,
  status,
  currentStep: null,
  nextStep: null,
  readiness: [],
  assignedCount: { ASSESSOR: 0, LEAD_ASSESSOR: 0, TPB: 0, PPU: 0 },
  version: 1,
  createdAt: '2026-11-04T10:00:00Z',
});
const cycle = (status: string) => ({ id: 34, year: 2026, name: '2026 cycle', status, timelineCount: 1, startsOn: null, endsOn: null, createdAt: '' });

describe('ActiveCycle (sidebar card)', () => {
  let api: { list: ReturnType<typeof vi.fn>; timelines: ReturnType<typeof vi.fn> };
  let card: ActiveCycle;

  beforeEach(() => {
    api = { list: vi.fn(), timelines: vi.fn() };
    TestBed.configureTestingModule({ providers: [ActiveCycle, { provide: CyclesApi, useValue: api }] });
    card = TestBed.inject(ActiveCycle);
  });

  it('cardLine: short words for the narrow card', () => {
    expect(cardLine({ step: 'Step 2 of 5 · Programs', state: 'In progress', tone: 'active', when: 'closes 20 Nov, 23:59 CET' })).toBe('Step 2 of 5 · closes 20 Nov, 23:59 CET');
    expect(cardLine({ step: 'Step 1 of 5 · Assess', state: 'Waiting for results', tone: 'waiting', when: '' })).toBe('Waiting for results');
    expect(cardLine({ step: 'Step 1 of 5 · Assess', state: 'Opens in 3 days', tone: 'future', when: '' })).toBe('Step 1 of 5 · Opens in 3 days');
    expect(cardLine({ step: 'All 5 steps completed', state: 'Completed', tone: 'done', when: '' })).toBe('All 5 steps completed');
  });

  it('shows the real active cycle and where its main batch is (no more "Step 4 of 5 · closes 23 Jul")', async () => {
    api.list.mockReturnValue(of([cycle('closed'), cycle('active')]));
    api.timelines.mockReturnValue(of([official([step(1, 'closed', '2026-11-04T21:03', '2026-11-05T09:00', true), step(2, 'closed', '2026-11-05T09:01', '2026-11-05T13:00')], 'finished')]));
    await card.refresh(true);
    expect(api.timelines).toHaveBeenCalledWith(34);
    expect(card.card()).toEqual({ name: '2026 cycle', status: 'Active', line: 'All 2 steps completed' });
  });

  it('no active cycle, or an error: no card (better nothing than a wrong date)', async () => {
    api.list.mockReturnValue(of([cycle('closed')]));
    await card.refresh(true);
    expect(card.card()).toBeNull();
    api.list.mockReturnValue(throwError(() => new Error('down')));
    await card.refresh(true);
    expect(card.card()).toBeNull();
  });

  it('active cycle without a main batch says so', async () => {
    api.list.mockReturnValue(of([cycle('active')]));
    api.timelines.mockReturnValue(of([]));
    await card.refresh(true);
    expect(card.card()?.line).toBe('No main batch yet');
  });

  it('refreshes at most once a minute unless forced', async () => {
    api.list.mockReturnValue(of([]));
    await card.refresh(true);
    await card.refresh();
    expect(api.list).toHaveBeenCalledTimes(1);
  });
});
