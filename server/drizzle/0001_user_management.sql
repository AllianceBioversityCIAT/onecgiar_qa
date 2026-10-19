CREATE TABLE `user_programs` (
	`user_id` int unsigned NOT NULL,
	`program_id` int unsigned NOT NULL,
	CONSTRAINT `user_programs_user_id_program_id_pk` PRIMARY KEY(`user_id`,`program_id`)
);
--> statement-breakpoint
CREATE TABLE `user_program_exclusions` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`user_id` int unsigned NOT NULL,
	`program_id` int unsigned NOT NULL,
	`origin` enum('manual','reporting') NOT NULL,
	`status` enum('active','removed','dismissed') NOT NULL DEFAULT 'active',
	`reason` varchar(500),
	`reporting_role` varchar(100),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`created_by` int unsigned,
	`ended_at` datetime,
	`ended_by` int unsigned,
	`end_reason` varchar(500),
	`active_key` varchar(64) GENERATED ALWAYS AS (IF(`status` = 'active', CONCAT_WS(':', `user_id`, `program_id`), NULL)) STORED,
	CONSTRAINT `user_program_exclusions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_user_program_exclusions_active_key` UNIQUE(`active_key`),
	CONSTRAINT `chk_user_program_exclusions_manual_reason` CHECK(`origin` <> 'manual' OR (`reason` IS NOT NULL AND TRIM(`reason`) <> '')),
	CONSTRAINT `chk_user_program_exclusions_dismissed` CHECK(`status` <> 'dismissed' OR (`origin` = 'reporting' AND `end_reason` IS NOT NULL AND TRIM(`end_reason`) <> '')),
	CONSTRAINT `chk_user_program_exclusions_ended` CHECK((`status` = 'active' AND `ended_at` IS NULL AND `ended_by` IS NULL AND `end_reason` IS NULL) OR (`status` <> 'active' AND `ended_at` IS NOT NULL AND `ended_by` IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE `user_audit_events` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`user_id` int unsigned NOT NULL,
	`actor_id` int unsigned NOT NULL,
	`action` enum('create','update','role_grant','role_revoke','scope_change','exclusion_add','exclusion_remove','exclusion_dismiss','deactivate','reactivate','invitation_resend') NOT NULL,
	`changes` json NOT NULL,
	`request_id` varchar(64),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `user_audit_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `nickname` varchar(50);--> statement-breakpoint
ALTER TABLE `users` ADD `invitation` enum('none','sent','existing_account') DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `invited_at` datetime;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `uq_users_nickname` UNIQUE(`nickname`);--> statement-breakpoint
ALTER TABLE `user_programs` ADD CONSTRAINT `user_programs_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_program_exclusions` ADD CONSTRAINT `user_program_exclusions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_program_exclusions` ADD CONSTRAINT `user_program_exclusions_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_program_exclusions` ADD CONSTRAINT `user_program_exclusions_ended_by_users_id_fk` FOREIGN KEY (`ended_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_audit_events` ADD CONSTRAINT `user_audit_events_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_audit_events` ADD CONSTRAINT `user_audit_events_actor_id_users_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_user_audit_events_user_created` ON `user_audit_events` (`user_id`,`created_at`);