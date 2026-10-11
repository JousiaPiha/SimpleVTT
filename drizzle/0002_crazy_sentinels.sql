CREATE TABLE `scene_content` (
	`id` text PRIMARY KEY NOT NULL,
	`scene_id` text NOT NULL,
	`properties` text NOT NULL,
	FOREIGN KEY (`scene_id`) REFERENCES `scenes`(`id`) ON UPDATE no action ON DELETE cascade
);
