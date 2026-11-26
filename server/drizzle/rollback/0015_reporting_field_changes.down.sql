-- Manual down script for 0015_reporting_field_changes (escalation/round-2-ppu, P2-3917 AC6).
-- Applied by a human, never by drizzle-kit or by an agent. Run it only on a
-- database where 0015 was applied, take a backup first, and run it WITHOUT
-- `--force` so the first failing statement stops the script.
--
-- LOSSY: it drops the dates on which the PPU's view first saw a case field
-- changed in the Reporting Tool. Nothing else reads them; the next PPU open
-- after a re-apply records the change again with that day's date.
--
-- AFTER a rollback, delete the `0015` row from drizzle's `__drizzle_migrations`
-- table, or drizzle will not re-apply `0015`.
ALTER TABLE `reporting_field_changes` DROP FOREIGN KEY `fk_reporting_field_changes_membership`;--> statement-breakpoint
DROP TABLE `reporting_field_changes`;
