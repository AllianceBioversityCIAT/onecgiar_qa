CREATE TABLE `reporting_field_changes` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`timeline_result_id` bigint unsigned NOT NULL,
	`field_key` varchar(200) NOT NULL,
	`detected_at` datetime NOT NULL,
	CONSTRAINT `reporting_field_changes_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_reporting_field_changes_membership_field` UNIQUE(`timeline_result_id`,`field_key`)
);
--> statement-breakpoint
ALTER TABLE `reporting_field_changes` ADD CONSTRAINT `fk_reporting_field_changes_membership` FOREIGN KEY (`timeline_result_id`) REFERENCES `timeline_results`(`id`) ON DELETE no action ON UPDATE no action;