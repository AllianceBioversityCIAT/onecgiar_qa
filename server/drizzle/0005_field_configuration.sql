CREATE TABLE `field_config_drafts` (
	`cycle_id` int unsigned NOT NULL,
	`revision` int unsigned NOT NULL DEFAULT 0,
	`updated_at` datetime,
	`updated_by` int unsigned,
	CONSTRAINT `field_config_drafts_cycle_id` PRIMARY KEY(`cycle_id`),
	CONSTRAINT `chk_field_config_drafts_updated` CHECK((`updated_at` IS NULL AND `updated_by` IS NULL) OR (`updated_at` IS NOT NULL AND `updated_by` IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE `field_config_draft_items` (
	`cycle_id` int unsigned NOT NULL,
	`result_type_key` varchar(64) NOT NULL,
	`field_key` varchar(128) NOT NULL,
	`visibility` enum('hidden','view_only','assessed') NOT NULL,
	`is_core` boolean NOT NULL,
	`is_ai_input` boolean NOT NULL,
	CONSTRAINT `field_config_draft_items_pk` PRIMARY KEY(`cycle_id`,`result_type_key`,`field_key`),
	CONSTRAINT `chk_field_config_draft_items_flags` CHECK((`is_core` = 0 AND `is_ai_input` = 0) OR `visibility` = 'assessed')
);
--> statement-breakpoint
CREATE TABLE `field_config_versions` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`cycle_id` int unsigned NOT NULL,
	`number` smallint unsigned NOT NULL,
	`catalog_version` varchar(32) NOT NULL,
	`published_at` datetime NOT NULL,
	`published_by` int unsigned NOT NULL,
	`request_id` varchar(64),
	CONSTRAINT `field_config_versions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_field_config_versions_cycle_number` UNIQUE(`cycle_id`,`number`)
);
--> statement-breakpoint
CREATE TABLE `field_config_version_items` (
	`version_id` int unsigned NOT NULL,
	`result_type_key` varchar(64) NOT NULL,
	`field_key` varchar(128) NOT NULL,
	`visibility` enum('hidden','view_only','assessed') NOT NULL,
	`is_core` boolean NOT NULL,
	`is_ai_input` boolean NOT NULL,
	CONSTRAINT `field_config_version_items_pk` PRIMARY KEY(`version_id`,`result_type_key`,`field_key`),
	CONSTRAINT `chk_field_config_version_items_flags` CHECK((`is_core` = 0 AND `is_ai_input` = 0) OR `visibility` = 'assessed')
);
--> statement-breakpoint
CREATE TABLE `field_config_audit_events` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`cycle_id` int unsigned NOT NULL,
	`version_id` int unsigned NOT NULL,
	`actor_id` int unsigned NOT NULL,
	`action` enum('publish') NOT NULL,
	`changes` json NOT NULL,
	`timelines` json NOT NULL,
	`request_id` varchar(64),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `field_config_audit_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_field_config_audit_events_version` UNIQUE(`version_id`)
);
--> statement-breakpoint
ALTER TABLE `field_config_drafts` ADD CONSTRAINT `field_config_drafts_cycle_id_cycles_id_fk` FOREIGN KEY (`cycle_id`) REFERENCES `cycles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `field_config_drafts` ADD CONSTRAINT `field_config_drafts_updated_by_users_id_fk` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `field_config_draft_items` ADD CONSTRAINT `field_config_draft_items_cycle_id_cycles_id_fk` FOREIGN KEY (`cycle_id`) REFERENCES `cycles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `field_config_versions` ADD CONSTRAINT `field_config_versions_cycle_id_cycles_id_fk` FOREIGN KEY (`cycle_id`) REFERENCES `cycles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `field_config_versions` ADD CONSTRAINT `field_config_versions_published_by_users_id_fk` FOREIGN KEY (`published_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `field_config_version_items` ADD CONSTRAINT `field_config_version_items_version_fk` FOREIGN KEY (`version_id`) REFERENCES `field_config_versions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `field_config_audit_events` ADD CONSTRAINT `field_config_audit_events_cycle_id_cycles_id_fk` FOREIGN KEY (`cycle_id`) REFERENCES `cycles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `field_config_audit_events` ADD CONSTRAINT `field_config_audit_events_version_id_field_config_versions_id_fk` FOREIGN KEY (`version_id`) REFERENCES `field_config_versions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `field_config_audit_events` ADD CONSTRAINT `field_config_audit_events_actor_id_users_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_field_config_versions_cycle_published` ON `field_config_versions` (`cycle_id`,`published_at`);--> statement-breakpoint
CREATE INDEX `idx_field_config_audit_events_cycle_created` ON `field_config_audit_events` (`cycle_id`,`created_at`);