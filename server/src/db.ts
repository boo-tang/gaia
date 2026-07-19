import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";

export const bids = sqliteTable(
  "bids",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    lat: integer("lat").notNull(),
    lng: integer("lng").notNull(),
    bidder: text("bidder").notNull(),
    amountWei: text("amountWei").notNull(),
    updatedAt: integer("updatedAt").notNull(),
  },
  (t) => ({
    uq: unique().on(t.lat, t.lng),
  })
);

export type BidRow = typeof bids.$inferSelect;

const sqlite = new Database("gaia-auction.db");
export const db = drizzle(sqlite);
