import { startSession } from './session-start';

describe('how the Cognito session starts for the page the app is born on', () => {
  const session = () => ({ bootstrap: vi.fn(() => Promise.resolve()), startAnonymous: vi.fn() });

  it('the Science Program view (/sp, in Reporting\'s iframe) never recovers the Cognito session', () => {
    for (const path of ['/sp', '/sp/', '/sp/timelines/1/results/2']) {
      const s = session();
      startSession(s, path);
      expect(s.startAnonymous, path).toHaveBeenCalledTimes(1);
      expect(s.bootstrap, path).not.toHaveBeenCalled();
    }
  });

  it('every other page recovers it as before', async () => {
    for (const path of ['/', '/login', '/results/9792', '/auth/callback', '/spa', '']) {
      const s = session();
      await startSession(s, path);
      expect(s.bootstrap, path).toHaveBeenCalledTimes(1);
      expect(s.startAnonymous, path).not.toHaveBeenCalled();
    }
  });
});
