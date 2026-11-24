import { toPublicUser } from './public-user.js';

// FR-12, design 7 "Nickname exposure": another user is rendered as id +
// nickname, nothing else. The expected shape is written out.

describe('toPublicUser (FR-12)', () => {
  it('keeps the id and the nickname and nothing else', () => {
    const stored = {
      id: 7,
      nickname: 'Ada',
      email: 'ada@cgiar.org',
      firstName: 'Ada',
      lastName: 'Lovelace',
      authSource: 'sso',
      isActive: true,
    };
    expect(toPublicUser(stored)).toEqual({ id: 7, nickname: 'Ada' });
    expect(Object.keys(toPublicUser(stored)).sort()).toEqual([
      'id',
      'nickname',
    ]);
  });

  it('keeps a missing nickname as null, never as another field', () => {
    expect(
      toPublicUser({ id: 8, nickname: null, email: 'x@cgiar.org' }),
    ).toEqual({ id: 8, nickname: null });
  });
});
