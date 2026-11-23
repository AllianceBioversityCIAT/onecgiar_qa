CREATE TABLE `comment_decisions` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`comment_id` bigint unsigned NOT NULL,
	`assessment_id` bigint unsigned NOT NULL,
	`role_code` varchar(32) NOT NULL,
	`decision` enum('agree_program','escalate','tpb_agree_program','tpb_agree_assessor','ppu_done') NOT NULL,
	`body` varchar(2000),
	`decided_by` int unsigned NOT NULL,
	`decided_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `comment_decisions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_comment_decisions_comment_role` UNIQUE(`comment_id`,`role_code`),
	CONSTRAINT `chk_comment_decisions_body` CHECK(`body` IS NOT NULL OR `decision` = 'ppu_done')
);
--> statement-breakpoint
ALTER TABLE `result_assessments` MODIFY COLUMN `status` enum('pending','quality_assessed','returned','escalated') NOT NULL DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE `assessment_comments` MODIFY COLUMN `state` enum('open','withdrawn','clarification_requested','accepted','accepted_with_comment','disagreed','escalated','tpb_sided_program','tpb_sided_assessor','done','lead_sided_program') NOT NULL DEFAULT 'open';--> statement-breakpoint
ALTER TABLE `comment_events` MODIFY COLUMN `from_state` enum('open','withdrawn','clarification_requested','accepted','accepted_with_comment','disagreed','escalated','tpb_sided_program','tpb_sided_assessor','done','lead_sided_program');--> statement-breakpoint
ALTER TABLE `comment_events` MODIFY COLUMN `to_state` enum('open','withdrawn','clarification_requested','accepted','accepted_with_comment','disagreed','escalated','tpb_sided_program','tpb_sided_assessor','done','lead_sided_program') NOT NULL;--> statement-breakpoint
ALTER TABLE `assessment_audit_events` MODIFY COLUMN `action` enum('validate','unvalidate','check_all','uncheck_all','comment_add','comment_withdraw','quick_comment_save','end_quality_assessed','end_returned','release_sent','release_refused','decision_set','decision_clear','comment_delete','end_escalated') NOT NULL;--> statement-breakpoint
ALTER TABLE `assessment_comments` ADD `deleted_at` datetime;--> statement-breakpoint
ALTER TABLE `assessment_comments` ADD `deleted_by` int unsigned;--> statement-breakpoint
ALTER TABLE `comment_decisions` ADD CONSTRAINT `fk_comment_decisions_comment` FOREIGN KEY (`comment_id`) REFERENCES `assessment_comments`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `comment_decisions` ADD CONSTRAINT `fk_comment_decisions_assessment` FOREIGN KEY (`assessment_id`) REFERENCES `result_assessments`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `comment_decisions` ADD CONSTRAINT `fk_comment_decisions_decided_by` FOREIGN KEY (`decided_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `assessment_comments` ADD CONSTRAINT `chk_comment_deleted` CHECK ((`deleted_at` IS NULL AND `deleted_by` IS NULL) OR (`deleted_at` IS NOT NULL AND `deleted_by` IS NOT NULL));--> statement-breakpoint
ALTER TABLE `assessment_comments` ADD CONSTRAINT `fk_assessment_comments_deleted_by` FOREIGN KEY (`deleted_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;