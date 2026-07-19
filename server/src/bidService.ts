import { db, bids } from "./db";

export interface UpsertBidInput {
  lat: number;
  lng: number;
  bidder: string;
  amountWei: string;
  updatedAt?: number;
}

export const upsertBid = async (input: UpsertBidInput) => {
  const now = input.updatedAt ?? Math.floor(Date.now() / 1000);
  await db
    .insert(bids)
    .values({
      lat: input.lat,
      lng: input.lng,
      bidder: input.bidder,
      amountWei: input.amountWei,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [bids.lat, bids.lng],
      set: { bidder: input.bidder, amountWei: input.amountWei, updatedAt: now },
    });
};

export const upsertBidsTransactional = async (inputs: UpsertBidInput[]) => {
  const now = Math.floor(Date.now() / 1000);
  db.transaction((tx) => {
    for (const input of inputs) {
      tx.insert(bids)
        .values({
          lat: input.lat,
          lng: input.lng,
          bidder: input.bidder,
          amountWei: input.amountWei,
          updatedAt: input.updatedAt ?? now,
        })
        .onConflictDoUpdate({
          target: [bids.lat, bids.lng],
          set: {
            bidder: input.bidder,
            amountWei: input.amountWei,
            updatedAt: input.updatedAt ?? now,
          },
        });
    }
  });
};
