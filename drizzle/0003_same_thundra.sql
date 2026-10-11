CREATE TABLE `soundboard_entries` (
	`asset_id` text PRIMARY KEY NOT NULL,
	`group_name` text NOT NULL,
	`icon` text NOT NULL,
	`custom_icon_asset_id` text,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`custom_icon_asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE set null
);
