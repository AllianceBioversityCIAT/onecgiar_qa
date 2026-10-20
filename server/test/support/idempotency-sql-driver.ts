import { roundTrip } from './in-memory-idempotency.js';

/**
 * A stand-in for the mysql2 pool that EXECUTES the SQL the real Drizzle
 * adapter generates against an in-memory `idempotency_keys` table. It parses
 * only the statement shapes the store emits (PK insert, conditional UPDATE,
 * SELECT by key, bounded DELETE) and applies each one atomically when it
 * arrives, after a round trip, so racing callers interleave between
 * statements. Because the WHERE clause of every conditional write is read from
 * the real generated SQL, dropping a condition from the adapter changes the
 * outcome here: that is what lets a concurrency test prove the SQL fences.
 *
 * Unknown SQL throws, so a new statement shape cannot slip past unchecked.
 * It cannot prove MySQL's own locking or duplicate-key behavior (P-12, T-8).
 */
export class SqlDriver {
  readonly statements: Array<{ sql: string; values: unknown[] }> = [];
  private readonly rows: Array<Record<string, unknown>> = [];
  private failure: Error | undefined;

  failNext(error: Error): void {
    this.failure = error;
  }

  /** Test-only raw read of a row as drizzle sent it (datetimes are strings). */
  raw(actorId: number, key: string): Record<string, unknown> | undefined {
    const row = this.rows.find(
      (r) => r['actor_id'] === actorId && r['idem_key'] === key,
    );
    return row && structuredClone(row);
  }

  /** Test-only direct insert, `values` keyed by column name. */
  insertRaw(values: Record<string, unknown>): void {
    this.rows.push(structuredClone(values));
  }

  /** mysql2 signature, as drizzle calls it: `query({ sql, ... }, values)`. */
  async query(query: { sql: string }, values: unknown[] = []) {
    this.statements.push({ sql: query.sql, values });
    await roundTrip();
    if (this.failure) {
      const error = this.failure;
      this.failure = undefined;
      throw error;
    }
    return this.execute(query.sql, [...values]);
  }

  private execute(sql: string, params: unknown[]): [unknown, unknown[]] {
    const text = sql.replaceAll(/`idempotency_keys`\./g, '');
    if (text.startsWith('insert into `idempotency_keys`')) {
      return [this.insert(text, params), []];
    }
    if (text.startsWith('update `idempotency_keys` set')) {
      return [this.update(text, params), []];
    }
    if (text.startsWith('delete from `idempotency_keys`')) {
      return [this.delete(text, params), []];
    }
    if (/^select .* from `idempotency_keys`/.test(text)) {
      return [this.select(text, params), []];
    }
    throw new Error(`SqlDriver cannot execute: ${sql}`);
  }

  private insert(text: string, params: unknown[]) {
    const match =
      /^insert into `idempotency_keys` \((.*?)\) values \((.*)\)$/.exec(text);
    if (!match) throw new Error(`SqlDriver cannot parse insert: ${text}`);
    const columns = [...match[1]!.matchAll(/`(\w+)`/g)].map((m) => m[1]!);
    const slots = match[2]!.split(', ');
    const values = [...params];
    const row: Record<string, unknown> = {};
    columns.forEach((column, i) => {
      row[column] = slots[i] === '?' ? values.shift() : null;
    });
    if (
      this.rows.some(
        (r) =>
          r['actor_id'] === row['actor_id'] &&
          r['idem_key'] === row['idem_key'],
      )
    ) {
      throw Object.assign(new Error('Duplicate entry'), {
        code: 'ER_DUP_ENTRY',
        errno: 1062,
      });
    }
    this.rows.push(row);
    return { affectedRows: 1, insertId: 0 };
  }

  private update(text: string, params: unknown[]) {
    const match = /^update `idempotency_keys` set (.*?) where (.*)$/.exec(text);
    if (!match) throw new Error(`SqlDriver cannot parse update: ${text}`);
    const values = [...params];
    const assignments = [...match[1]!.matchAll(/`(\w+)` = \?/g)].map((m) => ({
      column: m[1]!,
      value: values.shift(),
    }));
    const predicate = this.predicate(match[2]!, values);
    const matched = this.rows.filter(predicate);
    for (const row of matched) {
      for (const { column, value } of assignments) row[column] = value;
    }
    return { affectedRows: matched.length };
  }

  private delete(text: string, params: unknown[]) {
    const match =
      /^delete from `idempotency_keys` where (.*?)(?: order by `(\w+)`)?(?: limit \?)?$/.exec(
        text,
      );
    if (!match) throw new Error(`SqlDriver cannot parse delete: ${text}`);
    const values = [...params];
    const predicate = this.predicate(match[1]!, values);
    let matched = this.rows.filter(predicate);
    if (match[2]) {
      const column = match[2];
      matched = matched.sort((a, b) =>
        String(a[column]).localeCompare(String(b[column])),
      );
    }
    if (text.endsWith(' limit ?'))
      matched = matched.slice(0, Number(values.shift()));
    for (const row of matched) this.rows.splice(this.rows.indexOf(row), 1);
    return { affectedRows: matched.length };
  }

  private select(text: string, params: unknown[]) {
    const match =
      /^select (.*?) from `idempotency_keys`(?: where (.*?))?(?: limit \?)?$/.exec(
        text,
      );
    if (!match) throw new Error(`SqlDriver cannot parse select: ${text}`);
    const columns = [...match[1]!.matchAll(/`(\w+)`/g)].map((m) => m[1]!);
    const values = [...params];
    const predicate = match[2] ? this.predicate(match[2], values) : () => true;
    let matched = this.rows.filter(predicate);
    if (text.endsWith(' limit ?'))
      matched = matched.slice(0, Number(values.shift()));
    return matched.map((row) => columns.map((column) => row[column] ?? null));
  }

  /**
   * A conjunction of `column <op> ?` (or `column in (?, ...)`) terms, taking
   * its parameters from `values` in order. Anything else throws.
   */
  private predicate(
    where: string,
    values: unknown[],
  ): (row: Record<string, unknown>) => boolean {
    const clause = where.replace(/ order by .*$/, '').replace(/ limit \?$/, '');
    const body = clause.replace(/^\((.*)\)$/, '$1');
    const terms = body.split(' and ').map((term) => {
      const m = /^`(\w+)` (=|<=|>=|<|>|<>|in) (\?|\([?, ]+\))$/.exec(
        term.trim(),
      );
      if (!m) throw new Error(`SqlDriver cannot parse condition: ${term}`);
      const [, column, op, slot] = m as unknown as [
        string,
        string,
        string,
        string,
      ];
      const operands =
        op === 'in'
          ? Array.from({ length: slot.split('?').length - 1 }, () =>
              values.shift(),
            )
          : [values.shift()];
      return { column, op, operands };
    });
    return (row) =>
      terms.every(({ column, op, operands }) => {
        const actual = row[column];
        const wanted = operands[0] as never;
        switch (op) {
          case '=':
            return actual === wanted;
          case '<>':
            return actual !== wanted;
          case '<=':
            return (actual as never) <= wanted;
          case '>=':
            return (actual as never) >= wanted;
          case '<':
            return (actual as never) < wanted;
          case '>':
            return (actual as never) > wanted;
          default:
            return operands.includes(actual);
        }
      });
  }
}
