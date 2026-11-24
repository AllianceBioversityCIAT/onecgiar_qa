import { drizzle } from 'drizzle-orm/mysql2';
import { InMemoryUserProgramsStore } from '../../test/support/in-memory-stores.js';
import * as schema from '../database/drizzle/schema/index.js';
import {
  DrizzleUserProgramsStore,
  UserProgramsRepository,
} from './user-programs.repository.js';
import {
  ExclusionExistsError,
  ExclusionNotFoundError,
  ExclusionNotManualError,
  ExclusionNotReportingError,
  ExclusionReasonError,
  InvalidProgramIdError,
} from './users.errors.js';

// Expected values come from FR-4 (manual add / remove, dismiss with a reason,
// history kept), DD-5 (rows are never deleted), DD-12 (who may end a row) and
// the schema CHECKs, written out as literals.

const ANA = 7;
const ADMIN = 1;
const OTHER_ADMIN = 2;

function setup() {
  const store = new InMemoryUserProgramsStore();
  return { store, programs: new UserProgramsRepository(store) };
}

/** A Reporting exclusion, as child 2 will store it: only the store can write one today. */
async function reportingExclusion(
  store: InMemoryUserProgramsStore,
  programId: number,
  userId = ANA,
) {
  const result = await store.insertExclusion({
    userId,
    programId,
    origin: 'reporting',
    reportingRole: 'Science Program Lead',
    createdBy: null,
  });
  if (result.kind !== 'created') throw new Error('seed failed');
  return result.exclusion;
}

describe('UserProgramsRepository manual exclusions (FR-4, DD-5)', () => {
  it('adds an active manual exclusion with who, when and the reason', async () => {
    const { programs } = setup();

    const added = await programs.addManualExclusion({
      userId: ANA,
      programId: 5,
      reason: 'Co-author of the results',
      createdBy: ADMIN,
    });

    expect(added).toMatchObject({
      userId: ANA,
      programId: 5,
      origin: 'manual',
      status: 'active',
      reason: 'Co-author of the results',
      createdBy: ADMIN,
      endedAt: null,
      endedBy: null,
      endReason: null,
    });
    expect(added.createdAt).toBeInstanceOf(Date);
  });

  it('refuses a second active exclusion of the same user and program, and writes nothing', async () => {
    const { store, programs } = setup();
    await programs.addManualExclusion({
      userId: ANA,
      programId: 5,
      reason: 'first',
      createdBy: ADMIN,
    });
    const writes = store.writes;

    await expect(
      programs.addManualExclusion({
        userId: ANA,
        programId: 5,
        reason: 'second',
        createdBy: OTHER_ADMIN,
      }),
    ).rejects.toBeInstanceOf(ExclusionExistsError);

    expect(store.writes).toBe(writes);
    expect(store.exclusions).toHaveLength(1);
  });

  it('allows the same program for another user, and another program for the same user', async () => {
    const { store, programs } = setup();
    const add = (userId: number, programId: number) =>
      programs.addManualExclusion({
        userId,
        programId,
        reason: 'conflict',
        createdBy: ADMIN,
      });

    await add(ANA, 5);
    await add(8, 5);
    await add(ANA, 6);

    expect(store.exclusions.map((e) => [e.userId, e.programId])).toEqual([
      [ANA, 5],
      [8, 5],
      [ANA, 6],
    ]);
  });

  it.each([
    ['empty', ''],
    ['blank', '   '],
  ])(
    'refuses a %s reason: a 400 on the reason field, nothing stored',
    async (_n, reason) => {
      const { store, programs } = setup();

      const failure = await programs
        .addManualExclusion({
          userId: ANA,
          programId: 5,
          reason,
          createdBy: ADMIN,
        })
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(ExclusionReasonError);
      expect((failure as ExclusionReasonError).getResponse()).toMatchObject({
        code: 'VALIDATION_FAILED',
        fields: [{ field: 'reason', code: 'REQUIRED' }],
      });
      expect(store.exclusions).toEqual([]);
      expect(store.writes).toBe(0);
    },
  );

  it('accepts a reason of 500 characters and refuses 501', async () => {
    const { programs } = setup();

    await expect(
      programs.addManualExclusion({
        userId: ANA,
        programId: 5,
        reason: 'x'.repeat(500),
        createdBy: ADMIN,
      }),
    ).resolves.toMatchObject({ status: 'active' });
    await expect(
      programs.addManualExclusion({
        userId: ANA,
        programId: 6,
        reason: 'x'.repeat(501),
        createdBy: ADMIN,
      }),
    ).rejects.toMatchObject({
      response: { fields: [{ field: 'reason', code: 'TOO_LONG' }] },
    });
  });

  it('removing keeps the row: status removed, who and when, the original reason and creator', async () => {
    const { store, programs } = setup();
    const added = await programs.addManualExclusion({
      userId: ANA,
      programId: 5,
      reason: 'Co-author',
      createdBy: ADMIN,
    });

    const removed = await programs.removeManualExclusion({
      userId: ANA,
      exclusionId: added.id,
      endedBy: OTHER_ADMIN,
    });

    expect(removed).toMatchObject({
      id: added.id,
      status: 'removed',
      endedBy: OTHER_ADMIN,
      reason: 'Co-author',
      createdBy: ADMIN,
    });
    expect(removed.endedAt).toBeInstanceOf(Date);
    expect(store.exclusions).toHaveLength(1);
  });

  it('after a removal the program can be excluded again: history keeps both rows, one active', async () => {
    const { programs } = setup();
    const first = await programs.addManualExclusion({
      userId: ANA,
      programId: 5,
      reason: 'first',
      createdBy: ADMIN,
    });
    await programs.removeManualExclusion({
      userId: ANA,
      exclusionId: first.id,
      endedBy: ADMIN,
    });

    await programs.addManualExclusion({
      userId: ANA,
      programId: 5,
      reason: 'again',
      createdBy: ADMIN,
    });

    const history = await programs.findExclusions(ANA);
    expect(history.map((e) => [e.reason, e.status])).toEqual([
      ['first', 'removed'],
      ['again', 'active'],
    ]);
  });

  it('refuses to remove an exclusion that already ended, or one of another user, as not found', async () => {
    const { store, programs } = setup();
    const mine = await programs.addManualExclusion({
      userId: ANA,
      programId: 5,
      reason: 'r',
      createdBy: ADMIN,
    });
    await programs.removeManualExclusion({
      userId: ANA,
      exclusionId: mine.id,
      endedBy: ADMIN,
    });
    const theirs = await programs.addManualExclusion({
      userId: 8,
      programId: 5,
      reason: 'r',
      createdBy: ADMIN,
    });
    const writes = store.writes;

    for (const attempt of [
      { userId: ANA, exclusionId: mine.id },
      { userId: ANA, exclusionId: theirs.id },
      { userId: ANA, exclusionId: 999 },
    ]) {
      await expect(
        programs.removeManualExclusion({ ...attempt, endedBy: ADMIN }),
      ).rejects.toBeInstanceOf(ExclusionNotFoundError);
    }
    expect(store.writes).toBe(writes);
  });

  it('refuses to remove a Reporting exclusion: it can only be dismissed', async () => {
    const { store, programs } = setup();
    const reporting = await reportingExclusion(store, 5);
    const writes = store.writes;

    await expect(
      programs.removeManualExclusion({
        userId: ANA,
        exclusionId: reporting.id,
        endedBy: ADMIN,
      }),
    ).rejects.toBeInstanceOf(ExclusionNotManualError);

    expect(store.writes).toBe(writes);
    expect(store.exclusions[0]?.status).toBe('active');
  });
});

describe('UserProgramsRepository dismissing a Reporting exclusion (FR-4)', () => {
  it('dismisses with a reason: it stops being active, who, when and why are kept', async () => {
    const { store, programs } = setup();
    const reporting = await reportingExclusion(store, 5);

    const dismissed = await programs.dismissReportingExclusion({
      userId: ANA,
      exclusionId: reporting.id,
      endedBy: ADMIN,
      reason: 'The Reporting role is outdated',
    });

    expect(dismissed).toMatchObject({
      id: reporting.id,
      origin: 'reporting',
      status: 'dismissed',
      endedBy: ADMIN,
      endReason: 'The Reporting role is outdated',
      reportingRole: 'Science Program Lead',
      activeKey: null,
    });
    expect(dismissed.endedAt).toBeInstanceOf(Date);
    expect(store.exclusions).toHaveLength(1);
  });

  it.each([
    ['empty', ''],
    ['blank', '  '],
  ])(
    'requires a reason: %s is a 400 on the reason field and the row stays active',
    async (_n, reason) => {
      const { store, programs } = setup();
      const reporting = await reportingExclusion(store, 5);
      const writes = store.writes;

      await expect(
        programs.dismissReportingExclusion({
          userId: ANA,
          exclusionId: reporting.id,
          endedBy: ADMIN,
          reason,
        }),
      ).rejects.toBeInstanceOf(ExclusionReasonError);

      expect(store.writes).toBe(writes);
      expect(store.exclusions[0]?.status).toBe('active');
    },
  );

  it('refuses to dismiss a manual exclusion: it can only be removed', async () => {
    const { store, programs } = setup();
    const manual = await programs.addManualExclusion({
      userId: ANA,
      programId: 5,
      reason: 'r',
      createdBy: ADMIN,
    });
    const writes = store.writes;

    await expect(
      programs.dismissReportingExclusion({
        userId: ANA,
        exclusionId: manual.id,
        endedBy: ADMIN,
        reason: 'because',
      }),
    ).rejects.toBeInstanceOf(ExclusionNotReportingError);

    expect(store.writes).toBe(writes);
  });

  it('a dismissed exclusion is not found a second time, and a new Reporting row can follow', async () => {
    const { store, programs } = setup();
    const first = await reportingExclusion(store, 5);
    await programs.dismissReportingExclusion({
      userId: ANA,
      exclusionId: first.id,
      endedBy: ADMIN,
      reason: 'outdated',
    });

    await expect(
      programs.dismissReportingExclusion({
        userId: ANA,
        exclusionId: first.id,
        endedBy: ADMIN,
        reason: 'again',
      }),
    ).rejects.toBeInstanceOf(ExclusionNotFoundError);
    await reportingExclusion(store, 5);

    expect(store.exclusions.map((e) => e.status)).toEqual([
      'dismissed',
      'active',
    ]);
  });
});

// DD-12 / T-1 review: the DB allows a NULL `ended_by` only for a `reporting`
// exclusion that is `removed` (a system end). Every end an admin triggers
// carries the admin's id, and the API makes the actor impossible to omit.
describe('UserProgramsRepository who ends an exclusion (DD-12)', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['zero', 0],
  ])(
    'an admin removal without an actor (%s) is refused before any write',
    async (_n, actor) => {
      const { store, programs } = setup();
      const added = await programs.addManualExclusion({
        userId: ANA,
        programId: 5,
        reason: 'r',
        createdBy: ADMIN,
      });
      const writes = store.writes;

      await expect(
        programs.removeManualExclusion({
          userId: ANA,
          exclusionId: added.id,
          endedBy: actor as never,
        }),
      ).rejects.toThrow(/actor/i);

      expect(store.writes).toBe(writes);
      expect(store.exclusions[0]?.status).toBe('active');
    },
  );

  it.each([
    ['null', null],
    ['undefined', undefined],
  ])(
    'an admin dismissal without an actor (%s) is refused before any write',
    async (_n, actor) => {
      const { store, programs } = setup();
      const reporting = await reportingExclusion(store, 5);
      const writes = store.writes;

      await expect(
        programs.dismissReportingExclusion({
          userId: ANA,
          exclusionId: reporting.id,
          endedBy: actor as never,
          reason: 'outdated',
        }),
      ).rejects.toThrow(/actor/i);

      expect(store.writes).toBe(writes);
    },
  );

  it('the system can end a Reporting exclusion as removed, with no actor', async () => {
    const { store, programs } = setup();
    const reporting = await reportingExclusion(store, 5);

    const ended = await programs.endReportingExclusionAsSystem({
      userId: ANA,
      exclusionId: reporting.id,
    });

    expect(ended).toMatchObject({
      status: 'removed',
      endedBy: null,
      origin: 'reporting',
    });
    expect(ended.endedAt).toBeInstanceOf(Date);
  });

  it('the system cannot end a manual exclusion', async () => {
    const { store, programs } = setup();
    const manual = await programs.addManualExclusion({
      userId: ANA,
      programId: 5,
      reason: 'r',
      createdBy: ADMIN,
    });
    const writes = store.writes;

    await expect(
      programs.endReportingExclusionAsSystem({
        userId: ANA,
        exclusionId: manual.id,
      }),
    ).rejects.toBeInstanceOf(ExclusionNotReportingError);

    expect(store.writes).toBe(writes);
    expect(store.exclusions[0]?.status).toBe('active');
  });

  it('the fake enforces the schema CHECKs, so a path that skipped the actor would fail here as on MySQL', async () => {
    const { store } = setup();
    const manual = await store.insertExclusion({
      userId: ANA,
      programId: 5,
      origin: 'manual',
      reason: 'r',
      createdBy: ADMIN,
    });
    const reporting = await reportingExclusion(store, 6);
    if (manual.kind !== 'created') throw new Error('seed failed');
    const end = (
      id: number,
      status: 'removed' | 'dismissed',
      by: number | null,
    ) =>
      store.endExclusion(id, {
        status,
        endedBy: by,
        endReason: status === 'dismissed' ? 'why' : null,
        at: new Date(),
      });

    await expect(end(manual.exclusion.id, 'removed', null)).rejects.toThrow(
      /chk_user_program_exclusions_ended/,
    );
    await expect(end(reporting.id, 'dismissed', null)).rejects.toThrow(
      /chk_user_program_exclusions_ended/,
    );
    await expect(end(reporting.id, 'removed', null)).resolves.toBe(true);
  });
});

describe('UserProgramsRepository program scope (FR-4, DD-4)', () => {
  it('no rows means all programs: the scope reads empty', async () => {
    const { programs } = setup();

    await expect(programs.findScope(ANA)).resolves.toEqual([]);
  });

  it('replaces the scope by diff: adds the new programs, drops the missing ones, leaves the rest', async () => {
    const { store, programs } = setup();
    await programs.replaceScope(ANA, [5, 6, 7]);
    const writes = store.writes;

    const change = await programs.replaceScope(ANA, [6, 7, 9]);

    expect(change).toEqual({ before: [5, 6, 7], after: [6, 7, 9] });
    await expect(programs.findScope(ANA)).resolves.toEqual([6, 7, 9]);
    expect(store.writes - writes).toBe(2); // one insert (9), one delete (5)
  });

  it('a scope that does not change writes nothing', async () => {
    const { store, programs } = setup();
    await programs.replaceScope(ANA, [5, 6]);
    const writes = store.writes;

    const change = await programs.replaceScope(ANA, [6, 5, 5]);

    expect(change).toEqual({ before: [5, 6], after: [5, 6] });
    expect(store.writes).toBe(writes);
  });

  it('an empty list clears the scope back to all programs', async () => {
    const { programs } = setup();
    await programs.replaceScope(ANA, [5]);

    const change = await programs.replaceScope(ANA, []);

    expect(change).toEqual({ before: [5], after: [] });
    await expect(programs.findScope(ANA)).resolves.toEqual([]);
  });

  it('keeps the scopes of two users apart', async () => {
    const { programs } = setup();
    await programs.replaceScope(ANA, [5]);
    await programs.replaceScope(8, [6]);

    await expect(programs.findScope(ANA)).resolves.toEqual([5]);
    await expect(programs.findScope(8)).resolves.toEqual([6]);
  });

  it.each([
    ['zero', 0],
    ['negative', -3],
    ['fractional', 1.5],
    ['above the column range', 4294967296],
    ['not a number', Number.NaN],
  ])(
    'refuses a program id that is %s, and changes nothing',
    async (_n, bad) => {
      const { store, programs } = setup();
      await programs.replaceScope(ANA, [5]);
      const writes = store.writes;

      await expect(programs.replaceScope(ANA, [6, bad])).rejects.toBeInstanceOf(
        InvalidProgramIdError,
      );

      expect(store.writes).toBe(writes);
      await expect(programs.findScope(ANA)).resolves.toEqual([5]);
    },
  );
});

describe('UserProgramsRepository.findScopeView (what the cache loads, FR-6)', () => {
  it('carries the scope and only the ACTIVE exclusions', async () => {
    const { store, programs } = setup();
    await programs.replaceScope(ANA, [5, 6]);
    const removed = await programs.addManualExclusion({
      userId: ANA,
      programId: 5,
      reason: 'old',
      createdBy: ADMIN,
    });
    await programs.removeManualExclusion({
      userId: ANA,
      exclusionId: removed.id,
      endedBy: ADMIN,
    });
    const dismissed = await reportingExclusion(store, 6);
    await programs.dismissReportingExclusion({
      userId: ANA,
      exclusionId: dismissed.id,
      endedBy: ADMIN,
      reason: 'outdated',
    });
    await programs.addManualExclusion({
      userId: ANA,
      programId: 6,
      reason: 'current',
      createdBy: ADMIN,
    });
    await reportingExclusion(store, 9, 8); // another user's

    await expect(programs.findScopeView(ANA)).resolves.toEqual({
      programScope: [5, 6],
      exclusions: [{ programId: 6, status: 'active' }],
    });
  });

  it('a user with nothing set has an empty scope and no exclusions (all programs)', async () => {
    const { programs } = setup();

    await expect(programs.findScopeView(ANA)).resolves.toEqual({
      programScope: [],
      exclusions: [],
    });
  });
});

// DD-10: a decision that depends on concurrent writes reads with a lock, never plainly.
describe('UserProgramsRepository decisions use locking reads (DD-10)', () => {
  class RecordingStore extends InMemoryUserProgramsStore {
    reads: string[] = [];
    override findScope(userId: number, options?: { forUpdate?: boolean }) {
      this.reads.push(`scope:${options?.forUpdate ? 'lock' : 'plain'}`);
      return super.findScope(userId, options);
    }
    override findExclusionById(
      userId: number,
      id: number,
      options?: { forUpdate?: boolean },
    ) {
      this.reads.push(`exclusion:${options?.forUpdate ? 'lock' : 'plain'}`);
      return super.findExclusionById(userId, id, options);
    }
  }

  it('the scope diff reads the current scope FOR UPDATE', async () => {
    const store = new RecordingStore();
    const programs = new UserProgramsRepository(store);

    await programs.replaceScope(ANA, [5]);

    expect(store.reads).toEqual(['scope:lock']);
  });

  it.each(['remove', 'dismiss'] as const)(
    'the %s reads the exclusion FOR UPDATE before deciding',
    async (action) => {
      const store = new RecordingStore();
      const programs = new UserProgramsRepository(store);
      const seeded =
        action === 'remove'
          ? await programs.addManualExclusion({
              userId: ANA,
              programId: 5,
              reason: 'r',
              createdBy: ADMIN,
            })
          : await reportingExclusion(store, 5);
      store.reads = [];

      if (action === 'remove') {
        await programs.removeManualExclusion({
          userId: ANA,
          exclusionId: seeded.id,
          endedBy: ADMIN,
        });
      } else {
        await programs.dismissReportingExclusion({
          userId: ANA,
          exclusionId: seeded.id,
          endedBy: ADMIN,
          reason: 'outdated',
        });
      }

      expect(store.reads[0]).toBe('exclusion:lock');
    },
  );
});

describe('DrizzleUserProgramsStore (the real adapter over a stub driver)', () => {
  function adapter() {
    const statements: string[] = [];
    const client = {
      query: (query: { sql: string }) => {
        statements.push(query.sql);
        return Promise.resolve(
          query.sql.startsWith('insert')
            ? [{ insertId: 4, affectedRows: 1 }, []]
            : query.sql.startsWith('update')
              ? [{ affectedRows: 1 }, []]
              : [[], []],
        );
      },
    };
    const db = drizzle({ client: client as never, schema, mode: 'default' });
    return { store: new DrizzleUserProgramsStore(db), statements };
  }

  it('locking reads are SELECT ... FOR UPDATE, plain reads take no lock', async () => {
    const { store, statements } = adapter();

    await store.findScope(7, { forUpdate: true });
    await store.findExclusionById(7, 3, { forUpdate: true });
    await store.findExclusions(7, { forUpdate: true });
    await store.findScope(7);
    await store.findExclusionById(7, 3);
    await store.findActiveExclusions(7);

    expect(
      statements.slice(0, 3).every((sql) => sql.endsWith(' for update')),
    ).toBe(true);
    expect(statements[0]).toMatch(/from `user_programs` where/);
    expect(statements[1]).toMatch(
      /from `user_program_exclusions` where \(`user_program_exclusions`\.`id` = \? and `user_program_exclusions`\.`user_id` = \?\) limit \? for update$/,
    );
    for (const plain of statements.slice(3)) {
      expect(plain).not.toMatch(/for update|for share/);
    }
  });

  it('ending an exclusion is a conditional UPDATE on status = active, and never deletes', async () => {
    const { store, statements } = adapter();

    await expect(
      store.endExclusion(3, {
        status: 'removed',
        endedBy: 1,
        endReason: null,
        at: new Date('2026-10-19T10:00:00Z'),
      }),
    ).resolves.toBe(true);

    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(
      /^update `user_program_exclusions` set `status` = \?, `ended_at` = \?, `ended_by` = \?, `end_reason` = \? where \(`user_program_exclusions`\.`id` = \? and `user_program_exclusions`\.`status` = \?\)$/,
    );
    expect(statements.some((sql) => sql.startsWith('delete'))).toBe(false);
  });

  it('inserting never writes the generated active_key', async () => {
    const { store, statements } = adapter();

    await store
      .insertExclusion({
        userId: 7,
        programId: 5,
        origin: 'manual',
        reason: 'r',
        createdBy: 1,
      })
      .catch(() => undefined); // the stub returns no row to read back

    expect(statements[0]).toMatch(/^insert into `user_program_exclusions`/);
    expect(statements[0]).not.toMatch(/active_key/);
  });
});
