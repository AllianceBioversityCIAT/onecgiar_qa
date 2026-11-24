CREATE TABLE `timeline_loads` (
	`id` int unsigned AUTO_INCREMENT NOT NULL,
	`cycle_id` int unsigned NOT NULL,
	`timeline_id` int unsigned NOT NULL,
	`timeline_step_id` int unsigned NOT NULL,
	`phase_year` smallint unsigned NOT NULL,
	`scope` json NOT NULL,
	`status` enum('running','completed','failed') NOT NULL,
	`running_key` int unsigned GENERATED ALWAYS AS (IF(`status` = 'running', `cycle_id`, NULL)) STORED,
	`total` int unsigned,
	`processed` int unsigned NOT NULL DEFAULT 0,
	`summary` json,
	`failure_reason` varchar(64),
	`started_by` int unsigned NOT NULL,
	`started_at` datetime NOT NULL,
	`heartbeat_at` datetime NOT NULL,
	`finished_at` datetime,
	`request_id` varchar(64),
	CONSTRAINT `timeline_loads_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_timeline_loads_running_key` UNIQUE(`running_key`)
);
--> statement-breakpoint
CREATE TABLE `timeline_results` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`cycle_id` int unsigned NOT NULL,
	`timeline_id` int unsigned NOT NULL,
	`load_id` int unsigned NOT NULL,
	`result_code` int unsigned NOT NULL,
	`result_id` int unsigned NOT NULL,
	`phase_year` smallint unsigned NOT NULL,
	`program_clarisa_id` int unsigned NOT NULL,
	`result_type_key` varchar(64) NOT NULL,
	`status` enum('pending','auto_validated','not_in_qa') NOT NULL,
	`kp_group` enum('not_in_qa','auto_checked','review'),
	`awaits_step` tinyint unsigned,
	`snapshot_sk` varchar(160) NOT NULL,
	`snapshot_hash` char(64) NOT NULL,
	`catalog_version` varchar(32) NOT NULL,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`ended_at` datetime,
	`end_reason` enum('timeline_closed','released_qaed','released_not_qaed'),
	`active_key` varchar(32) GENERATED ALWAYS AS (IF(`ended_at` IS NULL, CONCAT(`cycle_id`, '#', `result_code`), NULL)) STORED,
	CONSTRAINT `timeline_results_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_timeline_results_timeline_code` UNIQUE(`timeline_id`,`result_code`),
	CONSTRAINT `uq_timeline_results_active_key` UNIQUE(`active_key`)
);
--> statement-breakpoint
ALTER TABLE `timeline_audit_events` MODIFY COLUMN `action` enum('update','load_start','load_end') NOT NULL;--> statement-breakpoint
ALTER TABLE `timeline_loads` ADD CONSTRAINT `timeline_loads_cycle_id_cycles_id_fk` FOREIGN KEY (`cycle_id`) REFERENCES `cycles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `timeline_loads` ADD CONSTRAINT `timeline_loads_timeline_id_timelines_id_fk` FOREIGN KEY (`timeline_id`) REFERENCES `timelines`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `timeline_loads` ADD CONSTRAINT `timeline_loads_timeline_step_id_timeline_steps_id_fk` FOREIGN KEY (`timeline_step_id`) REFERENCES `timeline_steps`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `timeline_loads` ADD CONSTRAINT `timeline_loads_started_by_users_id_fk` FOREIGN KEY (`started_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `timeline_results` ADD CONSTRAINT `timeline_results_cycle_id_cycles_id_fk` FOREIGN KEY (`cycle_id`) REFERENCES `cycles`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `timeline_results` ADD CONSTRAINT `timeline_results_timeline_id_timelines_id_fk` FOREIGN KEY (`timeline_id`) REFERENCES `timelines`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `timeline_results` ADD CONSTRAINT `timeline_results_load_id_timeline_loads_id_fk` FOREIGN KEY (`load_id`) REFERENCES `timeline_loads`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_timeline_loads_timeline_id` ON `timeline_loads` (`timeline_id`,`id`);--> statement-breakpoint
CREATE INDEX `idx_timeline_results_result_code` ON `timeline_results` (`result_code`);