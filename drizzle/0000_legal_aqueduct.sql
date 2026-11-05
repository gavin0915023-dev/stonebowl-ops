CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`is_demo` integer NOT NULL,
	`channel` text NOT NULL,
	`external_id` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`amount_cents` integer NOT NULL,
	`document` text NOT NULL,
	CONSTRAINT "orders_valid_demo" CHECK("orders"."is_demo" IN (0, 1)),
	CONSTRAINT "orders_valid_channel" CHECK("orders"."channel" IN ('demo', 'manual', 'meituan-import')),
	CONSTRAINT "orders_demo_channel_isolated" CHECK("orders"."channel" != 'demo' OR "orders"."is_demo" = 1),
	CONSTRAINT "orders_valid_status" CHECK("orders"."status" IN ('new', 'preparing', 'ready', 'handed_over', 'cancelled')),
	CONSTRAINT "orders_positive_version" CHECK("orders"."version" >= 1),
	CONSTRAINT "orders_nonnegative_amount" CHECK("orders"."amount_cents" >= 0 AND "orders"."amount_cents" <= 100000000 AND typeof("orders"."amount_cents") = 'integer'),
	CONSTRAINT "orders_valid_document" CHECK(json_valid("orders"."document"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_owner_source_external_unique` ON `orders` (`owner_id`,`is_demo`,`channel`,`external_id`);--> statement-breakpoint
CREATE INDEX `orders_owner_day_index` ON `orders` (`owner_id`,`is_demo`,`created_at`);--> statement-breakpoint
CREATE TABLE `store_settings` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`store_name` text NOT NULL,
	`prep_minutes` integer DEFAULT 15 NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "settings_valid_prep_minutes" CHECK("store_settings"."prep_minutes" BETWEEN 3 AND 120),
	CONSTRAINT "settings_valid_store_name" CHECK(length("store_settings"."store_name") BETWEEN 1 AND 60)
);
