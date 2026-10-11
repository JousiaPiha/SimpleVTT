CREATE TABLE `scene_drawings` (
	`position` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`scene_id` text NOT NULL,
	`properties` text NOT NULL,
	FOREIGN KEY (`scene_id`) REFERENCES `scenes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scene_drawings_id_unique` ON `scene_drawings` (`id`);