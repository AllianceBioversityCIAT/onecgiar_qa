import { drizzle } from 'drizzle-orm/mysql2';
import { InMemoryUsersStore } from '../../test/support/in-memory-stores.js';
import * as schema from '../database/drizzle/schema/index.js';
import { DuplicateUserError, InvalidEmailError } from './users.errors.js';
import {
  DrizzleUsersStore,
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
      update: (id, values) => store.update(id, values),
      linkCognitoSub: (id, sub) => store.linkCognitoSub(id, sub),
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

describe('UsersRepository.linkCognitoSub', () => {
  it('links the sub of a user that has none', async () => {
    const { store, repo } = setup();
    const user = await repo.create({ email: 'ana@cgiar.org' });

    await expect(repo.linkCognitoSub(user.id, 'sub-ana')).resolves.toEqual({
      linked: true,
    });
    expect(store.rows[0].cognitoSub).toBe('sub-ana');
  });

  it('never overwrites a sub: it returns the row as it stands, unchanged', async () => {
    const { store, repo } = setup();
    const user = await repo.create({
      email: 'ana@cgiar.org',
      cognitoSub: 'sub-first',
    });
    const writes = store.writes;

    const result = await repo.linkCognitoSub(user.id, 'sub-second');

    expect(store.rows[0].cognitoSub).toBe('sub-first');
    expect(store.writes).toBe(writes);
    expect(result).toMatchObject({
      linked: false,
      user: { id: user.id, cognitoSub: 'sub-first' },
    });
  });

  it('a sub owned by another user is a DuplicateUserError', async () => {
    const { store, repo } = setup();
    await repo.create({ email: 'bob@cgiar.org', cognitoSub: 'sub-bob' });
    const ana = await repo.create({ email: 'ana@cgiar.org' });

    await expect(repo.linkCognitoSub(ana.id, 'sub-bob')).rejects.toBeInstanceOf(
      DuplicateUserError,
    );
    expect(store.rows[1].cognitoSub).toBeNull();
  });
});

describe('DrizzleUsersStore.linkCognitoSub (the real adapter over a stub driver)', () => {
  function adapter(reply: () => unknown) {
    const statements: { sql: string; params: unknown[] }[] = [];
    const client = {
      query: (query: { sql: string }, params: unknown[]) => {
        statements.push({ sql: query.sql, params });
        return Promise.resolve(reply());
      },
    };
    const db = drizzle({ client: client as never, schema, mode: 'default' });
    return { store: new DrizzleUsersStore(db), statements };
  }

  it('sends UPDATE ... WHERE id = ? AND cognito_sub IS NULL, so a link already committed is never overwritten', async () => {
    const { store, statements } = adapter(() => [{ affectedRows: 1 }, []]);

    await store.linkCognitoSub(7, 'sub-ana');

    expect(statements).toHaveLength(1);
    expect(statements[0].sql).toMatch(
      /^update `users` set `cognito_sub` = \?.* where \(`users`\.`id` = \? and `users`\.`cognito_sub` is null\)$/,
    );
    expect(statements[0].params).toContain('sub-ana');
    expect(statements[0].params).toContain(7);
  });

  it('reports one affected row as linked and none as already-linked', async () => {
    const hit = adapter(() => [{ affectedRows: 1 }, []]);
    const miss = adapter(() => [{ affectedRows: 0 }, []]);

    await expect(hit.store.linkCognitoSub(7, 'sub-ana')).resolves.toEqual({
      kind: 'linked',
    });
    await expect(miss.store.linkCognitoSub(7, 'sub-ana')).resolves.toEqual({
      kind: 'already-linked',
    });
  });

  it('reports a duplicate key as duplicate', async () => {
    const clash = adapter(() => {
      throw Object.assign(new Error('Duplicate entry'), {
        code: 'ER_DUP_ENTRY',
        errno: 1062,
      });
    });

    await expect(clash.store.linkCognitoSub(7, 'sub-ana')).resolves.toEqual({
      kind: 'duplicate',
    });
  });
});

describe('DrizzleUsersStore reads (the real adapter over a stub driver)', () => {
  function adapter() {
    const statements: string[] = [];
    const client = {
      query: (query: { sql: string }) => {
        statements.push(query.sql);
        return Promise.resolve([[], []]);
      },
    };
    const db = drizzle({ client: client as never, schema, mode: 'default' });
    return { store: new DrizzleUsersStore(db), statements };
  }

  it('a locking read by id is SELECT ... FOR UPDATE on the primary key, and a plain read takes no lock', async () => {
    const { store, statements } = adapter();

    await store.findById(7, { forUpdate: true });
    await store.findById(7);

    expect(statements[0]).toMatch(
      /where `users`\.`id` = \? limit \? for update$/,
    );
    expect(statements[1]).not.toMatch(/for update|for share/);
  });
});
