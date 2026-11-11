CREATE TABLE `operation_claims` (
	`owner_id` text NOT NULL,
	`resource_id` text NOT NULL,
	`command_key` text NOT NULL,
	`fingerprint` text NOT NULL,
	`claim_token` text NOT NULL,
	`status` text NOT NULL,
	`base_revision` integer NOT NULL,
	`lease_until` integer NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	PRIMARY KEY(`owner_id`, `resource_id`)
);
