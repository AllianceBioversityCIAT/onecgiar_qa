ALTER TABLE `timeline_results` MODIFY COLUMN `end_reason` enum('timeline_closed','released_qaed','released_not_qaed','returned');--> statement-breakpoint
ALTER TABLE `timeline_loads` ADD `round` tinyint unsigned DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `timeline_loads` ADD `step_position` tinyint unsigned DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `timeline_results` ADD `entry_round` tinyint unsigned DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `timeline_results` ADD `previous_membership_id` bigint unsigned;--> statement-breakpoint
ALTER TABLE `timeline_results` ADD `changed_fields` json;--> statement-breakpoint
ALTER TABLE `timeline_results` ADD CONSTRAINT `uq_timeline_results_timeline_code_round` UNIQUE(`timeline_id`,`result_code`,`entry_round`);--> statement-breakpoint
ALTER TABLE `timeline_results` DROP INDEX `uq_timeline_results_timeline_code`;--> statement-breakpoint
ALTER TABLE `timeline_loads` ADD CONSTRAINT `chk_timeline_loads_round` CHECK (`round` IN (1, 2));--> statement-breakpoint
ALTER TABLE `timeline_loads` ADD CONSTRAINT `chk_timeline_loads_step_position` CHECK (`step_position` BETWEEN 1 AND 5);--> statement-breakpoint
ALTER TABLE `timeline_results` ADD CONSTRAINT `chk_timeline_results_entry_round` CHECK (`entry_round` IN (1, 2));--> statement-breakpoint
ALTER TABLE `timeline_results` ADD CONSTRAINT `chk_timeline_results_changed_fields` CHECK (`changed_fields` IS NULL OR JSON_LENGTH(`changed_fields`) <= 96);--> statement-breakpoint
ALTER TABLE `timeline_results` ADD CONSTRAINT `timeline_results_previous_membership_id_timeline_results_id_fk` FOREIGN KEY (`previous_membership_id`) REFERENCES `timeline_results`(`id`) ON DELETE no action ON UPDATE no action;