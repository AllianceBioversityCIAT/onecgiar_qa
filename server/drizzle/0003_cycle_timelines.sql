CREATE TABLE `cycles` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`year` smallint unsigned NOT NULL,
	`status` enum('draft','active','closed') NOT NULL DEFAULT 'draft',
	`active_key` tinyint GENERATED ALWAYS AS (IF(`status` = 'active', 1, NULL)) STORED,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`created_by` int unsigned NOT NULL,
	`activated_at` datetime,
	`activated_by` int unsigned,
	`closed_at` datetime,
	`closed_by` int unsigned,
	CONSTRAINT `cycles_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_cycles_year` UNIQUE(`year`),
	CONSTRAINT `uq_cycles_active_key` UNIQUE(`active_key`),
	CONSTRAINT `chk_cycles_year` CHECK(`year` BETWEEN 2020 AND 2100),
	CONSTRAINT `chk_cycles_lifecycle` CHECK((`status` = 'draft' AND `activated_at` IS NULL AND `activated_by` IS NULL AND `closed_at` IS NULL AND `closed_by` IS NULL) OR (`status` = 'active' AND `activated_at` IS NOT NULL AND `activated_by` IS NOT NULL AND `closed_at` IS NULL AND `closed_by` IS NULL) OR (`status` = 'closed' AND `closed_at` IS NOT NULL AND `closed_by` IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE `timelines` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`cycle_id` int unsigned NOT NULL,
	`name` varchar(120) COLLATE utf8mb4_0900_ai_ci NOT NULL,
	`kind` enum('official','additional') NOT NULL,
	`official_key` int unsigned GENERATED ALWAYS AS (IF(`kind` = 'official', `cycle_id`, NULL)) STORED,
	`all_programs` boolean NOT NULL,
	`all_result_types` boolean NOT NULL,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`created_by` int unsigned NOT NULL,
	CONSTRAINT `timelines_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_timelines_cycle_name` UNIQUE(`cycle_id`,`name`),
	CONSTRAINT `uq_timelines_official_key` UNIQUE(`official_key`)
);
--> statement-breakpoint
CREATE TABLE `timeline_programs` (
	`timeline_id` int unsigned NOT NULL,
	`program_id` int unsigned NOT NULL,
	CONSTRAINT `timeline_programs_timeline_id_program_id_pk` PRIMARY KEY(`timeline_id`,`program_id`)
);
--> statement-breakpoint
CREATE TABLE `timeline_result_types` (
	`timeline_id` int unsigned NOT NULL,
	`result_type_key` varchar(64) NOT NULL,
	CONSTRAINT `timeline_result_types_timeline_id_result_type_key_pk` PRIMARY KEY(`timeline_id`,`result_type_key`)
);
--> statement-breakpoint
CREATE TABLE `timeline_steps` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`timeline_id` int unsigned NOT NULL,
	`position` tinyint unsigned NOT NULL,
	`name` varchar(120) NOT NULL,
	`audience` enum('assessors','programs','lead_assessors','tpb','ppu') NOT NULL,
	`opens_on` date NOT NULL,
	`closes_on` date NOT NULL,
	`round` tinyint unsigned NOT NULL,
	`requires_load` boolean NOT NULL,
	CONSTRAINT `timeline_steps_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_timeline_steps_position` UNIQUE(`timeline_id`,`position`),
	CONSTRAINT `uq_timeline_steps_audience` UNIQUE(`timeline_id`,`audience`),
	CONSTRAINT `chk_timeline_steps_position` CHECK(`position` BETWEEN 1 AND 5),
	CONSTRAINT `chk_timeline_steps_dates` CHECK(`closes_on` >= `opens_on`),
	CONSTRAINT `chk_timeline_steps_round` CHECK(`round` >= 1),
	CONSTRAINT `chk_timeline_steps_first_load` CHECK(`position` <> 1 OR `requires_load`)
);
--> statement-breakpoint
CREATE TABLE `timeline_users` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`timeline_id` int unsigned NOT NULL,
	`user_id` int unsigned NOT NULL,
	`role_id` smallint unsigned NOT NULL,
	`assigned_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`assigned_by` int unsigned NOT NULL,
	`removed_at` datetime,
	`removed_by` int unsigned,
	`active_key` varchar(64) GENERATED ALWAYS AS (IF(`removed_at` IS NULL, CONCAT_WS(':', `timeline_id`, `user_id`, `role_id`), NULL)) STORED,
	CONSTRAINT `timeline_users_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_timeline_users_active_key` UNIQUE(`active_key`),
	CONSTRAINT `chk_timeline_users_removed` CHECK((`removed_at` IS NULL AND `removed_by` IS NULL) OR (`removed_at` IS NOT NULL AND `removed_by` IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE `cycles` ADD CONSTRAINT `cycles_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `cycles` ADD CONSTRAINT `cycles_activated_by_users_id_fk` FOREIGN KEY (`activated_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `cycles` ADD CONSTRAINT `cycles_closed_by_users_id_fk` FOREIGN KEY (`closed_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `timelines` ADD CONSTRAINT `timelines_cycle_id_cycles_id_fk` FOREIGN KEY (`cycle_id`) REFERENCES `cycles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `timelines` ADD CONSTRAINT `timelines_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `timeline_programs` ADD CONSTRAINT `timeline_programs_timeline_id_timelines_id_fk` FOREIGN KEY (`timeline_id`) REFERENCES `timelines`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `timeline_result_types` ADD CONSTRAINT `timeline_result_types_timeline_id_timelines_id_fk` FOREIGN KEY (`timeline_id`) REFERENCES `timelines`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `timeline_steps` ADD CONSTRAINT `timeline_steps_timeline_id_timelines_id_fk` FOREIGN KEY (`timeline_id`) REFERENCES `timelines`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `timeline_users` ADD CONSTRAINT `timeline_users_timeline_id_timelines_id_fk` FOREIGN KEY (`timeline_id`) REFERENCES `timelines`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `timeline_users` ADD CONSTRAINT `timeline_users_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `timeline_users` ADD CONSTRAINT `timeline_users_role_id_roles_id_fk` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `timeline_users` ADD CONSTRAINT `timeline_users_assigned_by_users_id_fk` FOREIGN KEY (`assigned_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `timeline_users` ADD CONSTRAINT `timeline_users_removed_by_users_id_fk` FOREIGN KEY (`removed_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_timelines_cycle` ON `timelines` (`cycle_id`);--> statement-breakpoint
CREATE INDEX `idx_timeline_users_timeline` ON `timeline_users` (`timeline_id`);