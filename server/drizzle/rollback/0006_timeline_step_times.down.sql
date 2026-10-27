-- Manual down script for 0006_timeline_step_times (timeline-step-times NFR-3).
-- Applied by a human, never by drizzle-kit or by an agent. Run it only on a
-- database where 0006 was applied, and take a backup first.
--
-- LOSSY: it keeps only the date part of each boundary. A step that was moved
-- to any time other than 00:00 (opening) or 23:59 (closing) loses that time.
-- A step still at 00:00 / 23:59, as every step migrated by 0006 is, comes back
-- identical to its day-only form.
ALTER TABLE `timeline_steps` DROP CHECK `chk_timeline_steps_dates`;--> statement-breakpoint
ALTER TABLE `timeline_steps` CHANGE COLUMN `opens_at` `opens_on` date NOT NULL, CHANGE COLUMN `closes_at` `closes_on` date NOT NULL;--> statement-breakpoint
ALTER TABLE `timeline_steps` ADD CONSTRAINT `chk_timeline_steps_dates` CHECK (`closes_on` >= `opens_on`);
