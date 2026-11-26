// @akili-spec escalation/round-2-ppu
import { drizzle } from 'drizzle-orm/mysql2';
import { describe, expect, it } from 'vitest';
import type { DrizzleDB } from '../database/drizzle/drizzle.module.js';
import {
  DrizzleAssessmentStore,
  DrizzleAssessmentWriteStore,
} from './assessment.store.js';
import { resolveAccess } from './scope.js';

// P2-3917: the membership read carries the TPB's step-4 row; the thread read
// joins the TPB's decision (DD-P7); AC6 reads and writes one statement each,
// and the write keeps the first date (DD-P6).

const db = drizzle.mock() as unknown as DrizzleDB;
const reads = new DrizzleAssessmentStore(db);
const writes = new DrizzleAssessmentWriteStore(db);

describe('membership read (P2-3917)', () => {
  const access = resolveAccess(
    {
      assignments: [
        {
          roleCode: 'PPU',
          roleIsActive: true,
          isActive: true,
          revokedAt: null,
          resultTypeKey: null,
          programId: null,
        },
      ],
      programScope: [],
      exclusions: [],
    },
    ['PPU'],
    false,
  );
  const { sql: text } = reads
    .buildMembershipQuery({
      timelineId: 7,
      resultCode: 1001,
      access,
      round: null,
      assessmentStepPosition: 1,
      roundTwoStepPositions: [3, 4, 5],
    })
    .toSQL();

  it("joins the row at the timeline's tpb step, with no bound value for the step", () => {
    expect(text).toContain(
      "left join `result_assessments` `tpb_assessment` on (`tpb_assessment`.`timeline_result_id` = `timeline_results`.`id` and `tpb_assessment`.`step_position` = (SELECT `tpb_step`.`position` FROM `timeline_steps` `tpb_step` WHERE `tpb_step`.`timeline_id` = `timeline_results`.`timeline_id` AND `tpb_step`.`audience` = 'tpb'))",
    );
  });

  it('scopes the PPU with the TPB-escalated EXISTS', () => {
    expect(text).toContain("`tpb_esc`.`status` = 'escalated'");
  });
});

describe('escalation thread (DD-P7)', () => {
  it("joins the TPB's decision by a literal role, binding nothing new", () => {
    const { sql: text } = reads
      .buildEscalationThreadQuery([70, 80], 'PPU', 'LEAD_ASSESSOR')
      .toSQL();
    expect(text).toContain(
      "left join `comment_decisions` `tpb_decision` on (`tpb_decision`.`comment_id` = `assessment_comments`.`id` and `tpb_decision`.`role_code` = 'TPB')",
    );
  });
});

describe('reporting_field_changes (AC6, DD-P6)', () => {
  it('reads one membership in one statement, by field', () => {
    const { sql: text, params } = reads.buildReportingChangesQuery(42).toSQL();
    expect(text).toBe(
      'select `field_key`, `detected_at` from `reporting_field_changes` where `reporting_field_changes`.`timeline_result_id` = ? order by `reporting_field_changes`.`field_key` asc',
    );
    expect(params).toEqual([42]);
  });

  it('writes every field in one insert that keeps the first date on a duplicate', () => {
    const { sql: text } = writes
      .buildRecordReportingChanges(42, ['a', 'b'], new Date('2026-12-04T10:00:00Z'))
      .toSQL();
    expect(text).toContain('insert into `reporting_field_changes`');
    expect(text).toContain('values (default, ?, ?, ?), (default, ?, ?, ?)');
    expect(text).toContain('on duplicate key update `id` = `id`');
  });

  it('issues no statement for no field', async () => {
    await expect(
      writes.recordReportingChanges(42, [], new Date()),
    ).resolves.toBeUndefined();
  });
});
