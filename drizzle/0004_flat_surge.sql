ALTER TABLE `scenes` ADD `grid_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `scenes` ADD `grid_size` integer DEFAULT 80 NOT NULL;--> statement-breakpoint
ALTER TABLE `scenes` ADD `grid_color` text DEFAULT '#ffffff' NOT NULL;