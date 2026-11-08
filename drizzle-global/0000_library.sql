CREATE TABLE `assets` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `category` text NOT NULL,
  `relative_path` text NOT NULL UNIQUE,
  `mime_type` text NOT NULL,
  `digest` text NOT NULL,
  UNIQUE (`category`, `digest`)
);
--> statement-breakpoint
CREATE TABLE `soundboard_entries` (
  `asset_id` text PRIMARY KEY NOT NULL REFERENCES `assets` (`id`) ON DELETE CASCADE,
  `group_name` text NOT NULL,
  `icon` text NOT NULL,
  `custom_icon_asset_id` text REFERENCES `assets` (`id`) ON DELETE SET NULL
);
