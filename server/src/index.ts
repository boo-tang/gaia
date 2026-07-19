import { eq, and } from "drizzle-orm";
import express from "express";
import { z } from "zod";

import { db, bids, BidRow } from "./db";
import { startAuctionIndexer } from "./indexer";
import { upsertBid, upsertBidsTransactional } from "./bidService";

const { PORT = "8080" } = process.env;

const app = express();
app.use(express.json());

// Get highest bids in a bounding box
app.get("/api/bids", async (req, res) => {
  const qs = z
    .object({
      minLat: z.coerce.number(),
      maxLat: z.coerce.number(),
      minLng: z.coerce.number(),
      maxLng: z.coerce.number(),
    })
    .safeParse(req.query);
  if (!qs.success) {
    return res.status(400).json({ error: "bad_query" });
  }
  const { minLat, maxLat, minLng, maxLng } = qs.data;
  const rows = await db
    .select()
    .from(bids)
    .where(
      and(sqlBetween("lat", minLat, maxLat), sqlBetween("lng", minLng, maxLng))
    );
  return res.json(rows);
});

// Upsert a bid (e.g., from an indexer or webhook)
app.post("/api/bid", async (req, res) => {
  const body = z
    .object({
      lat: z.number(),
      lng: z.number(),
      bidder: z.string(),
      amountWei: z.string(),
    })
    .safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ error: "bad_body" });
  }
  const { lat, lng, bidder, amountWei } = body.data;
  await upsertBid({ lat, lng, bidder, amountWei });
  return res.json({ ok: true });
});

// Upsert multiple bids in one request
app.post("/api/bids", async (req, res) => {
  const body = z
    .array(
      z.object({
        lat: z.number(),
        lng: z.number(),
        bidder: z.string(),
        amountWei: z.string(),
      })
    )
    .nonempty()
    .safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ error: "bad_body" });
  }

  await upsertBidsTransactional(body.data);
  return res.json({ ok: true, count: body.data.length });
});

// Helper for range where with drizzle + sqlite-core columns
function sqlBetween(column: keyof BidRow, min: number, max: number) {
  // drizzle sqlite-core lacks a direct between helper; we can inline raw or split into and(gte, lte).
  // Using split conditions for type-safety.
  const col = (bids as any)[column];
  return and(col.gte(min), col.lte(max));
}

const port = Number(PORT);
app.listen(port, () => {
  console.log(`Gaia auction server listening on :${port}`);
  startAuctionIndexer();
});
