ALTER TABLE `result_assessments` ADD `finished_as_admin` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `assessment_comments` ADD `acted_as_admin` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `comment_decisions` ADD `acted_as_admin` boolean DEFAULT false NOT NULL;