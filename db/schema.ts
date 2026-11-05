import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const orders = sqliteTable("orders", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  isDemo: integer("is_demo", { mode: "boolean" }).notNull(),
  channel: text("channel").notNull(),
  externalId: text("external_id").notNull(),
  status: text("status").notNull(),
  createdAt: integer("created_at").notNull(),
  version: integer("version").notNull().default(1),
  amountCents: integer("amount_cents").notNull(),
  document: text("document").notNull(),
}, (table) => [
  uniqueIndex("orders_owner_source_external_unique").on(table.ownerId, table.isDemo, table.channel, table.externalId),
  index("orders_owner_day_index").on(table.ownerId, table.isDemo, table.createdAt),
  check("orders_valid_demo", sql`${table.isDemo} IN (0, 1)`),
  check("orders_valid_channel", sql`${table.channel} IN ('demo', 'manual', 'meituan-import')`),
  check("orders_demo_channel_isolated", sql`${table.channel} != 'demo' OR ${table.isDemo} = 1`),
  check("orders_valid_status", sql`${table.status} IN ('new', 'preparing', 'ready', 'handed_over', 'cancelled')`),
  check("orders_positive_version", sql`${table.version} >= 1`),
  check("orders_nonnegative_amount", sql`${table.amountCents} >= 0 AND ${table.amountCents} <= 100000000 AND typeof(${table.amountCents}) = 'integer'`),
  check("orders_valid_document", sql`json_valid(${table.document})`),
]);

export const storeSettings = sqliteTable("store_settings", {
  ownerId: text("owner_id").primaryKey(),
  storeName: text("store_name").notNull(),
  prepMinutes: integer("prep_minutes").notNull().default(15),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  check("settings_valid_prep_minutes", sql`${table.prepMinutes} BETWEEN 3 AND 120`),
  check("settings_valid_store_name", sql`length(${table.storeName}) BETWEEN 1 AND 60`),
]);
