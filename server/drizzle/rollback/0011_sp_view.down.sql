-- Manual down script for 0011_sp_view (P2-3911, Science Program view).
-- Applied by a human, never by drizzle-kit or by an agent. Run it only on a
-- database where 0011 was applied, take a backup first, and run it WITHOUT
-- `--force` so the first failing statement stops the script.
--
-- LOSSY: it deletes the `comment_events` rows written for Science Program
-- responses (their `actor_id` is NULL), drops the `sp_response_id` column, and
-- drops the four SP tables with every row they hold (link codes, SP sessions,
-- SP responses and the assessors' clarification answers). The state a comment
-- reached through an SP response (accepted, disagreed, clarification
-- requested, ...) stays on `assessment_comments`; 0009 already declares every
-- state.
--
-- AFTER a rollback, delete the `0011` row from drizzle's `__drizzle_migrations`
-- table, or drizzle will not re-apply `0011`.
ALTER TABLE `comment_events` DROP CONSTRAINT `chk_comment_events_actor`;--> statement-breakpoint
ALTER TABLE `comment_events` DROP FOREIGN KEY `fk_comment_events_sp_response`;--> statement-breakpoint
DELETE FROM `comment_events` WHERE `actor_id` IS NULL;--> statement-breakpoint
ALTER TABLE `comment_events` DROP COLUMN `sp_response_id`;--> statement-breakpoint
ALTER TABLE `comment_events` MODIFY COLUMN `actor_id` int unsigned NOT NULL;--> statement-breakpoint
DROP TABLE `comment_clarification_answers`;--> statement-breakpoint
DROP TABLE `sp_comment_responses`;--> statement-breakpoint
DROP TABLE `sp_sessions`;--> statement-breakpoint
DROP TABLE `sp_link_codes`;
