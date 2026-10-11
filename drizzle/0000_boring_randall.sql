CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`relative_path` text NOT NULL,
	`mime_type` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assets_relative_path_unique` ON `assets` (`relative_path`);--> statement-breakpoint
CREATE TABLE `scene_objects` (
	`id` text PRIMARY KEY NOT NULL,
	`scene_id` text NOT NULL,
	`asset_id` text NOT NULL,
	`name` text NOT NULL,
	`x` real NOT NULL,
	`y` real NOT NULL,
	`scale` real NOT NULL,
	`rotation` real NOT NULL,
	`z_index` integer NOT NULL,
	`visible` integer NOT NULL,
	`width` real NOT NULL,
	`height` real NOT NULL,
	FOREIGN KEY (`scene_id`) REFERENCES `scenes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `presentation` (
	`id` integer PRIMARY KEY NOT NULL,
	`scene_id` text,
	FOREIGN KEY (`scene_id`) REFERENCES `scenes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `scenes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`background_asset_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`background_asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE set null
);
