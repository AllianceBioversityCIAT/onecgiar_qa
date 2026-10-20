CREATE TABLE `idempotency_keys` (
	`actor_id` int unsigned NOT NULL,
	`idem_key` varchar(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	`fingerprint` char(64) NOT NULL,
	`state` enum('in_progress','executed','completed') NOT NULL,
	`owner_token` char(36) NOT NULL,
	`lease_until` datetime NOT NULL,
	`route_status` smallint NOT NULL,
	`target_user_id` int unsigned,
	`response_status` smallint,
	`response_body` json,
	`created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`expires_at` datetime NOT NULL,
	CONSTRAINT `idempotency_keys_actor_id_idem_key_pk` PRIMARY KEY(`actor_id`,`idem_key`)
);
--> statement-breakpoint
ALTER TABLE `idempotency_keys` ADD CONSTRAINT `idempotency_keys_actor_id_users_id_fk` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_idempotency_keys_expires` ON `idempotency_keys` (`expires_at`);