import { InMemoryUsersStore } from '../../test/support/in-memory-stores.js';
import { DuplicateUserError, InvalidEmailError } from './users.errors.js';
import {
  normalizeCognitoSub,
  normalizeEmail,
  UsersRepository,
  type UsersStore,
} from './users.repository.js';

function setup() {
  const store = new InMemoryUsersStore();
  return { store, repo: new UsersRepository(store) };
}

describe('normalizeEmail', () => {
  it.each([
    ['Jane.Doe@CGIAR.org', 'jane.doe@cgiar.org'],
    ['  admin@cgiar.org  ', 'admin@cgiar.org'],
    ['already@lower.org', 'already@lower.org'],
  ])('%j -> %j', (input, expected) => {
    expect(normalizeEmail(input)).toBe(expected);
  });

  it.each(['', '   ', 'no-at-sign', '@', `${'a'.repeat(250)}@x.org`])(
    'rejects %j',
    (input) => {
      expect(() => normalizeEmail(input)).toThrow(InvalidEmailError);
    },
  );
});

describe('normalizeCognitoSub', () => {
  it.each([
    ['', null],
    ['   ', null],
    [undefined, null],
    [null, null],
    ['abc-123', 'abc-123'],
  ])('%j -> %j', (input, expected) => {
    expect(normalizeCognitoSub(input)).toBe(expected);
  });
});

describe('UsersRepository.create (FR-1 unique identity)', () => {
  it('stores the email lowercase with defaults sso, active, no sub', async () => {
    const { repo, store } = setup();
    const user = await repo.create({ email: ' Jane.Doe@CGIAR.org ' });
    expect(user.email).toBe('jane.doe@cgiar.org');
    expect(user.authSource).toBe('sso');
    expect(user.isActive).toBe(true);
    expect(user.cognitoSub).toBeNull();
    expect(store.rows).toHaveLength(1);
  });

  it('stores an empty-string sub as NULL so two pre-registered users do not collide', async () => {
    const { repo } = setup();
    const first = await repo.create({ email: 'a@cgiar.org', cognitoSub: '' });
    const second = await repo.create({ email: 'b@cgiar.org', cognitoSub: '' });
    expect(first.cognitoSub).toBeNull();
    expect(second.cognitoSub).toBeNull();
  });

  it('keeps a real sub', async () => {
    const { repo } = setup();
    const user = await repo.create({
      email: 'a@cgiar.org',
      cognitoSub: 'sub-1',
      authSource: 'custom',
    });
    expect(user.cognitoSub).toBe('sub-1');
    expect(user.authSource).toBe('custom');
  });

  it('rejects a duplicate email regardless of case', async () => {
    const { repo, store } = setup();
    await repo.create({ email: 'a@cgiar.org' });
    await expect(repo.create({ email: 'A@CGIAR.ORG' })).rejects.toBeInstanceOf(
      DuplicateUserError,
    );
    expect(store.rows).toHaveLength(1);
  });

  it('rejects a duplicate sub', async () => {
    const { repo } = setup();
    await repo.create({ email: 'a@cgiar.org', cognitoSub: 'sub-1' });
    await expect(
      repo.create({ email: 'b@cgiar.org', cognitoSub: 'sub-1' }),
    ).rejects.toBeInstanceOf(DuplicateUserError);
  });

  it('rejects an invalid email before touching the store', async () => {
    const { repo, store } = setup();
    await expect(repo.create({ email: 'nope' })).rejects.toBeInstanceOf(
      InvalidEmailError,
    );
    expect(store.writes).toBe(0);
  });
});

describe('UsersRepository lookups', () => {
  it('finds by email case-insensitively and by sub', async () => {
    const { repo } = setup();
    const created = await repo.create({
      email: 'a@cgiar.org',
      cognitoSub: 'sub-1',
    });
    expect((await repo.findByEmail(' A@Cgiar.org '))?.id).toBe(created.id);
    expect((await repo.findByCognitoSub('sub-1'))?.id).toBe(created.id);
    expect((await repo.findById(created.id))?.id).toBe(created.id);
    expect(await repo.findByEmail('missing@cgiar.org')).toBeUndefined();
  });

  it('never matches an empty sub', async () => {
    const { repo } = setup();
    await repo.create({ email: 'a@cgiar.org' });
    expect(await repo.findByCognitoSub('')).toBeUndefined();
  });
});

describe('UsersRepository.findOrCreateByEmail', () => {
  it('creates once and then returns the same user without writing', async () => {
    const { repo, store } = setup();
    const first = await repo.findOrCreateByEmail('Admin@CGIAR.org');
    expect(first.created).toBe(true);
    expect(first.user.email).toBe('admin@cgiar.org');

    const writesBefore = store.writes;
    const second = await repo.findOrCreateByEmail('admin@cgiar.org');
    expect(second.created).toBe(false);
    expect(second.user.id).toBe(first.user.id);
    expect(store.writes).toBe(writesBefore);
    expect(store.rows).toHaveLength(1);
  });

  it('resolves a lost insert race by re-reading the winner', async () => {
    const { store } = setup();
    const winner = await new UsersRepository(store).create({
      email: 'admin@cgiar.org',
    });
    // The first lookup misses (the other writer has not committed yet in this
    // process's view); the insert then hits the unique key.
    let lookups = 0;
    const racing: UsersStore = {
      findById: (id) => store.findById(id),
      findByCognitoSub: (sub) => store.findByCognitoSub(sub),
      insert: (values) => store.insert(values),
      findByEmail: (email) =>
        lookups++ === 0 ? Promise.resolve(undefined) : store.findByEmail(email),
    };
    const result = await new UsersRepository(racing).findOrCreateByEmail(
      'admin@cgiar.org',
    );
    expect(result.created).toBe(false);
    expect(result.user.id).toBe(winner.id);
    expect(store.rows).toHaveLength(1);
  });
});
