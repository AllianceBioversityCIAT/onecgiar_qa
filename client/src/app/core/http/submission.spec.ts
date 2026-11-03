import { Subject } from 'rxjs';
import { submission } from './submission';

describe('submission', () => {
  it('a second call while busy is ignored: the work runs once', async () => {
    const save = submission();
    const reply = new Subject<string>();
    const work = vi.fn(() => reply.asObservable());

    const first = save.run(work);
    const second = save.run(work);
    expect(save.busy()).toBe(true);
    reply.next('done');
    reply.complete();

    expect(await first).toBe('done');
    expect(await second).toBeUndefined();
    expect(work).toHaveBeenCalledOnce();
    expect(save.busy()).toBe(false);
  });

  it('unlocks after a failure so the user can try again', async () => {
    const save = submission();
    await expect(save.run(() => Promise.reject(new Error('x')))).rejects.toThrow('x');
    expect(save.busy()).toBe(false);
    expect(await save.run(() => Promise.resolve(1))).toBe(1);
  });
});
