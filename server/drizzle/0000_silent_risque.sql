CREATE TABLE `users` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`cognito_sub` varchar(64),
	`cognito_username` varchar(128),
	`email` varchar(255) NOT NULL,
	`first_name` varchar(100),
	`last_name` varchar(100),
	`auth_source` enum('sso','custom') NOT NULL DEFAULT 'sso',
	`is_active` boolean NOT NULL DEFAULT true,
	`last_login_at` datetime,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`created_by` int unsigned,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_users_cognito_sub` UNIQUE(`cognito_sub`),
	CONSTRAINT `uq_users_email` UNIQUE(`email`),
	CONSTRAINT `chk_users_email_lowercase` CHECK(CAST(`email` AS BINARY) = CAST(LOWER(`email`) AS BINARY))
);
--> statement-breakpoint
CREATE TABLE `roles` (
	`id` smallint unsigned AUTO_INCREMENT NOT NULL,
	`code` varchar(32) NOT NULL,
	`name` varchar(100) NOT NULL,
	`scope_type` enum('global','result_type','program') NOT NULL,
	`is_active` boolean NOT NULL DEFAULT true,
	CONSTRAINT `roles_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_roles_code` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `role_assignments` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`user_id` int unsigned NOT NULL,
	`role_id` smallint unsigned NOT NULL,
	`result_type_key` varchar(64),
	`program_id` int unsigned,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`created_by` int unsigned,
	`revoked_at` datetime,
	`revoked_by` int unsigned,
	`active_key` varchar(128) GENERATED ALWAYS AS (IF(`is_active`, CONCAT_WS(':', `user_id`, `role_id`, COALESCE(`result_type_key`, ''), COALESCE(`program_id`, '')), NULL)) STORED,
	CONSTRAINT `role_assignments_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_role_assignments_active_key` UNIQUE(`active_key`),
	CONSTRAINT `chk_role_assignments_one_scope` CHECK(`result_type_key` IS NULL OR `program_id` IS NULL),
	CONSTRAINT `chk_role_assignments_revocation` CHECK((`is_active` = 1 AND `revoked_at` IS NULL AND `revoked_by` IS NULL) OR (`is_active` = 0 AND `revoked_at` IS NOT NULL AND `revoked_by` IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `role_assignments` ADD CONSTRAINT `role_assignments_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `role_assignments` ADD CONSTRAINT `role_assignments_role_id_roles_id_fk` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `role_assignments` ADD CONSTRAINT `role_assignments_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `role_assignments` ADD CONSTRAINT `role_assignments_revoked_by_users_id_fk` FOREIGN KEY (`revoked_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_role_assignments_user_active` ON `role_assignments` (`user_id`,`is_active`);