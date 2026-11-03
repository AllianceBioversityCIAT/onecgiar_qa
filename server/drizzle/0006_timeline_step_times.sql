ALTER TABLE `timeline_steps` DROP CHECK `chk_timeline_steps_dates`;--> statement-breakpoint
ALTER TABLE `timeline_steps` CHANGE COLUMN `opens_on` `opens_at` datetime NOT NULL, CHANGE COLUMN `closes_on` `closes_at` datetime NOT NULL;--> statement-breakpoint
UPDATE `timeline_steps` SET `closes_at` = TIMESTAMP(DATE(`closes_at`), '23:59:00');--> statement-breakpoint
ALTER TABLE `timeline_steps` ADD CONSTRAINT `chk_timeline_steps_dates` CHECK (`closes_at` > `opens_at`);
