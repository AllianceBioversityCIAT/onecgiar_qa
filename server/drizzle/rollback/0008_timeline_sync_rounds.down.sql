-- Manual down script for 0008_timeline_sync_rounds (timeline-sync NFR-5).
-- Applied by a human, never by drizzle-kit or by an agent. Run it only on a
-- database where 0008 was applied, take a backup first, and run it WITHOUT
-- `--force` so the first failing statement stops the script.
--
-- IT REFUSES while a second round exists. Pre-check, run it first: it must
-- return no row. Any row is a result with a round-1 and a round-2 membership in
-- one timeline, which the step-1 key cannot hold.
--
--   SELECT `timeline_id`, `result_code`, COUNT(*) AS `memberships`
--   FROM `timeline_results`
--   GROUP BY `timeline_id`, `result_code`
--   HAVING COUNT(*) > 1;
--
-- IT ALSO REFUSES while a `returned` row exists, because the old `end_reason`
-- enum has no such value. Second pre-check, run it first: it must return 0.
--
--   SELECT COUNT(*) FROM timeline_results WHERE end_reason = 'returned';
--
-- The script does not rely on you running it: its first two statements re-add
-- the step-1 key and retype `end_reason` back to three values. MySQL refuses the
-- first on a duplicate `(timeline_id, result_code)` and the second, in strict
-- mode, on any `returned` row, both before anything is dropped. Resolve those
-- rows by hand first.
--
-- AFTER a rollback, delete the `0008` row from drizzle's `__drizzle_migrations`
-- table, or drizzle will not re-apply `0008`.
--
-- LOSSY: it drops `entry_round`, `previous_membership_id` and `changed_fields`
-- from `timeline_results`, and `round` and `step_position` from
-- `timeline_loads`. The sync history they carried is not recoverable from the
-- remaining columns.
ALTER TABLE `timeline_results` ADD CONSTRAINT `uq_timeline_results_timeline_code` UNIQUE(`timeline_id`, `result_code`);--> statement-breakpoint
ALTER TABLE `timeline_results` MODIFY COLUMN `end_reason` enum('timeline_closed','released_qaed','released_not_qaed');--> statement-breakpoint
ALTER TABLE `timeline_results` DROP FOREIGN KEY `timeline_results_previous_membership_id_timeline_results_id_fk`;--> statement-breakpoint
ALTER TABLE `timeline_results` DROP CHECK `chk_timeline_results_changed_fields`;--> statement-breakpoint
ALTER TABLE `timeline_results` DROP CHECK `chk_timeline_results_entry_round`;--> statement-breakpoint
ALTER TABLE `timeline_results` DROP INDEX `uq_timeline_results_timeline_code_round`;--> statement-breakpoint
ALTER TABLE `timeline_results` DROP COLUMN `previous_membership_id`, DROP COLUMN `changed_fields`, DROP COLUMN `entry_round`;--> statement-breakpoint
ALTER TABLE `timeline_loads` DROP CHECK `chk_timeline_loads_round`;--> statement-breakpoint
ALTER TABLE `timeline_loads` DROP CHECK `chk_timeline_loads_step_position`;--> statement-breakpoint
ALTER TABLE `timeline_loads` DROP COLUMN `round`, DROP COLUMN `step_position`;
