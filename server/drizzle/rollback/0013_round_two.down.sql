-- Manual down script for 0013_round_two (escalation/round-2, Lead assessor round 2).
-- Applied by a human, never by drizzle-kit or by an agent. Run it only on a
-- database where 0013 was applied, take a backup first, and run it WITHOUT
-- `--force` so the first failing statement stops the script.
--
-- LOSSY: it drops `comment_decisions` with every row it holds, and drops the
-- soft-delete columns `deleted_at` and `deleted_by` (a soft-deleted comment
-- becomes a visible one again).
--
-- The enum narrowing statements FAIL while any row still holds a value added by
-- 0013 (`escalated` in `result_assessments.status`, `lead_sided_program` in the
-- comment states, `decision_set`, `decision_clear`, `comment_delete` or
-- `end_escalated` in `assessment_audit_events.action`). Delete or move those
-- rows consciously first; this script does not do it for you.
--
-- AFTER a rollback, delete the `0013` row from drizzle's `__drizzle_migrations`
-- table, or drizzle will not re-apply `0013`.
DROP TABLE `comment_decisions`;--> statement-breakpoint
ALTER TABLE `assessment_comments` DROP CONSTRAINT `chk_comment_deleted`;--> statement-breakpoint
ALTER TABLE `assessment_comments` DROP FOREIGN KEY `fk_assessment_comments_deleted_by`;--> statement-breakpoint
ALTER TABLE `assessment_comments` DROP COLUMN `deleted_by`;--> statement-breakpoint
ALTER TABLE `assessment_comments` DROP COLUMN `deleted_at`;--> statement-breakpoint
ALTER TABLE `assessment_audit_events` MODIFY COLUMN `action` enum('validate','unvalidate','check_all','uncheck_all','comment_add','comment_withdraw','quick_comment_save','end_quality_assessed','end_returned','release_sent','release_refused') NOT NULL;--> statement-breakpoint
ALTER TABLE `comment_events` MODIFY COLUMN `to_state` enum('open','withdrawn','clarification_requested','accepted','accepted_with_comment','disagreed','escalated','tpb_sided_program','tpb_sided_assessor','done') NOT NULL;--> statement-breakpoint
ALTER TABLE `comment_events` MODIFY COLUMN `from_state` enum('open','withdrawn','clarification_requested','accepted','accepted_with_comment','disagreed','escalated','tpb_sided_program','tpb_sided_assessor','done');--> statement-breakpoint
ALTER TABLE `assessment_comments` MODIFY COLUMN `state` enum('open','withdrawn','clarification_requested','accepted','accepted_with_comment','disagreed','escalated','tpb_sided_program','tpb_sided_assessor','done') NOT NULL DEFAULT 'open';--> statement-breakpoint
ALTER TABLE `result_assessments` MODIFY COLUMN `status` enum('pending','quality_assessed','returned') NOT NULL DEFAULT 'pending';
