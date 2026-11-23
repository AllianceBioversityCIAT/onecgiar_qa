-- Manual down script for 0014_admin_acts_as_reviewer (admin/acts-as-reviewer).
-- Applied by a human, never by drizzle-kit or by an agent. Run it only on a
-- database where 0014 was applied, take a backup first, and run it WITHOUT
-- `--force` so the first failing statement stops the script.
--
-- LOSSY: it drops the three flags that mark a write or an end made by a QA
-- Admin acting as a reviewer role. The rows stay; they then read as written by
-- an ordinary reviewer (the author id is kept).
--
-- AFTER a rollback, delete the `0014` row from drizzle's `__drizzle_migrations`
-- table, or drizzle will not re-apply `0014`.
ALTER TABLE `comment_decisions` DROP COLUMN `acted_as_admin`;--> statement-breakpoint
ALTER TABLE `assessment_comments` DROP COLUMN `acted_as_admin`;--> statement-breakpoint
ALTER TABLE `result_assessments` DROP COLUMN `finished_as_admin`;
