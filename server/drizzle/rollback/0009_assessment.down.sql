-- Manual down script for 0009_assessment (step-1-assessment design 5).
-- Applied by a human, never by drizzle-kit or by an agent. Run it only on a
-- database where 0009 was applied, take a backup first, and run it WITHOUT
-- `--force` so the first failing statement stops the script.
--
-- LOSSY: it drops the seven assessment tables and every row they hold
-- (assessments, field validations, comments and their events, quick comments,
-- the audit trail and the release outbox) and the `title` column of
-- `timeline_results`. Nothing of that is recoverable from the remaining
-- tables. A release already sent to Reporting stays sent there.
--
-- The tables go child first, so no foreign key blocks a drop. Dropping a table
-- removes its own foreign keys, its indexes and its CHECKs with it.
--
-- AFTER a rollback, delete the `0009` row from drizzle's `__drizzle_migrations`
-- table, or drizzle will not re-apply `0009`.
DROP TABLE `assessment_releases`;--> statement-breakpoint
DROP TABLE `assessment_audit_events`;--> statement-breakpoint
DROP TABLE `comment_events`;--> statement-breakpoint
DROP TABLE `assessment_comments`;--> statement-breakpoint
DROP TABLE `assessment_field_validations`;--> statement-breakpoint
DROP TABLE `quick_comments`;--> statement-breakpoint
DROP TABLE `result_assessments`;--> statement-breakpoint
ALTER TABLE `timeline_results` DROP COLUMN `title`;
