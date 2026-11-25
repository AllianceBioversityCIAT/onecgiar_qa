CREATE TABLE `sp_link_codes` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`code_hash` char(64) NOT NULL,
	`email` varchar(320) NOT NULL,
	`name` varchar(200) NOT NULL,
	`program_id` int unsigned,
	`is_reporting_admin` boolean NOT NULL,
	`expires_at` datetime NOT NULL,
	`used_at` datetime,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `sp_link_codes_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_sp_link_codes_code_hash` UNIQUE(`code_hash`)
);
--> statement-breakpoint
CREATE TABLE `sp_sessions` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`token_hash` char(64) NOT NULL,
	`email` varchar(320) NOT NULL,
	`name` varchar(200) NOT NULL,
	`program_id` int unsigned,
	`is_reporting_admin` boolean NOT NULL,
	`created_at` datetime NOT NULL,
	`expires_at` datetime NOT NULL,
	CONSTRAINT `sp_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_sp_sessions_token_hash` UNIQUE(`token_hash`)
);
--> statement-breakpoint
CREATE TABLE `sp_comment_responses` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`comment_id` bigint unsigned NOT NULL,
	`kind` enum('accept','accept_with_comment','disagree','request_clarification') NOT NULL,
	`body` varchar(2000),
	`responder_name` varchar(200) NOT NULL,
	`responder_email` varchar(320) NOT NULL,
	`program_id` int unsigned NOT NULL,
	`created_at` datetime NOT NULL,
	CONSTRAINT `sp_comment_responses_id` PRIMARY KEY(`id`),
	CONSTRAINT `chk_sp_responses_body` CHECK((`kind` = 'accept' AND `body` IS NULL) OR (`kind` <> 'accept' AND `body` IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE `comment_clarification_answers` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`comment_id` bigint unsigned NOT NULL,
	`response_id` bigint unsigned NOT NULL,
	`author_id` int unsigned NOT NULL,
	`body` varchar(2000) NOT NULL,
	`created_at` datetime NOT NULL,
	CONSTRAINT `comment_clarification_answers_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_clarification_answers_response` UNIQUE(`response_id`)
);
--> statement-breakpoint
ALTER TABLE `comment_events` MODIFY COLUMN `actor_id` int unsigned;--> statement-breakpoint
ALTER TABLE `comment_events` ADD `sp_response_id` bigint unsigned;--> statement-breakpoint
ALTER TABLE `sp_comment_responses` ADD CONSTRAINT `fk_sp_responses_comment` FOREIGN KEY (`comment_id`) REFERENCES `assessment_comments`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `comment_clarification_answers` ADD CONSTRAINT `fk_clarification_answers_comment` FOREIGN KEY (`comment_id`) REFERENCES `assessment_comments`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `comment_clarification_answers` ADD CONSTRAINT `fk_clarification_answers_response` FOREIGN KEY (`response_id`) REFERENCES `sp_comment_responses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `comment_clarification_answers` ADD CONSTRAINT `fk_clarification_answers_author` FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_sp_link_codes_expires` ON `sp_link_codes` (`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_sp_sessions_expires` ON `sp_sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_sp_comment_responses_comment` ON `sp_comment_responses` (`comment_id`,`id`);--> statement-breakpoint
ALTER TABLE `comment_events` ADD CONSTRAINT `chk_comment_events_actor` CHECK (`actor_id` IS NOT NULL OR `sp_response_id` IS NOT NULL);--> statement-breakpoint
ALTER TABLE `comment_events` ADD CONSTRAINT `fk_comment_events_sp_response` FOREIGN KEY (`sp_response_id`) REFERENCES `sp_comment_responses`(`id`) ON DELETE no action ON UPDATE no action;