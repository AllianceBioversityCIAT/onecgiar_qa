// P2-3911: the SQL of the SP write statements (read through `toSQL()`).
import { drizzle } from 'drizzle-orm/mysql2';
import type { DrizzleDB } from '../../database/drizzle/drizzle.module.js';
import { DrizzleSpWriteStore } from './sp-response.unit-of-work.js';

const store = new DrizzleSpWriteStore(drizzle.mock() as unknown as DrizzleDB);

describe('DrizzleSpWriteStore SQL (P2-3911)', () => {
  it('changes a comment state only while it is still the state the request judged', () => {
    const { sql, params } = store
      .buildSetCommentState(5, 'open', 'accepted')
      .toSQL();
    expect(sql).toBe(
      'update `assessment_comments` set `state` = ? where (`assessment_comments`.`id` = ? and `assessment_comments`.`state` = ?)',
    );
    expect(params).toEqual(['accepted', 5, 'open']);
  });

  it('touches no validation, assessment, release or membership table', () => {
    const texts = [
      store.buildSetCommentState(5, 'open', 'accepted').toSQL().sql,
      store
        .buildInsertResponse({
          commentId: 5,
          kind: 'accept',
          body: null,
          responderName: 'n',
          responderEmail: 'sp-user@example.org',
          programId: 1,
          at: new Date('2026-11-15T10:00:00Z'),
        })
        .toSQL().sql,
      store.buildLatestResponse(5).toSQL().sql,
      store
        .buildInsertClarificationAnswer({
          commentId: 5,
          responseId: 9,
          authorId: 3,
          body: 'b',
          at: new Date('2026-11-15T10:00:00Z'),
        })
        .toSQL().sql,
    ].join('\n');
    expect(texts).not.toMatch(
      /assessment_field_validations|result_assessments|assessment_releases|timeline_results/,
    );
  });
});
