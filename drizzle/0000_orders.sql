CREATE TABLE qadam_orders (id TEXT PRIMARY KEY NOT NULL, owner TEXT NOT NULL, data TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0);
--> statement-breakpoint
CREATE TABLE qadam_telegram_contacts (chat_id TEXT PRIMARY KEY NOT NULL, username TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE qadam_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
--> statement-breakpoint
CREATE INDEX qadam_orders_owner ON qadam_orders(owner);
