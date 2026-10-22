CREATE TABLE `timeline_audit_events` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`timeline_id` int unsigned NOT NULL,
	`actor_id` int unsigned NOT NULL,
	`action` enum('update') NOT NULL,
	`changes` json NOT NULL,
	`request_id` varchar(64),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `timeline_audit_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `timelines` ADD `version` int unsigned DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `timelines` ADD `updated_at` datetime;--> statement-breakpoint
ALTER TABLE `timelines` ADD `updated_by` int unsigned;--> statement-breakpoint
ALTER TABLE `timeline_audit_events` ADD CONSTRAINT `timeline_audit_events_timeline_id_timelines_id_fk` FOREIGN KEY (`timeline_id`) REFERENCES `timelines`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `timeline_audit_events` ADD CONSTRAINT `timeline_audit_events_actor_id_users_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_timeline_audit_events_timeline_created` ON `timeline_audit_events` (`timeline_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `timelines` ADD CONSTRAINT `chk_timelines_updated` CHECK ((`updated_at` IS NULL AND `updated_by` IS NULL) OR (`updated_at` IS NOT NULL AND `updated_by` IS NOT NULL));--> statement-breakpoint
ALTER TABLE `timelines` ADD CONSTRAINT `timelines_updated_by_users_id_fk` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;