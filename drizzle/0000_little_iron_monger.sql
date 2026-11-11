CREATE TABLE `workspace_heads` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`metadata` text NOT NULL,
	`last_command_id` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workspace_objects` (
	`owner_id` text NOT NULL,
	`kind` text NOT NULL,
	`object_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`payload` text NOT NULL,
	PRIMARY KEY(`owner_id`, `kind`, `object_id`)
);
