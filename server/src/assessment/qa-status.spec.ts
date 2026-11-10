// @akili-spec assessment/step-1-assessment
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  QA_STATUS_LABELS,
  QA_STATUSES,
  STATUS_RULES,
  statusOf,
  statusSqlCase,
  type QaStatus,
  type StatusInputs,
} from './qa-status.js';

// Expected values are literals from the FR-5 table and its scenario *Status
// after each end* (requirements.md), never recomputed from STATUS_RULES.

const base: StatusInputs = {
  membershipStatus: 'pending',
  endReason: null,
  assessmentStatus: null,
  hasClarificationThread: false,
};

describe('statusOf (FR-5 table)', () => {
  it.each<[string, Partial<StatusInputs>, QaStatus]>([
    [
      'auto-validated membership',
      { membershipStatus: 'auto_validated' },
      'auto_validated',
    ],
    ['pending, no assessment', {}, 'pending'],
    ['pending, assessment pending', { assessmentStatus: 'pending' }, 'pending'],
    [
      'returned assessment, clarification thread, membership not ended',
      { assessmentStatus: 'returned', hasClarificationThread: true },
      'clarification_requested',
    ],
    [
      'returned assessment, clarification thread, membership ended returned',
      {
        assessmentStatus: 'returned',
        hasClarificationThread: true,
        endReason: 'returned',
      },
      'clarification_requested',
    ],
    [
      'returned assessment, no clarification thread, membership not ended',
      { assessmentStatus: 'returned' },
      'returned_to_program',
    ],
    [
      'returned assessment, no clarification thread, membership ended returned',
      { assessmentStatus: 'returned', endReason: 'returned' },
      'returned_to_program',
    ],
    [
      'quality-assessed assessment, membership not ended',
      { assessmentStatus: 'quality_assessed' },
      'quality_assessed',
    ],
    [
      'quality-assessed assessment, membership released',
      { assessmentStatus: 'quality_assessed', endReason: 'released_qaed' },
      'quality_assessed',
    ],
  ])('%s', (_name, change, expected) => {
    expect(statusOf({ ...base, ...change })).toBe(expected);
  });

  it('gives no status to a membership that is not in QA and has no assessment', () => {
    expect(statusOf({ ...base, membershipStatus: 'not_in_qa' })).toBeNull();
  });

  it('follows the inputs: nothing is stored (scenario Status after each end)', () => {
    // Three pending memberships: one auto-QA'd, one finished with a grey core
    // field, one left alone.
    const results = [
      { ...base, assessmentStatus: 'quality_assessed' as const },
      { ...base, assessmentStatus: 'returned' as const },
      { ...base },
    ].map(statusOf);
    expect(results).toEqual([
      'quality_assessed',
      'returned_to_program',
      'pending',
    ]);

    // The same membership read again after the program raises a thread.
    const returned = { ...base, assessmentStatus: 'returned' as const };
    expect(statusOf(returned)).toBe('returned_to_program');
    expect(statusOf({ ...returned, hasClarificationThread: true })).toBe(
      'clarification_requested',
    );
  });

  it('never produces the statuses of later stories, which stay filter values (FR-5)', () => {
    const produced = new Set(STATUS_RULES.map((rule) => rule.status));
    expect(produced.has('pending_tpb_review')).toBe(false);
    expect(produced.has('pending_ppu')).toBe(false);
    expect(produced.has('unresolved')).toBe(false);
    expect([...QA_STATUSES]).toEqual([
      'pending',
      'returned_to_program',
      'clarification_requested',
      'pending_tpb_review',
      'pending_ppu',
      'unresolved',
      'quality_assessed',
      'auto_validated',
    ]);
  });

  it('labels every status as the requirement words them', () => {
    expect(QA_STATUS_LABELS).toEqual({
      pending: 'Pending',
      returned_to_program: 'Returned to program',
      clarification_requested: 'Clarification requested',
      pending_tpb_review: 'Pending for TPB review',
      pending_ppu: 'Pending PPU',
      unresolved: 'Unresolved',
      quality_assessed: 'Quality Assessed',
      auto_validated: 'Auto-validated',
    });
  });
});

describe('statusSqlCase (DD-4: one table, two readers)', () => {
  const dialect = new MySqlDialect();
  const text = dialect.sqlToQuery(
    statusSqlCase({
      membershipStatus: sql.raw('m_status'),
      endReason: sql.raw('m_end'),
      assessmentStatus: sql.raw('a_status'),
      hasClarificationThread: sql.raw('thread'),
    }),
  );

  it('is the CASE the FR-5 table spells out, as text', () => {
    // Hand-written from the requirement's table, one WHEN per row, in order.
    expect(text.sql).toBe(
      "CASE WHEN m_status = 'auto_validated' THEN 'auto_validated' " +
        "WHEN m_status = 'pending' AND (a_status IS NULL OR a_status = 'pending') THEN 'pending' " +
        "WHEN m_status = 'pending' AND (m_end IS NULL OR m_end = 'returned') AND a_status = 'returned' AND thread = 1 THEN 'clarification_requested' " +
        "WHEN m_status = 'pending' AND (m_end IS NULL OR m_end = 'returned') AND a_status = 'returned' AND thread = 0 THEN 'returned_to_program' " +
        "WHEN a_status = 'quality_assessed' THEN 'quality_assessed' ELSE NULL END",
    );
    expect(text.params).toEqual([]);
  });

  it('binds no request value: it takes only the columns it is given', () => {
    const bound = dialect.sqlToQuery(
      statusSqlCase({
        membershipStatus: sql`${sql.identifier('tr')}.${sql.identifier('status')}`,
        endReason: sql`${sql.identifier('tr')}.${sql.identifier('end_reason')}`,
        assessmentStatus: sql`${sql.identifier('ra')}.${sql.identifier('status')}`,
        hasClarificationThread: sql`EXISTS (SELECT 1)`,
      }),
    );
    expect(bound.sql).toContain("`tr`.`status` = 'auto_validated'");
    expect(bound.sql).toContain('EXISTS (SELECT 1) = 1');
    expect(bound.params).toEqual([]);
  });

  // The same text read as a program: every combination of the four inputs
  // must give what `statusOf` gives (the TS reader of the one table).
  type Env = Record<string, string | number | null>;
  const atomHolds = (atom: string, env: Env): boolean => {
    let match = /^(\w+) IS NULL$/.exec(atom);
    if (match) return env[match[1]] === null;
    match = /^(\w+) = '([a-z_]+)'$/.exec(atom);
    if (match) return env[match[1]] === match[2];
    match = /^(\w+) = (\d)$/.exec(atom);
    if (match) return env[match[1]] === Number(match[2]);
    match = /^(\w+) IN \((.+)\)$/.exec(atom);
    if (match) {
      const values = match[2].split(', ').map((v) => v.replaceAll("'", ''));
      return values.includes(String(env[match[1]]));
    }
    throw new Error(`unreadable SQL atom: ${atom}`);
  };
  // Each AND part is an atom or a parenthesised OR of atoms.
  const conditionHolds = (condition: string, env: Env): boolean =>
    condition.split(' AND ').every((part) =>
      part
        .replace(/^\((.*)\)$/, '$1')
        .split(' OR ')
        .some((atom) => atomHolds(atom, env)),
    );
  const rows = [...text.sql.matchAll(/WHEN (.+?) THEN '([a-z_]+)'/g)].map(
    (match) => ({ condition: match[1], status: match[2] }),
  );
  const evaluate = (inputs: StatusInputs): string | null => {
    const env: Env = {
      m_status: inputs.membershipStatus,
      m_end: inputs.endReason,
      a_status: inputs.assessmentStatus,
      thread: inputs.hasClarificationThread ? 1 : 0,
    };
    return (
      rows.find((row) => conditionHolds(row.condition, env))?.status ?? null
    );
  };

  it('gives, for every combination of inputs, the status statusOf gives', () => {
    const memberships = ['pending', 'auto_validated', 'not_in_qa'] as const;
    const ends = [
      null,
      'timeline_closed',
      'released_qaed',
      'released_not_qaed',
      'returned',
    ] as const;
    const assessments = [
      null,
      'pending',
      'quality_assessed',
      'returned',
    ] as const;
    let compared = 0;
    for (const membershipStatus of memberships) {
      for (const endReason of ends) {
        for (const assessmentStatus of assessments) {
          for (const hasClarificationThread of [false, true]) {
            const inputs = {
              membershipStatus,
              endReason,
              assessmentStatus,
              hasClarificationThread,
            };
            expect(evaluate(inputs), JSON.stringify(inputs)).toBe(
              statusOf(inputs),
            );
            compared += 1;
          }
        }
      }
    }
    expect(compared).toBe(120);
    expect(rows).toHaveLength(5);
  });
});
