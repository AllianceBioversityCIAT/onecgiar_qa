CREATE TABLE `result_assessments` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`timeline_result_id` bigint unsigned NOT NULL,
	`step_position` tinyint unsigned NOT NULL,
	`role_code` varchar(32) NOT NULL,
	`status` enum('pending','quality_assessed','returned') NOT NULL DEFAULT 'pending',
	`field_config_version` int unsigned NOT NULL,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`created_by` int unsigned NOT NULL,
	`finished_at` datetime,
	`finished_by` int unsigned,
	CONSTRAINT `result_assessments_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_result_assessments_membership_step` UNIQUE(`timeline_result_id`,`step_position`),
	CONSTRAINT `chk_result_assessments_finished` CHECK((`status` = 'pending' AND `finished_at` IS NULL AND `finished_by` IS NULL) OR (`status` <> 'pending' AND `finished_at` IS NOT NULL AND `finished_by` IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE `assessment_field_validations` (
	`assessment_id` bigint unsigned NOT NULL,
	`field_key` varchar(200) NOT NULL,
	`validated` boolean NOT NULL,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_by` int unsigned NOT NULL,
	CONSTRAINT `pk_assessment_field_validations` PRIMARY KEY(`assessment_id`,`field_key`)
);
--> statement-breakpoint
CREATE TABLE `assessment_comments` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`assessment_id` bigint unsigned NOT NULL,
	`field_key` varchar(200) NOT NULL,
	`author_id` int unsigned NOT NULL,
	`step_position` tinyint unsigned NOT NULL,
	`round` tinyint unsigned NOT NULL,
	`body` varchar(2000) NOT NULL,
	`value_copy` json NOT NULL,
	`value_truncated` boolean NOT NULL DEFAULT false,
	`state` enum('open','withdrawn','clarification_requested','accepted','accepted_with_comment','disagreed','escalated','tpb_sided_program','tpb_sided_assessor','done') NOT NULL DEFAULT 'open',
	`visible_to_program_at` datetime,
	`withdrawn_at` datetime,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `assessment_comments_id` PRIMARY KEY(`id`),
	CONSTRAINT `chk_comment_withdrawn` CHECK((`withdrawn_at` IS NULL AND `state` <> 'withdrawn') OR (`withdrawn_at` IS NOT NULL AND `state` = 'withdrawn')),
	CONSTRAINT `chk_value_copy_size` CHECK(LENGTH(`value_copy`) <= 65536)
);
--> statement-breakpoint
CREATE TABLE `comment_events` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`comment_id` bigint unsigned NOT NULL,
	`actor_id` int unsigned NOT NULL,
	`actor_role` varchar(32) NOT NULL,
	`from_state` enum('open','withdrawn','clarification_requested','accepted','accepted_with_comment','disagreed','escalated','tpb_sided_program','tpb_sided_assessor','done'),
	`to_state` enum('open','withdrawn','clarification_requested','accepted','accepted_with_comment','disagreed','escalated','tpb_sided_program','tpb_sided_assessor','done') NOT NULL,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `comment_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `quick_comments` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`role_code` varchar(32) NOT NULL,
	`body` varchar(2000) NOT NULL,
	`body_hash` char(64) NOT NULL,
	`created_by` int unsigned NOT NULL,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `quick_comments_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_quick_comments_role_hash` UNIQUE(`role_code`,`body_hash`)
);
--> statement-breakpoint
CREATE TABLE `assessment_audit_events` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`assessment_id` bigint unsigned,
	`actor_id` int unsigned NOT NULL,
	`action` enum('validate','unvalidate','check_all','uncheck_all','comment_add','comment_withdraw','quick_comment_save','end_quality_assessed','end_returned','release_sent','release_refused') NOT NULL,
	`field_keys` json,
	`comment_id` bigint unsigned,
	`request_id` varchar(64),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `assessment_audit_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `assessment_releases` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`assessment_id` bigint unsigned NOT NULL,
	`timeline_result_id` bigint unsigned NOT NULL,
	`result_id` int unsigned NOT NULL,
	`phase_year` smallint unsigned NOT NULL,
	`outcome` enum('qaed','not_qaed') NOT NULL,
	`status` enum('pending','sent','refused') NOT NULL DEFAULT 'pending',
	`attempts` tinyint unsigned NOT NULL DEFAULT 0,
	`lease_until` datetime,
	`reason` varchar(32),
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`sent_at` datetime,
	CONSTRAINT `assessment_releases_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_assessment_releases_assessment` UNIQUE(`assessment_id`)
);
--> statement-breakpoint
ALTER TABLE `timeline_results` ADD `title` varchar(1000) COLLATE utf8mb4_0900_ai_ci;--> statement-breakpoint
ALTER TABLE `result_assessments` ADD CONSTRAINT `result_assessments_timeline_result_id_timeline_results_id_fk` FOREIGN KEY (`timeline_result_id`) REFERENCES `timeline_results`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `result_assessments` ADD CONSTRAINT `result_assessments_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `result_assessments` ADD CONSTRAINT `result_assessments_finished_by_users_id_fk` FOREIGN KEY (`finished_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `assessment_field_validations` ADD CONSTRAINT `assessment_field_validations_updated_by_users_id_fk` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `assessment_field_validations` ADD CONSTRAINT `fk_assessment_field_validations_assessment` FOREIGN KEY (`assessment_id`) REFERENCES `result_assessments`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `assessment_comments` ADD CONSTRAINT `assessment_comments_assessment_id_result_assessments_id_fk` FOREIGN KEY (`assessment_id`) REFERENCES `result_assessments`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `assessment_comments` ADD CONSTRAINT `assessment_comments_author_id_users_id_fk` FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `comment_events` ADD CONSTRAINT `comment_events_comment_id_assessment_comments_id_fk` FOREIGN KEY (`comment_id`) REFERENCES `assessment_comments`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `comment_events` ADD CONSTRAINT `comment_events_actor_id_users_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `quick_comments` ADD CONSTRAINT `quick_comments_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `assessment_audit_events` ADD CONSTRAINT `assessment_audit_events_assessment_id_result_assessments_id_fk` FOREIGN KEY (`assessment_id`) REFERENCES `result_assessments`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `assessment_audit_events` ADD CONSTRAINT `assessment_audit_events_actor_id_users_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `assessment_releases` ADD CONSTRAINT `assessment_releases_assessment_id_result_assessments_id_fk` FOREIGN KEY (`assessment_id`) REFERENCES `result_assessments`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_assessment_comments_assessment_field` ON `assessment_comments` (`assessment_id`,`field_key`);