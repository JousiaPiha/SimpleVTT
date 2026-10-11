CREATE TABLE `audio_preferences` (
	`id` integer PRIMARY KEY NOT NULL,
	`settings` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `playlist_tracks` (
	`playlist_id` text NOT NULL,
	`position` integer NOT NULL,
	`asset_id` text NOT NULL,
	PRIMARY KEY(`playlist_id`, `position`),
	FOREIGN KEY (`playlist_id`) REFERENCES `playlists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `playlists` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
