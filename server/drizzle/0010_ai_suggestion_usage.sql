CREATE TABLE `ai_suggestion_usage` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`suggestion_id` char(32) NOT NULL,
	`timeline_result_id` bigint unsigned NOT NULL,
	`step_position` tinyint unsigned NOT NULL,
	`role_code` varchar(32) NOT NULL,
	`field_key` varchar(200) NOT NULL,
	`prompt_version` varchar(32) NOT NULL,
	`ai_signal` enum('green','amber','red') NOT NULL,
	`action` enum('shown','copied','comment_saved','validated_above_ai') NOT NULL,
	`dedupe_action` varchar(32) GENERATED ALWAYS AS (IF(`action` = 'comment_saved', NULL, `action`)) STORED,
	`comment_id` bigint unsigned,
	`edited` boolean,
	`ai_level` tinyint unsigned,
	`reported_level` tinyint unsigned,
	`validated_level` tinyint unsigned,
	`reason` varchar(200),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `ai_suggestion_usage_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_ai_usage_once` UNIQUE(`suggestion_id`,`timeline_result_id`,`step_position`,`dedupe_action`),
	CONSTRAINT `uq_ai_usage_comment` UNIQUE(`comment_id`),
	CONSTRAINT `chk_ai_usage_above` CHECK(`action` <> 'validated_above_ai' OR (`reason` IS NOT NULL AND `validated_level` >= `ai_level` + 2))
);
--> statement-breakpoint
ALTER TABLE `ai_suggestion_usage` ADD CONSTRAINT `fk_ai_usage_membership` FOREIGN KEY (`timeline_result_id`) REFERENCES `timeline_results`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ai_suggestion_usage` ADD CONSTRAINT `fk_ai_usage_comment` FOREIGN KEY (`comment_id`) REFERENCES `assessment_comments`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_ai_usage_suggestion` ON `ai_suggestion_usage` (`suggestion_id`,`action`);--> statement-breakpoint
CREATE INDEX `idx_ai_usage_field` ON `ai_suggestion_usage` (`field_key`,`prompt_version`,`action`);