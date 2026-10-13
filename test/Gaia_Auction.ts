import { expect } from "chai";
import { encodeFunctionData, getAddress } from "viem";

import { coverage, loadFixture, time, viem } from "./helpers/setup";
import { pack } from "./helpers/auction";
import { deployAccount, deployLand, executeAs, squareId } from "./helpers/land";

describe("GaiaAuction::_validateConvexShape via bidOnShape", function () {
  async function deployAll() {
    const [owner] = await viem.getWalletClients();

    const { countries } = await deployLand(owner.account.address);

    const now = await time.latest();
    const start = BigInt(now - 10);
    const end = BigInt(now + 3600);
    const minBid = 1000n;
    const auction = await viem.deployContract(
      "contracts/GaiaAuction.sol:GaiaAuction",
      [
        countries.address,
        owner.account.address, // treasury
        start,
        end,
        end, // maxEndTime
        0n, // extensionWindow
        minBid,
        0n, // minBidIncrementBps
        1n,    // minShapeSquares
        1000n, // maxShapeSquares
        10n,   // maxShapeAspectRatio
      ]
    );

    await countries.write.grantRole([
      await countries.read.ISSUER_ROLE(),
      auction.address,
    ]);
    await countries.write.addAuction([auction.address]);

    return { owner, countries, auction, minBid };
  }

  it("accepts a valid convex, contiguous shape across rows", async function () {
    const { auction, minBid } = await loadFixture(deployAll);
    const shape = [
      // lat 33: 69,70,71
      { lat: 33, lng: 69 },
      { lat: 33, lng: 70 },
      { lat: 33, lng: 71 },
      // lat 34: 68,69,70,71
      { lat: 34, lng: 68 },
      { lat: 34, lng: 69 },
      { lat: 34, lng: 70 },
      { lat: 34, lng: 71 },
      // lat 35: 69,70,71
      { lat: 35, lng: 69 },
      { lat: 35, lng: 70 },
      { lat: 35, lng: 71 },
    ];

    const total = minBid * BigInt(shape.length);
    await expect(auction.write.bidOnShape([pack(shape), 0n, false], { value: total })).to.be
      .fulfilled;
  });

  it("rejects gap between longitudes in the same row", async function () {
    const { auction } = await loadFixture(deployAll);
    const shape = [
      { lat: 33, lng: 69 },
      { lat: 33, lng: 71 }, // gap
    ];
    await expect(auction.write.bidOnShape([pack(shape), 0n, false])).to.be.rejectedWith("GapBetweenLongitudes");
  });

  it("rejects non-consecutive latitudes", async function () {
    const { auction } = await loadFixture(deployAll);
    const shape = [
      { lat: 33, lng: 69 },
      { lat: 33, lng: 70 },
      // skip 34
      { lat: 35, lng: 69 },
    ];
    await expect(auction.write.bidOnShape([pack(shape), 0n, false])).to.be.rejectedWith("NonConsecutiveLatitudes");
  });

  it("rejects unsorted latitudes (descending)", async function () {
    const { auction } = await loadFixture(deployAll);
    const shape = [
      { lat: 34, lng: 69 },
      { lat: 34, lng: 70 },
      { lat: 33, lng: 69 }, // goes backward
    ];
    await expect(auction.write.bidOnShape([pack(shape), 0n, false])).to.be.rejectedWith("Unsorted");
  });

  it("rejects when subsequent latitude has no overlapping longitudes with previous", async function () {
    const { auction } = await loadFixture(deployAll);
    const shape = [
      { lat: 33, lng: 69 },
      { lat: 33, lng: 70 },
      // next row shifted so it doesn't overlap [69,70]
      { lat: 34, lng: 72 },
      { lat: 34, lng: 73 },
    ];
    await expect(auction.write.bidOnShape([pack(shape), 0n, false])).to.be.rejectedWith("NoLatAdjacency");
  });

  it("rejects concave start (left boundary)", async function () {
    const { auction } = await loadFixture(deployAll);
    const shape = [
      // starts at 69, then 70 (flip), then 69 (violates convexity)
      { lat: 33, lng: 69 },
      { lat: 33, lng: 70 },
      { lat: 34, lng: 70 },
      { lat: 34, lng: 71 },
      { lat: 35, lng: 69 },
      { lat: 35, lng: 70 },
    ];
    await expect(auction.write.bidOnShape([pack(shape), 0n, false])).to.be.rejectedWith("NotConvexStart");
  });

  it("rejects concave end (right boundary)", async function () {
    const { auction } = await loadFixture(deployAll);
    const shape = [
      // end 71, then 70 (flip), then 71 (violates convexity on end)
      { lat: 33, lng: 69 },
      { lat: 33, lng: 70 },
      { lat: 33, lng: 71 },
      { lat: 34, lng: 69 },
      { lat: 34, lng: 70 },
      { lat: 35, lng: 69 },
      { lat: 35, lng: 70 },
      { lat: 35, lng: 71 },
    ];
    await expect(auction.write.bidOnShape([pack(shape), 0n, false])).to.be.rejectedWith("NotConvexEnd");
  });

  it("rejects empty shapes", async function () {
    const { auction } = await loadFixture(deployAll);
    await expect(auction.write.bidOnShape([pack([]), 0n, false])).to.be.rejectedWith("EmptyShape");
  });

  it("accepts a single cell", async function () {
    const { auction, minBid } = await loadFixture(deployAll);
    const shape = [{ lat: 40, lng: 10 }];
    const total = minBid * 1n;
    await expect(auction.write.bidOnShape([pack(shape), 0n, false], { value: total })).to.be
      .fulfilled;
  });

  it("accepts a single contiguous row", async function () {
    const { auction, minBid } = await loadFixture(deployAll);
    const shape = [
      { lat: 20, lng: 10 },
      { lat: 20, lng: 11 },
      { lat: 20, lng: 12 },
      { lat: 20, lng: 13 },
      { lat: 20, lng: 14 },
    ];
    const total = minBid * BigInt(shape.length);
    await expect(auction.write.bidOnShape([pack(shape), 0n, false], { value: total })).to.be
      .fulfilled;
  });

  it("accepts rows that overlap on a single edge cell", async function () {
    const { auction, minBid } = await loadFixture(deployAll);
    const shape = [
      // row 1: 10-12
      { lat: 10, lng: 10 },
      { lat: 10, lng: 11 },
      { lat: 10, lng: 12 },
      // row 2: 12-14 (overlap at 12)
      { lat: 11, lng: 12 },
      { lat: 11, lng: 13 },
      { lat: 11, lng: 14 },
      // row 3: 13-14 (overlap at 13)
      { lat: 12, lng: 13 },
      { lat: 12, lng: 14 },
    ];
    const total = minBid * BigInt(shape.length);
    await expect(auction.write.bidOnShape([pack(shape), 0n, false], { value: total })).to.be
      .fulfilled;
  });

  it("rejects duplicate coordinate in same row (not +1)", async function () {
    const { auction } = await loadFixture(deployAll);
    const shape = [
      { lat: 33, lng: 69 },
      { lat: 33, lng: 69 },
    ];
    await expect(auction.write.bidOnShape([pack(shape), 0n, false])).to.be.rejectedWith("GapBetweenLongitudes");
  });

  it("rejects decreasing longitude within a row", async function () {
    const { auction } = await loadFixture(deployAll);
    const shape = [
      { lat: 33, lng: 70 },
      { lat: 33, lng: 69 },
    ];
    await expect(auction.write.bidOnShape([pack(shape), 0n, false])).to.be.rejectedWith("GapBetweenLongitudes");
  });
});

describe("GaiaAuction: totals and refunds", function () {
  async function deployAll() {
    const [owner, other] = await viem.getWalletClients();

    const { countries } = await deployLand(owner.account.address);

    const now = await time.latest();
    const start = BigInt(now - 10);
    const end = BigInt(now + 3600);
    const minBid = 1000n;
    const auction = await viem.deployContract(
      "contracts/GaiaAuction.sol:GaiaAuction",
      [
        countries.address,
        owner.account.address, // treasury
        start,
        end,
        end, // maxEndTime
        0n, // extensionWindow
        minBid,
        0n, // minBidIncrementBps
        1n,    // minShapeSquares
        1000n, // maxShapeSquares
        10n,   // maxShapeAspectRatio
      ]
    );

    await countries.write.grantRole([
      await countries.read.ISSUER_ROLE(),
      auction.address,
    ]);
    await countries.write.addAuction([auction.address]);

    return { owner, other, countries, auction, minBid };
  }

  it("computes total as minBid per new square", async function () {
    const { auction, minBid } = await loadFixture(deployAll);
    const shape = [
      { lat: 10, lng: 10 },
      { lat: 10, lng: 11 },
      { lat: 10, lng: 12 },
    ];
    const total = minBid * 3n;
    await expect(auction.write.bidOnShape([pack(shape), 0n, false], { value: total })).to.be
      .fulfilled;

    // Verify highestBids amounts == minBid each
    const b0 = await auction.read.highestBids([10, 10]);
    const b1 = await auction.read.highestBids([10, 11]);
    const b2 = await auction.read.highestBids([10, 12]);
    expect(b0[1]).to.equal(minBid);
    expect(b1[1]).to.equal(minBid);
    expect(b2[1]).to.equal(minBid);
  });

  it("requires next step for overbids and credits refunds", async function () {
    const { auction, owner, other, minBid } = await loadFixture(deployAll);
    const shape = [
      { lat: 20, lng: 20 },
      { lat: 20, lng: 21 },
    ];
    // First bidder (owner)
    await auction.write.bidOnShape([pack(shape), 0n, false], { value: minBid * 2n });

    // Second bidder (other) must pay next step per square (minBid + minBid)
    const auctionAsOther = await viem.getContractAt(
      "contracts/GaiaAuction.sol:GaiaAuction",
      auction.address,
      { client: { wallet: other } }
    );
    const requiredNext = (minBid + minBid) * 2n;
    await expect(
      auctionAsOther.write.bidOnShape([pack(shape), 0n, false], { value: requiredNext })
    ).to.be.fulfilled;

    // pendingReturns for first bidder should equal their total prior contribution
    const refund = await auction.read.pendingReturns([owner.account.address]);
    expect(refund).to.equal(minBid * 2n);

    // Highest bids updated to 2*minBid per square
    const b0 = await auction.read.highestBids([20, 20]);
    const b1 = await auction.read.highestBids([20, 21]);
    expect(b0[1]).to.equal(minBid + minBid);
    expect(b1[1]).to.equal(minBid + minBid);
    expect(b0[0].toLowerCase()).to.equal(other.account.address.toLowerCase());
  });

  it("lets outbid bidders withdraw their pending returns", async function () {
    const { auction, owner, other, minBid } = await loadFixture(deployAll);
    const shape = [
      { lat: 21, lng: 20 },
      { lat: 21, lng: 21 },
    ];

    await auction.write.bidOnShape([pack(shape), 0n, false], { value: minBid * 2n });

    const auctionAsOther = await viem.getContractAt(
      "contracts/GaiaAuction.sol:GaiaAuction",
      auction.address,
      { client: { wallet: other } }
    );
    await auctionAsOther.write.bidOnShape([pack(shape), 0n, false], {
      value: (minBid + minBid) * 2n,
    });

    await expect(auction.write.withdraw()).to.be.fulfilled;

    const refund = await auction.read.pendingReturns([owner.account.address]);
    expect(refund).to.equal(0n);
  });

  it("mixes existing and new squares in one bid correctly", async function () {
    const { auction, minBid } = await loadFixture(deployAll);
    const first = [
      { lat: 30, lng: 30 },
      { lat: 30, lng: 31 },
    ];
    await auction.write.bidOnShape([pack(first), 0n, false], { value: minBid * 2n });

    // Second bid includes the two existing + one new
    const second = [
      { lat: 30, lng: 30 }, // existing → requires 2*minBid
      { lat: 30, lng: 31 }, // existing → requires 2*minBid
      { lat: 30, lng: 32 }, // new → requires minBid
    ];
    const expected = (minBid + minBid) * 2n + minBid; // 5 * minBid
    await expect(auction.write.bidOnShape([pack(second), 0n, false], { value: expected })).to.be
      .fulfilled;

    const b2 = await auction.read.highestBids([30, 32]);
    expect(b2[1]).to.equal(minBid);
  });

  it("refunds each previous bidder in full when the previous bidders alternate", async function () {
    const { auction, owner, other, minBid } = await loadFixture(deployAll);
    const [, , third] = await viem.getWalletClients();
    const as = async (wallet: typeof owner) =>
      viem.getContractAt("contracts/GaiaAuction.sol:GaiaAuction", auction.address, {
        client: { wallet },
      });
    const asOther = await as(other);
    const asThird = await as(third);
    const row = (lat: number) => [10, 11, 12].map((lng) => ({ lat, lng }));

    // Rows 50 and 52 belong to owner, row 51 to other.
    await auction.write.bidOnShape([pack(row(50)), 0n, false], { value: minBid * 3n });
    await asOther.write.bidOnShape([pack(row(51)), 0n, false], { value: minBid * 3n });
    await auction.write.bidOnShape([pack(row(52)), 0n, false], { value: minBid * 3n });

    // The west column: previous bidders owner, other, owner.
    const column = [50, 51, 52].map((lat) => ({ lat, lng: 10 }));
    await asThird.write.bidOnShape([pack(column), 0n, false], { value: minBid * 6n });

    expect(await auction.read.pendingReturns([owner.account.address])).to.equal(minBid * 2n);
    expect(await auction.read.pendingReturns([other.account.address])).to.equal(minBid);
    const active =
      (await auction.read.activeBids([owner.account.address])) +
      (await auction.read.activeBids([other.account.address])) +
      (await auction.read.activeBids([third.account.address]));
    expect(await auction.read.activeBids([owner.account.address])).to.equal(minBid * 4n);
    expect(await auction.read.activeBids([other.account.address])).to.equal(minBid * 2n);
    expect(active).to.equal(await auction.read.proceeds());
  });

  it("reverts when value is insufficient for the required total", async function () {
    const { auction, minBid } = await loadFixture(deployAll);
    const shape = [
      { lat: 40, lng: 40 },
      { lat: 40, lng: 41 },
      { lat: 40, lng: 42 },
    ];
    const total = minBid * 3n;
    await expect(auction.write.bidOnShape([pack(shape), 0n, false], { value: total - 1n })).to.be
      .rejectedWith("InsufficientValue");
  });
});

describe("GaiaAuction: shape size and aspect-ratio bounds", function () {
  async function deployBounded() {
    const [owner] = await viem.getWalletClients();

    const { countries } = await deployLand(owner.account.address);

    const now = await time.latest();
    const start = BigInt(now - 10);
    const end = BigInt(now + 3600);
    const minBid = 1000n;
    // minShapeSquares=2, maxShapeSquares=6, maxShapeAspectRatio=3
    const auction = await viem.deployContract(
      "contracts/GaiaAuction.sol:GaiaAuction",
      [
        countries.address,
        owner.account.address, // treasury
        start,
        end,
        end, // maxEndTime
        0n, // extensionWindow
        minBid,
        0n, // minBidIncrementBps
        2n, // minShapeSquares
        6n, // maxShapeSquares
        3n, // maxShapeAspectRatio
      ]
    );

    await countries.write.grantRole([
      await countries.read.ISSUER_ROLE(),
      auction.address,
    ]);
    await countries.write.addAuction([auction.address]);

    return { owner, countries, auction, minBid };
  }

  it("rejects a single-square bid when minShapeSquares=2", async function () {
    const { auction, minBid } = await loadFixture(deployBounded);
    const shape = [{ lat: 50, lng: 50 }];
    await expect(
      auction.write.bidOnShape([pack(shape), 0n, false], { value: minBid })
    ).to.be.rejectedWith("ShapeTooSmall");
  });

  it("rejects a bid exceeding maxShapeSquares", async function () {
    const { auction, minBid } = await loadFixture(deployBounded);
    // 7 squares in a row — maxShapeSquares is 6
    const shape = [
      { lat: 50, lng: 50 },
      { lat: 50, lng: 51 },
      { lat: 50, lng: 52 },
      { lat: 50, lng: 53 },
      { lat: 50, lng: 54 },
      { lat: 50, lng: 55 },
      { lat: 50, lng: 56 },
    ];
    const total = minBid * BigInt(shape.length);
    await expect(
      auction.write.bidOnShape([pack(shape), 0n, false], { value: total })
    ).to.be.rejectedWith("ShapeTooLarge");
  });

  it("accepts a bid exactly at maxShapeSquares", async function () {
    const { auction, minBid } = await loadFixture(deployBounded);
    // 2 rows × 3 cols = 6 squares — exactly at the limit, aspect ratio 3:2 which is within 3:1
    const shape = [
      { lat: 50, lng: 60 },
      { lat: 50, lng: 61 },
      { lat: 50, lng: 62 },
      { lat: 51, lng: 60 },
      { lat: 51, lng: 61 },
      { lat: 51, lng: 62 },
    ];
    const total = minBid * BigInt(shape.length);
    await expect(auction.write.bidOnShape([pack(shape), 0n, false], { value: total })).to.be
      .fulfilled;
  });

  it("rejects a 1-square-thick horizontal line exceeding aspect ratio 3:1", async function () {
    const { auction, minBid } = await loadFixture(deployBounded);
    // 1 row × 4 columns → width=4, height=1 → ratio=4 > maxAspectRatio=3
    const shape = [
      { lat: 60, lng: 10 },
      { lat: 60, lng: 11 },
      { lat: 60, lng: 12 },
      { lat: 60, lng: 13 },
    ];
    const total = minBid * BigInt(shape.length);
    await expect(
      auction.write.bidOnShape([pack(shape), 0n, false], { value: total })
    ).to.be.rejectedWith("AspectRatioExceeded");
  });

  it("rejects a 1-square-thick vertical line exceeding aspect ratio 3:1", async function () {
    const { auction, minBid } = await loadFixture(deployBounded);
    // 4 rows × 1 column → height=4, width=1 → ratio=4 > maxAspectRatio=3
    const shape = [
      { lat: 60, lng: 20 },
      { lat: 61, lng: 20 },
      { lat: 62, lng: 20 },
      { lat: 63, lng: 20 },
    ];
    const total = minBid * BigInt(shape.length);
    await expect(
      auction.write.bidOnShape([pack(shape), 0n, false], { value: total })
    ).to.be.rejectedWith("AspectRatioExceeded");
  });

  it("accepts a shape just within the aspect ratio", async function () {
    const { auction, minBid } = await loadFixture(deployBounded);
    // 2 rows × 6 columns → width=6, height=2 → ratio=3 == maxAspectRatio=3
    const shape = [
      { lat: 70, lng: 10 },
      { lat: 70, lng: 11 },
      { lat: 70, lng: 12 },
      { lat: 71, lng: 10 },
      { lat: 71, lng: 11 },
      { lat: 71, lng: 12 },
    ];
    const total = minBid * BigInt(shape.length);
    await expect(auction.write.bidOnShape([pack(shape), 0n, false], { value: total })).to.be
      .fulfilled;
  });
});

describe("GaiaAuction: anti-griefing overlap rules", function () {
  async function deployAntiGrief() {
    const [owner, bidder1, bidder2] = await viem.getWalletClients();

    const { countries } = await deployLand(owner.account.address);

    const now = await time.latest();
    const start = BigInt(now - 10);
    const end = BigInt(now + 3600);
    const minBid = 1000n;
    // minShapeSquares=2 so single-square remainders are invalid
    const auction = await viem.deployContract(
      "contracts/GaiaAuction.sol:GaiaAuction",
      [
        countries.address,
        owner.account.address, // treasury
        start,
        end,
        end, // maxEndTime
        0n, // extensionWindow
        minBid,
        0n, // minBidIncrementBps
        2n,    // minShapeSquares
        1000n, // maxShapeSquares
        10n,   // maxShapeAspectRatio
      ]
    );

    await countries.write.grantRole([
      await countries.read.ISSUER_ROLE(),
      auction.address,
    ]);
    await countries.write.addAuction([auction.address]);

    const auctionAs1 = await viem.getContractAt(
      "contracts/GaiaAuction.sol:GaiaAuction",
      auction.address,
      { client: { wallet: bidder1 } }
    );
    const auctionAs2 = await viem.getContractAt(
      "contracts/GaiaAuction.sol:GaiaAuction",
      auction.address,
      { client: { wallet: bidder2 } }
    );

    return { owner, bidder1, bidder2, auction, auctionAs1, auctionAs2, minBid };
  }

  // Alice holds a 1×3 row: (80,10), (80,11), (80,12)
  // Bob bids on (80,11) — the middle square — and (81,11), leaving Alice with
  // (80,10) and (80,12) which have a gap: invalid remainder.
  it("rejects a single-square bid that would leave a gap in an existing shape", async function () {
    const { auction, auctionAs2, minBid } = await loadFixture(deployAntiGrief);

    const aliceShape = [
      { lat: 80, lng: 10 },
      { lat: 80, lng: 11 },
      { lat: 80, lng: 12 },
    ];
    await auction.write.bidOnShape([pack(aliceShape), 0n, false], {
      value: minBid * BigInt(aliceShape.length),
    });

    // Two squares: a one-square bid fails on minShapeSquares before the remainder check.
    const bobShape = [
      { lat: 80, lng: 11 },
      { lat: 81, lng: 11 },
    ];
    await expect(
      auctionAs2.write.bidOnShape([pack(bobShape), 0n, false], { value: minBid * 3n })
    ).to.be.rejectedWith("GapBetweenLongitudes");
  });

  // Bob bids on the two leftmost squares — leaves Alice with the two rightmost: still a valid 1×2 row.
  it("permits a bid on one end of a shape leaving a valid remainder", async function () {
    const { auction, auctionAs2, minBid } = await loadFixture(deployAntiGrief);

    // Alice: 1×4 row
    const aliceShape = [
      { lat: 80, lng: 20 },
      { lat: 80, lng: 21 },
      { lat: 80, lng: 22 },
      { lat: 80, lng: 23 },
    ];
    await auction.write.bidOnShape([pack(aliceShape), 0n, false], {
      value: minBid * BigInt(aliceShape.length),
    });

    // Bob takes the left 2 squares — Alice's remainder (80,22)+(80,23) is a valid 1×2 row
    const bobShape = [
      { lat: 80, lng: 20 },
      { lat: 80, lng: 21 },
    ];
    const nextBid = minBid + minBid; // 2nd bid on these squares
    await expect(
      auctionAs2.write.bidOnShape([pack(bobShape), 0n, false], {
        value: nextBid * BigInt(bobShape.length),
      })
    ).to.be.fulfilled;
  });

  // Bob bids on all three squares: full takeover — should be permitted.
  it("permits a full takeover of an existing shape", async function () {
    const { auction, auctionAs2, minBid } = await loadFixture(deployAntiGrief);

    const aliceShape = [
      { lat: 80, lng: 30 },
      { lat: 80, lng: 31 },
      { lat: 80, lng: 32 },
    ];
    await auction.write.bidOnShape([pack(aliceShape), 0n, false], {
      value: minBid * BigInt(aliceShape.length),
    });

    const bobShape = [
      { lat: 80, lng: 30 },
      { lat: 80, lng: 31 },
      { lat: 80, lng: 32 },
    ];
    const requiredNext = (minBid + minBid) * BigInt(bobShape.length);
    await expect(
      auctionAs2.write.bidOnShape([pack(bobShape), 0n, false], { value: requiredNext })
    ).to.be.fulfilled;
  });

  // Alice holds a 2×3 rectangle. Bob bids on the entire top row, leaving Alice
  // the bottom row (2 squares): still a valid shape.
  it("permits taking an entire row from a rectangle leaving a valid bottom row", async function () {
    const { auction, auctionAs2, minBid } = await loadFixture(deployAntiGrief);

    // Alice: 2 rows × 3 cols
    const aliceShape = [
      { lat: 90, lng: 40 },
      { lat: 90, lng: 41 },
      { lat: 90, lng: 42 },
      { lat: 91, lng: 40 },
      { lat: 91, lng: 41 },
      { lat: 91, lng: 42 },
    ];
    await auction.write.bidOnShape([pack(aliceShape), 0n, false], {
      value: minBid * BigInt(aliceShape.length),
    });

    // Bob takes the top row
    const bobShape = [
      { lat: 90, lng: 40 },
      { lat: 90, lng: 41 },
      { lat: 90, lng: 42 },
    ];
    const requiredNext = (minBid + minBid) * BigInt(bobShape.length);
    await expect(
      auctionAs2.write.bidOnShape([pack(bobShape), 0n, false], { value: requiredNext })
    ).to.be.fulfilled;
  });

  // Alice has two rows that touch only at lng 41. Bob takes (100,41), which would leave two
  // rows that do not touch. Tests that the NoLatAdjacency check fires for the simulated
  // remainder.
  it("rejects an overlap that would leave a non-contiguous remainder across rows", async function () {
    const { auction, auctionAs2, minBid } = await loadFixture(deployAntiGrief);

    // Alice: 2 rows that only overlap at lng=41
    const aliceShape = [
      { lat: 100, lng: 40 },
      { lat: 100, lng: 41 },
      { lat: 101, lng: 41 },
      { lat: 101, lng: 42 },
    ];
    await auction.write.bidOnShape([pack(aliceShape), 0n, false], {
      value: minBid * BigInt(aliceShape.length),
    });

    // Bob takes (100,41) — the sole overlap cell — and (99,41) below it, breaking adjacency
    // between Alice's rows. Two squares: a one-square bid fails on minShapeSquares first.
    const bobShape = [
      { lat: 99, lng: 41 },
      { lat: 100, lng: 41 },
    ];
    await expect(
      auctionAs2.write.bidOnShape([pack(bobShape), 0n, false], { value: minBid * 3n })
    ).to.be.rejectedWith("NoLatAdjacency");
  });

  // Rectangle of `rows` x `cols` squares with its south-west square at (lat, lng), in bid order.
  const rect = (lat: number, lng: number, rows: number, cols: number) => {
    const locs = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) locs.push({ lat: lat + r, lng: lng + c });
    }
    return locs;
  };

  it("tracks the squares that each shape still holds", async function () {
    const { auction, auctionAs1, auctionAs2, minBid } = await loadFixture(deployAntiGrief);
    const row = rect(80, 10, 1, 4);
    await auctionAs1.write.bidOnShape([pack(row), 0n, false], { value: minBid * 4n });
    expect(await auction.read.shapeLiveSquares([1n])).to.equal(4n);

    await auctionAs2.write.bidOnShape([pack(row.slice(0, 2)), 0n, false], { value: minBid * 4n });
    expect(await auction.read.shapeLiveSquares([1n])).to.equal(2n);
    expect(await auction.read.shapeLiveSquares([2n])).to.equal(2n);

    // Full takeover of the rest: no remainder check, and the shape holds no squares.
    await auctionAs2.write.bidOnShape([pack(row.slice(2)), 0n, false], { value: minBid * 4n });
    expect(await auction.read.shapeLiveSquares([1n])).to.equal(0n);
    expect(await auction.read.shapeLiveSquares([3n])).to.equal(2n);
  });

  it("checks a remainder without the squares that the shape lost before", async function () {
    const { auctionAs1, auctionAs2, minBid } = await loadFixture(deployAntiGrief);
    const row = rect(80, 10, 1, 6);
    await auctionAs1.write.bidOnShape([pack(row), 0n, false], { value: minBid * 6n });
    // Bob takes lng 10 and 11. Alice keeps 12 to 15.
    await auctionAs2.write.bidOnShape([pack(row.slice(0, 2)), 0n, false], { value: minBid * 4n });

    // Taking 13 would leave 12, 14, 15.
    await expect(
      auctionAs2.write.bidOnShape([pack([{ lat: 80, lng: 13 }, { lat: 81, lng: 13 }]), 0n, false], {
        value: minBid * 3n,
      })
    ).to.be.rejectedWith("GapBetweenLongitudes");
    // Taking 12 and 13 leaves 14 and 15. The lost squares 10 and 11 are not part of the remainder.
    await expect(
      auctionAs2.write.bidOnShape([pack(row.slice(2, 4)), 0n, false], { value: minBid * 4n })
    ).to.be.fulfilled;
  });

  // 10 x 30 = 300 squares: the record of lost squares uses two 256-bit words.
  it("checks the remainder of a shape with more than 256 squares after earlier takeovers", async function () {
    const { auction, auctionAs1, auctionAs2, minBid } = await loadFixture(deployAntiGrief);
    await auctionAs1.write.bidOnShape([pack(rect(100, 10, 10, 30)), 0n, false], {
      value: minBid * 300n,
    });
    // West and east 2 columns.
    await auctionAs2.write.bidOnShape([pack(rect(100, 10, 10, 2)), 0n, false], { value: minBid * 40n });
    await auctionAs2.write.bidOnShape([pack(rect(100, 38, 10, 2)), 0n, false], { value: minBid * 40n });
    expect(await auction.read.shapeLiveSquares([1n])).to.equal(260n);

    // A middle column splits the remainder.
    await expect(
      auctionAs2.write.bidOnShape([pack(rect(100, 26, 10, 1)), 0n, false], { value: minBid * 20n })
    ).to.be.rejectedWith("GapBetweenLongitudes");
    // The new west column of the remainder leaves a valid 10 x 25 rectangle.
    await auctionAs2.write.bidOnShape([pack(rect(100, 12, 10, 1)), 0n, false], { value: minBid * 20n });
    expect(await auction.read.shapeLiveSquares([1n])).to.equal(250n);
  });
});

describe("GaiaAuction: settleShape", function () {
  async function deploySettle() {
    const [owner, bidder1, bidder2] = await viem.getWalletClients();

    const land = await deployLand(owner.account.address);
    const { countries, squares } = land;

    // Chain time, not Date.now(): earlier tests move the clock forward.
    const now = await time.latest();
    const start = BigInt(now - 10);
    const end = BigInt(now + 3600);
    const minBid = 1000n;
    const auction = await viem.deployContract(
      "contracts/GaiaAuction.sol:GaiaAuction",
      [
        countries.address,
        owner.account.address, // treasury
        start,
        end,
        end, // maxEndTime
        0n, // extensionWindow
        minBid,
        0n, // minBidIncrementBps
        1n, // minShapeSquares
        1000n, // maxShapeSquares
        10n, // maxShapeAspectRatio
      ]
    );

    await countries.write.grantRole([
      await countries.read.ISSUER_ROLE(),
      auction.address,
    ]);
    await countries.write.addAuction([auction.address]);

    const auctionAs1 = await viem.getContractAt(
      "contracts/GaiaAuction.sol:GaiaAuction",
      auction.address,
      { client: { wallet: bidder1 } }
    );
    const auctionAs2 = await viem.getContractAt(
      "contracts/GaiaAuction.sol:GaiaAuction",
      auction.address,
      { client: { wallet: bidder2 } }
    );

    return {
      land,
      owner,
      bidder1,
      bidder2,
      countries,
      squares,
      auction,
      auctionAs1,
      auctionAs2,
      minBid,
      end,
    };
  }

  it("creates a country with the winner's squares and transfers it to the winner", async function () {
    const { auction, auctionAs1, bidder1, countries, squares, minBid, end } =
      await loadFixture(deploySettle);

    const shape = [
      { lat: 10, lng: 10 },
      { lat: 10, lng: 11 },
      { lat: 10, lng: 12 },
    ];
    await auctionAs1.write.bidOnShape([pack(shape), 0n, false], {
      value: minBid * BigInt(shape.length),
    });

    await time.increaseTo(end + 1n);

    const shapeId = 1n;
    await expect(auctionAs1.write.settleShape([shapeId, 0n])).to.be.fulfilled;

    const countryId = await auction.read.shapeCountryId([shapeId]);
    expect(countryId).to.equal(1n);
    expect(getAddress(await countries.read.ownerOf([countryId]))).to.equal(
      getAddress(bidder1.account.address)
    );
    expect(await countries.read.squareCount([countryId])).to.equal(
      BigInt(shape.length)
    );
    for (const loc of shape) {
      const owner = await squares.read.controllerOf([loc.lat, loc.lng]);
      expect(getAddress(owner)).to.equal(getAddress(bidder1.account.address));
    }
  });

  it("keeps the country in the auction until the last chunk is settled", async function () {
    const { auction, auctionAs1, bidder1, countries, squares, minBid, end } =
      await loadFixture(deploySettle);

    const shape = [
      { lat: 20, lng: 10 },
      { lat: 20, lng: 11 },
      { lat: 21, lng: 10 },
      { lat: 21, lng: 11 },
    ];
    await auctionAs1.write.bidOnShape([pack(shape), 0n, false], {
      value: minBid * BigInt(shape.length),
    });

    await time.increaseTo(end + 1n);

    const shapeId = 1n;

    await auctionAs1.write.settleShape([shapeId, 2n]);
    const countryId = await auction.read.shapeCountryId([shapeId]);
    expect(getAddress(await countries.read.ownerOf([countryId]))).to.equal(
      getAddress(auction.address)
    );
    expect(await countries.read.squareCount([countryId])).to.equal(2n);

    await expect(auctionAs1.write.settleShape([shapeId, 2n])).to.be.fulfilled;
    expect(getAddress(await countries.read.ownerOf([countryId]))).to.equal(
      getAddress(bidder1.account.address)
    );
    expect(await countries.read.squareCount([countryId])).to.equal(
      BigInt(shape.length)
    );
  });

  it("extends a chunk to the end of its latitude row", async function () {
    const { auction, auctionAs1, bidder1, countries, squares, minBid, end } =
      await loadFixture(deploySettle);

    const shape = [
      { lat: 25, lng: 10 },
      { lat: 25, lng: 11 },
      { lat: 25, lng: 12 },
      { lat: 25, lng: 13 },
    ];
    await auctionAs1.write.bidOnShape([pack(shape), 0n, false], {
      value: minBid * BigInt(shape.length),
    });

    await time.increaseTo(end + 1n);

    await auctionAs1.write.settleShape([1n, 2n]);
    expect(await auction.read.shapeSettleCursor([1n])).to.equal(4n);
    const countryId = await auction.read.shapeCountryId([1n]);
    expect(getAddress(await countries.read.ownerOf([countryId]))).to.equal(
      getAddress(bidder1.account.address)
    );
  });

  it("settles one row at a time when a row starts west of the row before it", async function () {
    const { auction, auctionAs1, bidder1, countries, squares, minBid, end } =
      await loadFixture(deploySettle);

    // The first square of row 31 (lng 10) has no side neighbour in row 30.
    const shape = [
      { lat: 30, lng: 11 },
      { lat: 30, lng: 12 },
      { lat: 31, lng: 10 },
      { lat: 31, lng: 11 },
      { lat: 31, lng: 12 },
    ];
    await auctionAs1.write.bidOnShape([pack(shape), 0n, false], {
      value: minBid * BigInt(shape.length),
    });

    await time.increaseTo(end + 1n);

    await auctionAs1.write.settleShape([1n, 1n]);
    expect(await auction.read.shapeSettleCursor([1n])).to.equal(2n);
    await expect(auctionAs1.write.settleShape([1n, 1n])).to.be.fulfilled;

    const countryId = await auction.read.shapeCountryId([1n]);
    expect(await countries.read.squareCount([countryId])).to.equal(5n);
    expect(getAddress(await countries.read.ownerOf([countryId]))).to.equal(
      getAddress(bidder1.account.address)
    );
    await expect(auctionAs1.write.settleShape([1n, 1n])).to.be.rejectedWith(
      "ShapeAlreadySettled"
    );
  });

  it("transfers the country to a winner contract without a receiver hook", async function () {
    const { auction, auctionAs1, countries, minBid, end } = await loadFixture(
      deploySettle
    );

    const bidder = await viem.deployContract("ContractBidder");
    const shape = [
      { lat: 35, lng: 10 },
      { lat: 35, lng: 11 },
    ];
    await bidder.write.bid([auction.address, pack(shape)], {
      value: minBid * BigInt(shape.length),
    });

    await time.increaseTo(end + 1n);

    await expect(auctionAs1.write.settleShape([1n, 0n])).to.be.fulfilled;
    const countryId = await auction.read.shapeCountryId([1n]);
    expect(getAddress(await countries.read.ownerOf([countryId]))).to.equal(
      getAddress(bidder.address)
    );
  });

  // bidder1 owns country 1 (row 50, created by an issuer) and its account is deployed.
  async function deployWithCountryAccount() {
    const fixture = await deploySettle();
    const { land, owner, bidder1, countries } = fixture;
    await countries.write.grantRole([
      await countries.read.ISSUER_ROLE(),
      owner.account.address,
    ]);
    await countries.write.createCountry([
      bidder1.account.address,
      [
        { lat: 50, lng: 10 },
        { lat: 50, lng: 11 },
      ],
    ]);
    const account = await deployAccount(land, 1n);
    return { ...fixture, account };
  }

  it("rejects a bid from a country account", async function () {
    const { land, auction, bidder1, account, minBid } = await loadFixture(
      deployWithCountryAccount
    );
    const shape = [
      { lat: 35, lng: 10 },
      { lat: 35, lng: 11 },
    ];
    const value = minBid * BigInt(shape.length);
    const data = encodeFunctionData({
      abi: auction.abi,
      functionName: "bidOnShape",
      args: [pack(shape), 0n, false],
    });
    await expect(
      executeAs(land, bidder1, account, auction, data, value)
    ).to.be.rejectedWith("CountryAccountCannotBid");
    expect(await auction.read.shapeBidder([1n])).to.equal(
      "0x0000000000000000000000000000000000000000"
    );
  });

  it("settles a wallet bid from the owner of a country", async function () {
    const { auction, auctionAs1, bidder1, countries, minBid, end } =
      await loadFixture(deployWithCountryAccount);
    const shape = [
      { lat: 35, lng: 10 },
      { lat: 35, lng: 11 },
    ];
    await auctionAs1.write.bidOnShape([pack(shape), 0n, false], {
      value: minBid * BigInt(shape.length),
    });

    await time.increaseTo(end + 1n);

    await expect(auctionAs1.write.settleShape([1n, 0n])).to.be.fulfilled;
    const countryId = await auction.read.shapeCountryId([1n]);
    expect(countryId).to.equal(2n);
    expect(getAddress(await countries.read.ownerOf([countryId]))).to.equal(
      getAddress(bidder1.account.address)
    );
  });

  it("blocks other issuers from the squares of a shape, before and after settlement", async function () {
    const { owner, auction, auctionAs1, countries, minBid, end } =
      await loadFixture(deploySettle);
    await countries.write.grantRole([
      await countries.read.ISSUER_ROLE(),
      owner.account.address,
    ]);

    const shape = [
      { lat: 45, lng: 10 },
      { lat: 45, lng: 11 },
    ];
    await auctionAs1.write.bidOnShape([pack(shape), 0n, false], {
      value: minBid * BigInt(shape.length),
    });

    await expect(
      countries.write.createCountry([
        owner.account.address,
        [{ lat: 45, lng: 11 }],
      ])
    ).to.be.rejectedWith("SquareReserved");

    await time.increaseTo(end + 1n);
    await expect(
      countries.write.createCountry([
        owner.account.address,
        [{ lat: 45, lng: 11 }],
      ])
    ).to.be.rejectedWith("SquareReserved");

    await auctionAs1.write.settleShape([1n, 0n]);
    await expect(
      countries.write.createCountry([
        owner.account.address,
        [{ lat: 45, lng: 11 }],
      ])
    ).to.be.rejectedWith("SquareReserved");

    await countries.write.removeAuction([auction.address]);
    await expect(
      countries.write.createCountry([
        owner.account.address,
        [{ lat: 45, lng: 11 }],
      ])
    ).to.be.rejectedWith("SquareAlreadyExists");
  });

  it("skips squares overtaken by a later bid and settles them under the new shape", async function () {
    const {
      auction,
      auctionAs1,
      auctionAs2,
      bidder1,
      bidder2,
      countries,
      squares,
      minBid,
      end,
    } = await loadFixture(deploySettle);

    const aliceShape = [
      { lat: 30, lng: 10 },
      { lat: 30, lng: 11 },
      { lat: 30, lng: 12 },
    ];
    await auctionAs1.write.bidOnShape([pack(aliceShape), 0n, false], {
      value: minBid * BigInt(aliceShape.length),
    });

    // Bob takes over the last square of Alice's shape.
    const bobShape = [{ lat: 30, lng: 12 }];
    await auctionAs2.write.bidOnShape([pack(bobShape), 0n, false], { value: minBid * 2n });

    await time.increaseTo(end + 1n);

    const aliceShapeId = 1n;
    const bobShapeId = 2n;

    await auctionAs1.write.settleShape([aliceShapeId, 0n]);
    await auctionAs2.write.settleShape([bobShapeId, 0n]);

    const aliceCountry = await auction.read.shapeCountryId([aliceShapeId]);
    const bobCountry = await auction.read.shapeCountryId([bobShapeId]);
    expect(await countries.read.squareCount([aliceCountry])).to.equal(2n); // (30,10) and (30,11)
    expect(await countries.read.squareCount([bobCountry])).to.equal(1n); // (30,12), no double-mint
    expect(await squares.read.countryOf([30, 12])).to.equal(bobCountry);

    expect(getAddress(await countries.read.ownerOf([aliceCountry]))).to.equal(
      getAddress(bidder1.account.address)
    );
    expect(getAddress(await countries.read.ownerOf([bobCountry]))).to.equal(
      getAddress(bidder2.account.address)
    );
  });

  it("settles a fully-overtaken shape without minting a country", async function () {
    const { auction, auctionAs1, auctionAs2, bidder1, countries, squares, minBid, end } =
      await loadFixture(deploySettle);

    const aliceShape = [
      { lat: 40, lng: 10 },
      { lat: 40, lng: 11 },
    ];
    await auctionAs1.write.bidOnShape([pack(aliceShape), 0n, false], {
      value: minBid * BigInt(aliceShape.length),
    });

    // Bob fully overtakes Alice's shape.
    await auctionAs2.write.bidOnShape([pack(aliceShape), 0n, false], {
      value: (minBid + minBid) * BigInt(aliceShape.length),
    });

    await time.increaseTo(end + 1n);

    const aliceShapeId = 1n;
    await expect(auctionAs1.write.settleShape([aliceShapeId, 0n])).to.be
      .fulfilled;

    expect(await auction.read.shapeCountryId([aliceShapeId])).to.equal(0n);
    expect(
      await countries.read.balanceOf([bidder1.account.address])
    ).to.equal(0n);
  });

  it("reverts when settling before the auction has ended", async function () {
    const { auctionAs1, minBid } = await loadFixture(deploySettle);

    const shape = [{ lat: 50, lng: 10 }];
    await auctionAs1.write.bidOnShape([pack(shape), 0n, false], { value: minBid });

    await expect(auctionAs1.write.settleShape([1n, 0n])).to.be.rejectedWith("AuctionNotYetEnded");
  });

  it("reverts when settling an unknown shape id", async function () {
    const { auctionAs1, end } = await loadFixture(deploySettle);

    await time.increaseTo(end + 1n);

    await expect(auctionAs1.write.settleShape([999n, 0n])).to.be.rejectedWith("UnknownShape");
  });

  it("reverts when settling an already-settled shape", async function () {
    const { auctionAs1, minBid, end } = await loadFixture(deploySettle);

    const shape = [{ lat: 60, lng: 10 }];
    await auctionAs1.write.bidOnShape([pack(shape), 0n, false], { value: minBid });

    await time.increaseTo(end + 1n);

    await auctionAs1.write.settleShape([1n, 0n]);
    await expect(auctionAs1.write.settleShape([1n, 0n])).to.be.rejectedWith("ShapeAlreadySettled");
  });

  it("rejects a bid with lat out of range", async function () {
    const { auctionAs1, minBid } = await loadFixture(deploySettle);

    const shape = [{ lat: 18000, lng: 10 }];
    await expect(
      auctionAs1.write.bidOnShape([pack(shape), 0n, false], { value: minBid })
    ).to.be.rejectedWith("InvalidCoordinates");
  });

  it("rejects a bid with lng out of range", async function () {
    const { auctionAs1, minBid } = await loadFixture(deploySettle);

    const shape = [
      { lat: 10, lng: 35999 },
      { lat: 10, lng: 36000 },
    ];
    await expect(
      auctionAs1.write.bidOnShape([pack(shape), 0n, false], { value: minBid * 2n })
    ).to.be.rejectedWith("InvalidCoordinates");
  });

  it("settles a shape on the last valid row and column", async function () {
    const { auction, auctionAs1, bidder1, countries, squares, minBid, end } =
      await loadFixture(deploySettle);

    const shape = [
      { lat: 17998, lng: 35998 },
      { lat: 17998, lng: 35999 },
      { lat: 17999, lng: 35998 },
      { lat: 17999, lng: 35999 },
    ];
    await auctionAs1.write.bidOnShape([pack(shape), 0n, false], {
      value: minBid * BigInt(shape.length),
    });

    await time.increaseTo(end + 1n);

    const shapeId = 1n;
    await expect(auctionAs1.write.settleShape([shapeId, 0n])).to.be.fulfilled;
    const countryId = await auction.read.shapeCountryId([shapeId]);
    expect(getAddress(await countries.read.ownerOf([countryId]))).to.equal(
      getAddress(bidder1.account.address)
    );
    expect(await countries.read.squareCount([countryId])).to.equal(
      BigInt(shape.length)
    );
  });

  it("settles a 100-square shape for less than 7.6M gas", async function () {
    if (coverage) this.skip();
    const { auctionAs1, minBid, end } = await loadFixture(deploySettle);
    const publicClient = await viem.getPublicClient();

    const shape = [];
    for (let lat = 70; lat < 80; lat++) {
      for (let lng = 10; lng < 20; lng++) shape.push({ lat, lng });
    }
    await auctionAs1.write.bidOnShape([pack(shape), 0n, false], {
      value: minBid * BigInt(shape.length),
    });

    await time.increaseTo(end + 1n);

    const hash = await auctionAs1.write.settleShape([1n, 0n]);
    const { gasUsed } = await publicClient.waitForTransactionReceipt({ hash });
    expect(gasUsed < 7_600_000n).to.equal(true);
  });
});

describe("GaiaAuction: shapes that cross the antimeridian", function () {
  async function deployAntimeridian() {
    const [owner, bidder1, bidder2] = await viem.getWalletClients();

    const { countries, squares } = await deployLand(owner.account.address);

    const publicClient = await viem.getPublicClient();
    const now = (await publicClient.getBlock()).timestamp;
    const start = now - 10n;
    const end = now + 3600n;
    const minBid = 1000n;
    const auction = await viem.deployContract(
      "contracts/GaiaAuction.sol:GaiaAuction",
      [
        countries.address,
        owner.account.address, // treasury
        start,
        end,
        end, // maxEndTime
        0n, // extensionWindow
        minBid,
        0n, // minBidIncrementBps
        2n, // minShapeSquares
        1000n, // maxShapeSquares
        3n, // maxShapeAspectRatio
      ]
    );

    await countries.write.grantRole([
      await countries.read.ISSUER_ROLE(),
      auction.address,
    ]);
    await countries.write.addAuction([auction.address]);

    const auctionAs1 = await viem.getContractAt(
      "contracts/GaiaAuction.sol:GaiaAuction",
      auction.address,
      { client: { wallet: bidder1 } }
    );
    const auctionAs2 = await viem.getContractAt(
      "contracts/GaiaAuction.sol:GaiaAuction",
      auction.address,
      { client: { wallet: bidder2 } }
    );

    return {
      bidder1,
      countries,
      squares,
      auctionAs1,
      auctionAs2,
      minBid,
      end,
    };
  }

  // 2 rows x 4 columns: 35998, 35999, 0, 1.
  const crossingRect = (lat: number) => [
    { lat, lng: 35998 },
    { lat, lng: 35999 },
    { lat, lng: 0 },
    { lat, lng: 1 },
    { lat: lat + 1, lng: 35998 },
    { lat: lat + 1, lng: 35999 },
    { lat: lat + 1, lng: 0 },
    { lat: lat + 1, lng: 1 },
  ];

  it("accepts and settles a shape from 35998 to 1", async function () {
    const { auctionAs1, bidder1, countries, squares, minBid, end } =
      await loadFixture(deployAntimeridian);

    const shape = crossingRect(50);
    await expect(
      auctionAs1.write.bidOnShape([pack(shape), 0n, false], {
        value: minBid * BigInt(shape.length),
      })
    ).to.be.fulfilled;

    await time.increaseTo(end + 1n);

    const shapeId = 1n;
    await expect(auctionAs1.write.settleShape([shapeId, 0n])).to.be.fulfilled;
    const countryId = await auctionAs1.read.shapeCountryId([shapeId]);
    expect(await countries.read.squareCount([countryId])).to.equal(
      BigInt(shape.length)
    );
    for (const loc of shape) {
      const owner = await squares.read.controllerOf([loc.lat, loc.lng]);
      expect(getAddress(owner)).to.equal(getAddress(bidder1.account.address));
    }
  });

  it("rejects a crossing shape with a gap", async function () {
    const { auctionAs1, minBid } = await loadFixture(deployAntimeridian);

    const shape = [
      { lat: 50, lng: 35998 },
      { lat: 50, lng: 35999 },
      { lat: 50, lng: 1 },
    ];
    await expect(
      auctionAs1.write.bidOnShape([pack(shape), 0n, false], { value: minBid * 3n })
    ).to.be.rejectedWith("GapBetweenLongitudes");
  });

  it("rejects a crossing shape that is not sorted west to east", async function () {
    const { auctionAs1, minBid } = await loadFixture(deployAntimeridian);

    const shape = [
      { lat: 50, lng: 0 },
      { lat: 50, lng: 35999 },
    ];
    await expect(
      auctionAs1.write.bidOnShape([pack(shape), 0n, false], { value: minBid * 2n })
    ).to.be.rejectedWith("GapBetweenLongitudes");
  });

  it("rejects a crossing shape with a concave left edge", async function () {
    const { auctionAs1, minBid } = await loadFixture(deployAntimeridian);

    // Left edge goes 35999 -> 0 -> 35999.
    const shape = [
      { lat: 50, lng: 35999 },
      { lat: 50, lng: 0 },
      { lat: 51, lng: 0 },
      { lat: 51, lng: 1 },
      { lat: 52, lng: 35999 },
      { lat: 52, lng: 0 },
    ];
    await expect(
      auctionAs1.write.bidOnShape([pack(shape), 0n, false], {
        value: minBid * BigInt(shape.length),
      })
    ).to.be.rejectedWith("NotConvexStart");
  });

  it("uses the real width of a crossing shape for the aspect ratio", async function () {
    const { auctionAs1, minBid } = await loadFixture(deployAntimeridian);

    // 1 x 3 → ratio 3 == maxShapeAspectRatio.
    const narrow = [
      { lat: 50, lng: 35999 },
      { lat: 50, lng: 0 },
      { lat: 50, lng: 1 },
    ];
    await expect(
      auctionAs1.write.bidOnShape([pack(narrow), 0n, false], { value: minBid * 3n })
    ).to.be.fulfilled;

    // 1 x 4 → ratio 4 > maxShapeAspectRatio.
    const wide = [
      { lat: 60, lng: 35998 },
      { lat: 60, lng: 35999 },
      { lat: 60, lng: 0 },
      { lat: 60, lng: 1 },
    ];
    await expect(
      auctionAs1.write.bidOnShape([pack(wide), 0n, false], { value: minBid * 4n })
    ).to.be.rejectedWith("AspectRatioExceeded");
  });

  it("permits an overlap on a crossing shape that leaves a valid remainder", async function () {
    const { auctionAs1, auctionAs2, countries, minBid, end } =
      await loadFixture(deployAntimeridian);

    const aliceShape = crossingRect(70);
    await auctionAs1.write.bidOnShape([pack(aliceShape), 0n, false], {
      value: minBid * BigInt(aliceShape.length),
    });

    // Bob takes the west half (35998, 35999). Alice keeps the 2 x 2 block at 0, 1.
    const bobShape = [
      { lat: 70, lng: 35998 },
      { lat: 70, lng: 35999 },
      { lat: 71, lng: 35998 },
      { lat: 71, lng: 35999 },
    ];
    await expect(
      auctionAs2.write.bidOnShape([pack(bobShape), 0n, false], {
        value: (minBid + minBid) * BigInt(bobShape.length),
      })
    ).to.be.fulfilled;

    await time.increaseTo(end + 1n);

    await auctionAs1.write.settleShape([1n, 0n]);
    await auctionAs2.write.settleShape([2n, 0n]);
    const aliceCountry = await auctionAs1.read.shapeCountryId([1n]);
    const bobCountry = await auctionAs1.read.shapeCountryId([2n]);
    expect(await countries.read.squareCount([aliceCountry])).to.equal(4n);
    expect(await countries.read.squareCount([bobCountry])).to.equal(4n);
  });

  it("rejects an overlap on a crossing shape that splits the remainder", async function () {
    const { auctionAs1, auctionAs2, minBid } = await loadFixture(
      deployAntimeridian
    );

    const aliceShape = crossingRect(80);
    await auctionAs1.write.bidOnShape([pack(aliceShape), 0n, false], {
      value: minBid * BigInt(aliceShape.length),
    });

    // Bob takes the middle columns (35999, 0). Alice keeps 35998 and 1, which are not adjacent.
    const bobShape = [
      { lat: 80, lng: 35999 },
      { lat: 80, lng: 0 },
      { lat: 81, lng: 35999 },
      { lat: 81, lng: 0 },
    ];
    await expect(
      auctionAs2.write.bidOnShape([pack(bobShape), 0n, false], {
        value: (minBid + minBid) * BigInt(bobShape.length),
      })
    ).to.be.rejectedWith("GapBetweenLongitudes");
  });
});

describe("GaiaAuction: treasury proceeds", function () {
  async function deployProceeds() {
    const [owner, bidder1, bidder2, treasury] =
      await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();

    const { countries } = await deployLand(owner.account.address);

    const now = (await publicClient.getBlock()).timestamp;
    const start = now - 10n;
    const end = now + 3600n;
    const minBid = 1000n;
    const auction = await viem.deployContract(
      "contracts/GaiaAuction.sol:GaiaAuction",
      [
        countries.address,
        treasury.account.address,
        start,
        end,
        end, // maxEndTime
        0n, // extensionWindow
        minBid,
        0n, // minBidIncrementBps
        1n, // minShapeSquares
        1000n, // maxShapeSquares
        10n, // maxShapeAspectRatio
      ]
    );

    const auctionAs1 = await viem.getContractAt(
      "contracts/GaiaAuction.sol:GaiaAuction",
      auction.address,
      { client: { wallet: bidder1 } }
    );
    const auctionAs2 = await viem.getContractAt(
      "contracts/GaiaAuction.sol:GaiaAuction",
      auction.address,
      { client: { wallet: bidder2 } }
    );

    return {
      publicClient,
      bidder1,
      bidder2,
      treasury,
      auction,
      auctionAs1,
      auctionAs2,
      minBid,
      end,
    };
  }

  // bidder1 bids 3 squares, bidder2 overtakes one of them, bidder1 bids 2 more squares.
  // Winning bids: 2*minBid (bidder1, shape 1) + 2*minBid (bidder2) + 2*minBid (bidder1, shape 3).
  // Refund owed to bidder1: minBid.
  async function placeBids(
    f: Awaited<ReturnType<typeof deployProceeds>>
  ) {
    const { auctionAs1, auctionAs2, minBid } = f;
    await auctionAs1.write.bidOnShape(
      [
        pack([
          { lat: 10, lng: 10 },
          { lat: 10, lng: 11 },
          { lat: 10, lng: 12 },
        ]),
        0n,
        false,
      ],
      { value: minBid * 3n }
    );
    await auctionAs2.write.bidOnShape([pack([{ lat: 10, lng: 12 }]), 0n, false], {
      value: minBid * 2n,
    });
    await auctionAs1.write.bidOnShape(
      [
        pack([
          { lat: 20, lng: 10 },
          { lat: 20, lng: 11 },
        ]),
        0n,
        false,
      ],
      { value: minBid * 2n }
    );
    return { winningTotal: minBid * 6n, refund: minBid };
  }

  it("sends the sum of all winning bids to the treasury after the auction ends", async function () {
    const f = await loadFixture(deployProceeds);
    const { publicClient, treasury, auction, auctionAs1, end } = f;
    const { winningTotal, refund } = await placeBids(f);

    expect(await auction.read.proceeds()).to.equal(winningTotal);

    await time.increaseTo(end + 1n);

    const before = await publicClient.getBalance({
      address: treasury.account.address,
    });
    await expect(auctionAs1.write.withdrawProceeds()).to.be.fulfilled;
    const after = await publicClient.getBalance({
      address: treasury.account.address,
    });

    expect(after - before).to.equal(winningTotal);
    expect(await auction.read.proceeds()).to.equal(0n);
    expect(
      await publicClient.getBalance({ address: auction.address })
    ).to.equal(refund);
  });

  it("lets outbid bidders withdraw their full refunds after the proceeds are sent", async function () {
    const f = await loadFixture(deployProceeds);
    const { publicClient, bidder1, auction, auctionAs1, end } = f;
    const { refund } = await placeBids(f);

    await time.increaseTo(end + 1n);
    await auctionAs1.write.withdrawProceeds();

    expect(
      await auction.read.pendingReturns([bidder1.account.address])
    ).to.equal(refund);

    await expect(auctionAs1.write.withdraw()).to.be.fulfilled;

    expect(
      await auction.read.pendingReturns([bidder1.account.address])
    ).to.equal(0n);
    expect(
      await publicClient.getBalance({ address: auction.address })
    ).to.equal(0n);
  });

  it("credits overpayment to the bidder, not to the proceeds", async function () {
    const { bidder2, auction, auctionAs2, minBid } = await loadFixture(
      deployProceeds
    );

    await auctionAs2.write.bidOnShape([pack([{ lat: 30, lng: 10 }]), 0n, false], {
      value: minBid * 5n,
    });

    expect(await auction.read.proceeds()).to.equal(minBid);
    expect(
      await auction.read.pendingReturns([bidder2.account.address])
    ).to.equal(minBid * 4n);
  });

  it("does not send proceeds twice", async function () {
    const f = await loadFixture(deployProceeds);
    const { publicClient, treasury, auctionAs1, end } = f;
    await placeBids(f);

    await time.increaseTo(end + 1n);
    await auctionAs1.write.withdrawProceeds();

    const before = await publicClient.getBalance({
      address: treasury.account.address,
    });
    await expect(auctionAs1.write.withdrawProceeds()).to.be.fulfilled;
    const after = await publicClient.getBalance({
      address: treasury.account.address,
    });
    expect(after).to.equal(before);
  });

  it("reverts when withdrawing proceeds before the auction has ended", async function () {
    const f = await loadFixture(deployProceeds);
    await placeBids(f);

    await expect(f.auctionAs1.write.withdrawProceeds()).to.be.rejectedWith("AuctionNotYetEnded");
  });
});

describe("GaiaAuction: soft close, bid increment and jump bids", function () {
  const window = 600n;
  const capAfterEnd = 1800n;
  const minBid = 1000n;
  const bps = 500n; // 5%

  async function deploySoftClose() {
    const [owner, bidder1, bidder2] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();

    const { countries } = await deployLand(owner.account.address);

    const now = (await publicClient.getBlock()).timestamp;
    const start = now - 10n;
    const end = now + 3600n;
    const maxEnd = end + capAfterEnd;
    const auction = await viem.deployContract(
      "contracts/GaiaAuction.sol:GaiaAuction",
      [
        countries.address,
        owner.account.address, // treasury
        start,
        end,
        maxEnd,
        window,
        minBid,
        bps,
        1n, // minShapeSquares
        1000n, // maxShapeSquares
        10n, // maxShapeAspectRatio
      ]
    );
    await countries.write.grantRole([
      await countries.read.ISSUER_ROLE(),
      auction.address,
    ]);
    await countries.write.addAuction([auction.address]);

    const auctionAs2 = await viem.getContractAt(
      "contracts/GaiaAuction.sol:GaiaAuction",
      auction.address,
      { client: { wallet: bidder2 } }
    );

    return { publicClient, countries, auction, auctionAs2, end, maxEnd };
  }

  // Bids one fresh square at the given block timestamp.
  async function bidAt(
    auction: Awaited<ReturnType<typeof deploySoftClose>>["auction"],
    timestamp: bigint,
    lng: number
  ) {
    await time.setNextBlockTimestamp(timestamp);
    return auction.write.bidOnShape([pack([{ lat: 40, lng }]), 0n, false], {
      value: minBid,
    });
  }

  describe("soft close", function () {
    it("does not extend for a bid with more than the window left", async function () {
      const { auction, end } = await loadFixture(deploySoftClose);
      await bidAt(auction, end - window - 1n, 1);
      expect(await auction.read.endTime()).to.equal(end);
    });

    it("does not extend for a bid with exactly the window left", async function () {
      const { auction, end } = await loadFixture(deploySoftClose);
      await bidAt(auction, end - window, 1);
      expect(await auction.read.endTime()).to.equal(end);
    });

    it("extends for a bid with one second less than the window left", async function () {
      const { auction, end } = await loadFixture(deploySoftClose);
      await bidAt(auction, end - window + 1n, 1);
      expect(await auction.read.endTime()).to.equal(end + 1n);
      const events = await auction.getEvents.AuctionExtended();
      expect(events.length).to.equal(1);
      expect(events[0].args.endTime).to.equal(end + 1n);
    });

    it("accepts a bid exactly at endTime and extends by the full window", async function () {
      const { auction, end } = await loadFixture(deploySoftClose);
      await bidAt(auction, end, 1);
      expect(await auction.read.endTime()).to.equal(end + window);
    });

    it("rejects a bid after endTime", async function () {
      const { auction, end } = await loadFixture(deploySoftClose);
      await expect(bidAt(auction, end + 1n, 1)).to.be.rejectedWith(
        "AuctionAlreadyEnded"
      );
      expect(await auction.read.endTime()).to.equal(end);
    });

    it("extends for a bid on any square, not only the squares bid before", async function () {
      const { auction, auctionAs2, end } = await loadFixture(deploySoftClose);
      await bidAt(auction, end - 100n, 1);
      await time.setNextBlockTimestamp(end + window - 100n);
      await auctionAs2.write.bidOnShape([pack([{ lat: 70, lng: 300 }]), 0n, false], {
        value: minBid,
      });
      expect(await auction.read.endTime()).to.equal(end + 2n * window - 100n);
    });

    it("stops at maxEndTime", async function () {
      const { auction, end, maxEnd } = await loadFixture(deploySoftClose);
      await bidAt(auction, end, 1);
      await bidAt(auction, end + window, 2);
      await bidAt(auction, end + 2n * window, 3);
      expect(await auction.read.endTime()).to.equal(maxEnd);

      // A bid at the cap is accepted, but the end does not move.
      await bidAt(auction, maxEnd, 4);
      expect(await auction.read.endTime()).to.equal(maxEnd);
      expect((await auction.getEvents.AuctionExtended()).length).to.equal(0);

      await expect(bidAt(auction, maxEnd + 1n, 5)).to.be.rejectedWith(
        "AuctionAlreadyEnded"
      );
    });

    it("cuts an extension that would go past maxEndTime", async function () {
      const { auction, end, maxEnd } = await loadFixture(deploySoftClose);
      await bidAt(auction, end, 1);
      await bidAt(auction, end + 500n, 2); // end + 1100
      await bidAt(auction, end + 1000n, 3); // end + 1600
      // end + 1500 + window is end + 2100, past the cap.
      await bidAt(auction, end + 1500n, 4);
      expect(await auction.read.endTime()).to.equal(maxEnd);
    });

    it("keeps settlement and proceeds closed until the extended end", async function () {
      const { auction, end } = await loadFixture(deploySoftClose);
      await bidAt(auction, end, 1);
      await time.setNextBlockTimestamp(end + 1n);
      await expect(auction.write.settleShape([1n, 0n])).to.be.rejectedWith(
        "AuctionNotYetEnded"
      );
      await time.setNextBlockTimestamp(end + window + 1n);
      await auction.write.settleShape([1n, 0n]);
      await auction.write.withdrawProceeds();
    });

    it("rejects a maxEndTime before endTime and an increment above 100%", async function () {
      const [owner] = await viem.getWalletClients();
      const { countries } = await deployLand(owner.account.address);
      const args = (maxEnd: bigint, incrementBps: bigint) =>
        [
          countries.address,
          owner.account.address,
          100n,
          200n,
          maxEnd,
          window,
          minBid,
          incrementBps,
          1n,
          1000n,
          10n,
        ] as const;
      await expect(
        viem.deployContract("contracts/GaiaAuction.sol:GaiaAuction", [
          ...args(199n, bps),
        ])
      ).to.be.rejectedWith("invalid max end time");
      await expect(
        viem.deployContract("contracts/GaiaAuction.sol:GaiaAuction", [
          ...args(200n, 10_001n),
        ])
      ).to.be.rejectedWith("invalid bid increment");
    });
  });

  describe("bid increment", function () {
    it("uses minBidPerSquareWei when it is larger than the percentage", async function () {
      const { auction, auctionAs2 } = await loadFixture(deploySoftClose);
      const loc = { lat: 40, lng: 1 };
      await auction.write.bidOnShape([pack([loc]), 0n, false], { value: minBid });
      // 5% of 1000 is 50, so the step is minBid.
      await expect(
        auctionAs2.write.bidOnShape([pack([loc]), 0n, false], { value: 2n * minBid - 1n })
      ).to.be.rejectedWith("InsufficientValue");
      await auctionAs2.write.bidOnShape([pack([loc]), 0n, false], { value: 2n * minBid });
      expect((await auction.read.highestBids([40, 1]))[1]).to.equal(
        2n * minBid
      );
    });

    it("uses the percentage when it is larger than minBidPerSquareWei", async function () {
      const { auction, auctionAs2 } = await loadFixture(deploySoftClose);
      const loc = { lat: 40, lng: 1 };
      await auction.write.bidOnShape([pack([loc]), 100_000n, false], { value: 100_000n });
      // 5% of 100000 is 5000, larger than minBid.
      await expect(
        auctionAs2.write.bidOnShape([pack([loc]), 0n, false], { value: 104_999n })
      ).to.be.rejectedWith("InsufficientValue");
      await auctionAs2.write.bidOnShape([pack([loc]), 0n, false], { value: 105_000n });
      expect((await auction.read.highestBids([40, 1]))[1]).to.equal(105_000n);
    });
  });

  describe("jump bids", function () {
    it("puts floorPerSquare on each square when it is above the next bid", async function () {
      const { auction } = await loadFixture(deploySoftClose);
      const shape = [
        { lat: 40, lng: 1 },
        { lat: 40, lng: 2 },
      ];
      await expect(
        auction.write.bidOnShape([pack(shape), 5000n, false], { value: 9999n })
      ).to.be.rejectedWith("InsufficientValue");
      await auction.write.bidOnShape([pack(shape), 5000n, false], { value: 10_000n });
      expect((await auction.read.highestBids([40, 1]))[1]).to.equal(5000n);
      expect((await auction.read.highestBids([40, 2]))[1]).to.equal(5000n);
      expect(await auction.read.proceeds()).to.equal(10_000n);
    });

    it("uses the next bid on squares where it is above floorPerSquare", async function () {
      const { auction, auctionAs2 } = await loadFixture(deploySoftClose);
      await auction.write.bidOnShape([pack([{ lat: 40, lng: 1 }]), 10_000n, false], {
        value: 10_000n,
      });
      const shape = [
        { lat: 40, lng: 1 }, // next bid 11000 (10000 + minBid), above the floor
        { lat: 40, lng: 2 }, // unbid: the floor, 5000
      ];
      await auctionAs2.write.bidOnShape([pack(shape), 5000n, false], { value: 16_000n });
      expect((await auction.read.highestBids([40, 1]))[1]).to.equal(11_000n);
      expect((await auction.read.highestBids([40, 2]))[1]).to.equal(5000n);
    });

    it("refunds value above the required total", async function () {
      const { auction, publicClient } = await loadFixture(deploySoftClose);
      const [owner] = await viem.getWalletClients();
      await auction.write.bidOnShape([pack([{ lat: 40, lng: 1 }]), 5000n, false], {
        value: 6000n,
      });
      expect(
        await auction.read.pendingReturns([owner.account.address])
      ).to.equal(1000n);
      expect(await publicClient.getBalance({ address: auction.address })).to.equal(6000n);
    });
  });
});

describe("GaiaAuction: re-bid on own squares", function () {
  const window = 600n;
  const minBid = 1000n;
  const bps = 500n; // 5%: below minBid for bids up to 20,000 wei

  async function deployOwn() {
    const [owner, bidder1, bidder2] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();

    const { countries } = await deployLand(owner.account.address);

    const now = (await publicClient.getBlock()).timestamp;
    const start = now - 10n;
    const end = now + 3600n;
    const auction = await viem.deployContract(
      "contracts/GaiaAuction.sol:GaiaAuction",
      [
        countries.address,
        owner.account.address, // treasury
        start,
        end,
        end + 3600n, // maxEndTime
        window,
        minBid,
        bps,
        1n, // minShapeSquares
        1000n, // maxShapeSquares
        10n, // maxShapeAspectRatio
      ]
    );
    await countries.write.grantRole([
      await countries.read.ISSUER_ROLE(),
      auction.address,
    ]);
    await countries.write.addAuction([auction.address]);

    const as = async (wallet: typeof owner) =>
      viem.getContractAt("contracts/GaiaAuction.sol:GaiaAuction", auction.address, {
        client: { wallet },
      });

    return {
      publicClient,
      countries,
      auction,
      alice: bidder1.account.address,
      bob: bidder2.account.address,
      asAlice: await as(bidder1),
      asBob: await as(bidder2),
      end,
    };
  }

  type Own = Awaited<ReturnType<typeof deployOwn>>;

  const row = [
    { lat: 10, lng: 10 },
    { lat: 10, lng: 11 },
    { lat: 10, lng: 12 },
    { lat: 10, lng: 13 },
  ];
  const lost = row[3];
  const kept = row.slice(0, 3);

  // Alice bids on the row (minBid per square). Bob takes its east square (2 * minBid), so Alice
  // gets minBid in pendingReturns.
  async function partialTakeover(f: Own) {
    await f.asAlice.write.bidOnShape([pack(row), 0n, false], { value: 4n * minBid });
    await f.asBob.write.bidOnShape([pack([lost]), 0n, false], { value: 2n * minBid });
  }

  async function amountOf(f: Own, loc: { lat: number; lng: number }) {
    const [, amount] = await f.auction.read.highestBids([loc.lat, loc.lng]);
    return amount;
  }

  async function expectActiveBidsEqualProceeds(f: Own) {
    const active =
      (await f.auction.read.activeBids([f.alice])) +
      (await f.auction.read.activeBids([f.bob]));
    expect(active).to.equal(await f.auction.read.proceeds());
  }

  async function paidBy(f: Own, hash: `0x${string}`) {
    const tx = await f.publicClient.getTransaction({ hash });
    return tx.value;
  }

  describe("raiseOwnSquares = false", function () {
    it("takes back the full shape and pays only for the lost square", async function () {
      const f = await loadFixture(deployOwn);
      await partialTakeover(f);
      await expectActiveBidsEqualProceeds(f);

      // Lost square: next bid after 2 * minBid. Own squares: 0.
      await expect(
        f.asAlice.write.bidOnShape([pack(row), 0n, false], { value: 3n * minBid - 1n })
      ).to.be.rejectedWith("InsufficientValue");
      await f.asAlice.write.bidOnShape([pack(row), 0n, false], { value: 3n * minBid });

      for (const loc of kept) {
        expect(await amountOf(f, loc)).to.equal(minBid);
        expect(await f.auction.read.squareShapeId([loc.lat, loc.lng])).to.equal(3n);
      }
      expect(await amountOf(f, lost)).to.equal(3n * minBid);
      expect(await f.auction.read.squareShapeId([lost.lat, lost.lng])).to.equal(3n);
      // Only the refund from Bob's takeover: nothing for own squares.
      expect(await f.auction.read.pendingReturns([f.alice])).to.equal(minBid);
      expect(await f.auction.read.pendingReturns([f.bob])).to.equal(2n * minBid);
      expect(await f.auction.read.activeBids([f.alice])).to.equal(6n * minBid);
      expect(await f.auction.read.activeBids([f.bob])).to.equal(0n);
      expect(await f.auction.read.proceeds()).to.equal(6n * minBid);
      await expectActiveBidsEqualProceeds(f);
    });

    it("applies floorPerSquare only to the lost square", async function () {
      const f = await loadFixture(deployOwn);
      await partialTakeover(f);

      await f.asAlice.write.bidOnShape([pack(row), 5n * minBid, false], {
        value: 5n * minBid,
      });

      for (const loc of kept) expect(await amountOf(f, loc)).to.equal(minBid);
      expect(await amountOf(f, lost)).to.equal(5n * minBid);
      // Only the refund from Bob's takeover: nothing for own squares.
      expect(await f.auction.read.pendingReturns([f.alice])).to.equal(minBid);
      await expectActiveBidsEqualProceeds(f);
    });

    it("accepts a bid with no value when it raises nothing and refunds any value sent", async function () {
      const f = await loadFixture(deployOwn);
      await f.asAlice.write.bidOnShape([pack(row), 0n, false], { value: 4n * minBid });

      await f.asAlice.write.bidOnShape([pack(row), 0n, false]);
      await f.asAlice.write.bidOnShape([pack(row), 0n, false], { value: 700n });

      for (const loc of row) {
        expect(await amountOf(f, loc)).to.equal(minBid);
        expect(await f.auction.read.squareShapeId([loc.lat, loc.lng])).to.equal(3n);
      }
      expect(await f.auction.read.pendingReturns([f.alice])).to.equal(700n);
      expect(await f.auction.read.proceeds()).to.equal(4n * minBid);
      await expectActiveBidsEqualProceeds(f);
    });
  });

  describe("raiseOwnSquares = true", function () {
    it("raises own squares to the next bid and charges only the difference", async function () {
      const f = await loadFixture(deployOwn);
      await partialTakeover(f);

      // Own squares: minBid -> 2 * minBid, so 3 * minBid. Lost square: 3 * minBid.
      await expect(
        f.asAlice.write.bidOnShape([pack(row), 0n, true], { value: 6n * minBid - 1n })
      ).to.be.rejectedWith("InsufficientValue");
      await f.asAlice.write.bidOnShape([pack(row), 0n, true], { value: 6n * minBid });

      for (const loc of kept) expect(await amountOf(f, loc)).to.equal(2n * minBid);
      expect(await amountOf(f, lost)).to.equal(3n * minBid);
      // Only the refund from Bob's takeover: nothing for own squares.
      expect(await f.auction.read.pendingReturns([f.alice])).to.equal(minBid);
      expect(await f.auction.read.activeBids([f.alice])).to.equal(9n * minBid);
      expect(await f.auction.read.proceeds()).to.equal(9n * minBid);
      await expectActiveBidsEqualProceeds(f);
    });

    it("raises own squares to floorPerSquare when it is above the next bid", async function () {
      const f = await loadFixture(deployOwn);
      await partialTakeover(f);

      // Own squares: minBid -> 2.5 * minBid (1.5 * minBid each). Lost square: 3 * minBid.
      const floor = 2500n;
      const required = 3n * (floor - minBid) + 3n * minBid;
      await f.asAlice.write.bidOnShape([pack(row), floor, true], { value: required });

      for (const loc of kept) expect(await amountOf(f, loc)).to.equal(floor);
      expect(await amountOf(f, lost)).to.equal(3n * minBid);
      // Only the refund from Bob's takeover: nothing for own squares.
      expect(await f.auction.read.pendingReturns([f.alice])).to.equal(minBid);
      await expectActiveBidsEqualProceeds(f);
    });

    it("uses the percentage increment on own squares", async function () {
      const f = await loadFixture(deployOwn);
      const loc = { lat: 30, lng: 30 };
      await f.asAlice.write.bidOnShape([pack([loc]), 100_000n, false], { value: 100_000n });

      // 5% of 100,000 is above minBid.
      await f.asAlice.write.bidOnShape([pack([loc]), 0n, true], { value: 5000n });
      expect(await amountOf(f, loc)).to.equal(105_000n);
      expect(await f.auction.read.pendingReturns([f.alice])).to.equal(0n);
      await expectActiveBidsEqualProceeds(f);
    });
  });

  describe("soft close", function () {
    it("does not extend for a re-bid that raises no amount", async function () {
      const f = await loadFixture(deployOwn);
      await f.asAlice.write.bidOnShape([pack(row), 0n, false], { value: 4n * minBid });

      await time.setNextBlockTimestamp(f.end - 10n);
      await f.asAlice.write.bidOnShape([pack(row), 0n, false]);
      expect(await f.auction.read.endTime()).to.equal(f.end);
    });

    it("extends for a re-bid that raises one own square", async function () {
      const f = await loadFixture(deployOwn);
      await f.asAlice.write.bidOnShape([pack(row), 0n, false], { value: 4n * minBid });

      await time.setNextBlockTimestamp(f.end - 10n);
      await f.asAlice.write.bidOnShape([pack([row[0]]), 0n, true], { value: minBid });
      expect(await f.auction.read.endTime()).to.equal(f.end - 10n + window);
    });

    it("extends for a re-bid that raises only the lost square", async function () {
      const f = await loadFixture(deployOwn);
      await partialTakeover(f);

      await time.setNextBlockTimestamp(f.end - 10n);
      await f.asAlice.write.bidOnShape([pack(row), 0n, false], { value: 3n * minBid });
      expect(await f.auction.read.endTime()).to.equal(f.end - 10n + window);
    });
  });

  it("merges two adjacent own shapes into one country with a free re-bid", async function () {
    const f = await loadFixture(deployOwn);
    await f.asAlice.write.bidOnShape([pack(row.slice(0, 2)), 0n, false], { value: 2n * minBid });
    await f.asAlice.write.bidOnShape([pack(row.slice(2)), 0n, false], { value: 2n * minBid });

    const hash = await f.asAlice.write.bidOnShape([pack(row), 0n, false]);
    expect(await paidBy(f, hash)).to.equal(0n);
    for (const loc of row) {
      expect(await f.auction.read.squareShapeId([loc.lat, loc.lng])).to.equal(3n);
      expect(await amountOf(f, loc)).to.equal(minBid);
    }
    expect(await f.auction.read.proceeds()).to.equal(4n * minBid);
    await expectActiveBidsEqualProceeds(f);

    await time.increaseTo((await f.auction.read.endTime()) + 1n);
    for (const shapeId of [1n, 2n, 3n]) {
      await f.asAlice.write.settleShape([shapeId, 0n]);
    }
    expect(await f.auction.read.shapeCountryId([1n])).to.equal(0n);
    expect(await f.auction.read.shapeCountryId([2n])).to.equal(0n);
    const countryId = await f.auction.read.shapeCountryId([3n]);
    expect(countryId).to.not.equal(0n);
    expect(await f.countries.read.squareCount([countryId])).to.equal(4n);
    expect(await f.countries.read.balanceOf([f.alice])).to.equal(1n);
  });

  it("rebuilds every shape and current bid from ShapeBid events only", async function () {
    const f = await loadFixture(deployOwn);
    const row11 = row.map((loc) => ({ lat: 11, lng: loc.lng }));

    await f.asAlice.write.bidOnShape([pack(row), 0n, false], { value: 4n * minBid }); // 1
    await f.asBob.write.bidOnShape([pack([lost]), 0n, false], { value: 2n * minBid }); // 2: partial takeover
    await f.asAlice.write.bidOnShape([pack(row11), 0n, false], { value: 4n * minBid }); // 3
    await f.asAlice.write.bidOnShape([pack(row), 0n, false], { value: 4n * minBid }); // 4: take back, 1000 excess
    await f.asBob.write.bidOnShape([pack(row11.slice(0, 2)), 0n, false], { value: 4n * minBid }); // 5
    // 6: merge row 10 and the rest of row 11, and raise own squares.
    await f.asAlice.write.bidOnShape([pack([...row, ...row11.slice(2)]), 0n, true], {
      value: 10n * minBid,
    });
    await f.asBob.write.bidOnShape([pack([row[0]]), 5n * minBid, false], { value: 5n * minBid }); // 7: jump bid

    const events = await f.auction.getEvents.ShapeBid({}, { fromBlock: 0n });
    expect(events.map((e) => e.args.shapeId)).to.deep.equal([1n, 2n, 3n, 4n, 5n, 6n, 7n]);
    // Bid 4 spends the next bid on the lost square only; own squares stay at minBid.
    expect(events[3].args.paid).to.equal(3n * minBid);
    expect(events[3].args.amounts).to.deep.equal([minBid, minBid, minBid, 3n * minBid]);

    // Rebuild: a square belongs to the newest shape that contains it.
    const shapeBidders = new Map<bigint, string>();
    const squareOf = new Map<number, { shapeId: bigint; amount: bigint }>();
    for (const { args } of events) {
      const { shapeId, bidder, squares, amounts } = args;
      if (shapeId === undefined || bidder === undefined || squares === undefined || amounts === undefined) {
        throw new Error("incomplete ShapeBid event");
      }
      shapeBidders.set(shapeId, bidder);
      squares.forEach((square, i) => squareOf.set(square, { shapeId, amount: amounts[i] }));
    }

    const shapeSquares = new Map<bigint, number[]>();
    let total = 0n;
    for (const [square, { shapeId, amount }] of squareOf) {
      const lat = square >> 16;
      const lng = square & 0xffff;
      expect(await f.auction.read.squareShapeId([lat, lng])).to.equal(shapeId);
      const [bidder, onChainAmount] = await f.auction.read.highestBids([lat, lng]);
      expect(getAddress(bidder)).to.equal(getAddress(shapeBidders.get(shapeId) ?? ""));
      expect(onChainAmount).to.equal(amount);
      shapeSquares.set(shapeId, [...(shapeSquares.get(shapeId) ?? []), square]);
      total += amount;
    }
    for (const [shapeId, bidder] of shapeBidders) {
      expect(getAddress(await f.auction.read.shapeBidder([shapeId]))).to.equal(getAddress(bidder));
    }
    expect(total).to.equal(await f.auction.read.proceeds());
    await expectActiveBidsEqualProceeds(f);

    // Current shapes: 1 to 4 are fully overtaken; 5, 6 and 7 hold squares.
    expect([...shapeSquares.keys()].sort()).to.deep.equal([5n, 6n, 7n]);
    expect(shapeSquares.get(5n)).to.have.members(pack(row11.slice(0, 2)));
    expect(shapeSquares.get(6n)).to.have.members(pack([...row.slice(1), ...row11.slice(2)]));
    expect(shapeSquares.get(7n)).to.have.members(pack([row[0]]));
  });

  it("rejects a re-bid on own squares that leaves the old shape invalid", async function () {
    const f = await loadFixture(deployOwn);
    await f.asAlice.write.bidOnShape([pack(row), 0n, false], { value: 4n * minBid });

    // Taking (10, 11) leaves (10, 10) and (10, 12..13): two parts.
    await expect(
      f.asAlice.write.bidOnShape([pack([row[1]]), 0n, false])
    ).to.be.rejectedWith("GapBetweenLongitudes");
    await expect(
      f.asAlice.write.bidOnShape([pack([row[1]]), 0n, true], { value: minBid })
    ).to.be.rejectedWith("GapBetweenLongitudes");
    await expectActiveBidsEqualProceeds(f);
  });
});

describe("GaiaAuction: pause and cancel", function () {
  const minBid = 1000n;
  const window = 300n;

  async function deployPausable() {
    // `owner` is the GaiaCountries admin, so it can pause, unpause and cancel.
    const [owner, bidder1, bidder2, bidder3, treasury, stranger, newAdmin] =
      await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();

    const { countries } = await deployLand(owner.account.address);

    const now = (await publicClient.getBlock()).timestamp;
    const start = now - 10n;
    const end = now + 3600n;
    const maxEnd = end + 3600n;
    const auction = await viem.deployContract(
      "contracts/GaiaAuction.sol:GaiaAuction",
      [
        countries.address,
        treasury.account.address,
        start,
        end,
        maxEnd,
        window,
        minBid,
        0n, // minBidIncrementBps
        1n, // minShapeSquares
        1000n, // maxShapeSquares
        10n, // maxShapeAspectRatio
      ]
    );
    await countries.write.grantRole([
      await countries.read.ISSUER_ROLE(),
      auction.address,
    ]);
    await countries.write.addAuction([auction.address]);

    const as = async (wallet: typeof owner) =>
      viem.getContractAt("contracts/GaiaAuction.sol:GaiaAuction", auction.address, {
        client: { wallet },
      });

    return {
      publicClient,
      countries,
      auction,
      bidders: [bidder1, bidder2, bidder3],
      asBidders: [await as(bidder1), await as(bidder2), await as(bidder3)],
      asAdmin: await as(owner),
      asNewAdmin: await as(newAdmin),
      asStranger: await as(stranger),
      owner,
      newAdmin,
      treasury,
      end,
      maxEnd,
    };
  }

  type Pausable = Awaited<ReturnType<typeof deployPausable>>;

  // Three bidders. Bidder 2 takes one square of bidder 1, bidder 3 takes it back from bidder 2,
  // bidder 1 bids again on its own square, and bidder 3 overpays. Returns what each bidder paid.
  async function placeBids(f: Pausable) {
    const [as1, as2, as3] = f.asBidders;
    await as1.write.bidOnShape(
      [
        pack([
          { lat: 10, lng: 10 },
          { lat: 10, lng: 11 },
          { lat: 10, lng: 12 },
        ]),
        0n,
        false,
      ],
      { value: 3n * minBid }
    );
    await as2.write.bidOnShape([pack([{ lat: 10, lng: 12 }]), 0n, false], {
      value: 2n * minBid,
    });
    await as3.write.bidOnShape([pack([{ lat: 10, lng: 12 }]), 0n, false], {
      value: 5n * minBid, // 3 * minBid required, 2 * minBid excess
    });
    await as1.write.bidOnShape([pack([{ lat: 10, lng: 10 }]), 0n, true], {
      value: 2n * minBid, // own square raised: minBid required, minBid excess
    });
    await as2.write.bidOnShape([pack([{ lat: 20, lng: 20 }]), 4n * minBid, false], {
      value: 4n * minBid,
    });
    return [5n * minBid, 6n * minBid, 5n * minBid];
  }

  // ETH that `withdraw` sent to the bidder (the balance change plus the gas cost).
  async function withdrawnBy(f: Pausable, i: number) {
    const address = f.bidders[i].account.address;
    const before = await f.publicClient.getBalance({ address });
    const hash = await f.asBidders[i].write.withdraw();
    const { gasUsed, effectiveGasPrice } =
      await f.publicClient.waitForTransactionReceipt({ hash });
    const after = await f.publicClient.getBalance({ address });
    return after - before + gasUsed * effectiveGasPrice;
  }

  it("lets only the admin pause, unpause and cancel before the end", async function () {
    const f = await loadFixture(deployPausable);
    await expect(f.asStranger.write.pause()).to.be.rejectedWith("NotAdmin");
    await f.asAdmin.write.pause();
    expect(await f.auction.read.paused()).to.equal(true);
    await expect(f.asStranger.write.unpause()).to.be.rejectedWith("NotAdmin");
    await expect(f.asStranger.write.cancel()).to.be.rejectedWith("NotAdmin");
    await expect(f.asBidders[0].write.cancel()).to.be.rejectedWith("NotAdmin");
  });

  it("blocks bids while paused and accepts them again after unpause", async function () {
    const f = await loadFixture(deployPausable);
    const [as1] = f.asBidders;
    const loc = { lat: 30, lng: 30 };

    await f.asAdmin.write.pause();
    await expect(f.asAdmin.write.pause()).to.be.rejectedWith("AuctionIsPaused");
    await expect(
      as1.write.bidOnShape([pack([loc]), 0n, false], { value: minBid })
    ).to.be.rejectedWith("AuctionIsPaused");

    await f.asAdmin.write.unpause();
    await expect(f.asAdmin.write.unpause()).to.be.rejectedWith("AuctionNotPaused");
    await expect(as1.write.bidOnShape([pack([loc]), 0n, false], { value: minBid })).to.be
      .fulfilled;
  });

  it("lets outbid bidders withdraw while paused", async function () {
    const f = await loadFixture(deployPausable);
    await placeBids(f);
    await f.asAdmin.write.pause();

    // Bidder 2 was outbid on (10, 12): 2 * minBid.
    expect(await withdrawnBy(f, 1)).to.equal(2n * minBid);
  });

  it("gives bidders at least the extension window after an unpause near the end", async function () {
    const f = await loadFixture(deployPausable);
    await f.asAdmin.write.pause();
    await time.setNextBlockTimestamp(f.end - 10n);
    await f.asAdmin.write.unpause();
    expect(await f.auction.read.endTime()).to.equal(f.end - 10n + window);
  });

  it("does not let the admin pause or unpause after the end", async function () {
    const f = await loadFixture(deployPausable);
    await time.increaseTo(f.end + 1n);
    await expect(f.asAdmin.write.pause()).to.be.rejectedWith(
      "AuctionAlreadyEnded"
    );

    const g = await loadFixture(deployPausable);
    await g.asAdmin.write.pause();
    await time.increaseTo(g.end + 1n);
    await expect(g.asAdmin.write.unpause()).to.be.rejectedWith(
      "AuctionAlreadyEnded"
    );
  });

  it("blocks settlement and proceeds while a pause lasts past the end", async function () {
    const f = await loadFixture(deployPausable);
    await placeBids(f);
    await f.asAdmin.write.pause();
    await time.increaseTo(f.end + 1n);

    await expect(f.asStranger.write.settleShape([1n, 0n])).to.be.rejectedWith(
      "AuctionIsPaused"
    );
    await expect(f.asStranger.write.withdrawProceeds()).to.be.rejectedWith(
      "AuctionIsPaused"
    );
  });

  it("refunds every bidder in full after a cancel", async function () {
    const f = await loadFixture(deployPausable);
    const paid = await placeBids(f);
    const total = paid.reduce((a, b) => a + b, 0n);

    // The bidders' current highest bids add up to the proceeds.
    const active = await Promise.all(
      f.bidders.map((b) => f.auction.read.activeBids([b.account.address]))
    );
    expect(active.reduce((a, b) => a + b, 0n)).to.equal(
      await f.auction.read.proceeds()
    );
    expect(
      await f.publicClient.getBalance({ address: f.auction.address })
    ).to.equal(total);

    await f.asAdmin.write.pause();
    await f.asAdmin.write.cancel();
    expect(await f.auction.read.cancelled()).to.equal(true);
    expect(await f.auction.read.proceeds()).to.equal(0n);

    for (let i = 0; i < 3; i++) {
      expect(await withdrawnBy(f, i)).to.equal(paid[i]);
      expect(
        await f.auction.read.activeBids([f.bidders[i].account.address])
      ).to.equal(0n);
      // A second withdraw sends nothing.
      expect(await withdrawnBy(f, i)).to.equal(0n);
    }
    expect(
      await f.publicClient.getBalance({ address: f.auction.address })
    ).to.equal(0n);
  });

  it("refunds a bidder who withdrew the outbid amounts before the cancel", async function () {
    const f = await loadFixture(deployPausable);
    const paid = await placeBids(f);
    const early = await withdrawnBy(f, 0); // bidder 1: outbid on (10, 12), excess on (10, 10)
    expect(early).to.equal(2n * minBid);

    await f.asAdmin.write.pause();
    await f.asAdmin.write.cancel();
    expect(early + (await withdrawnBy(f, 0))).to.equal(paid[0]);
  });

  it("lets anybody cancel a paused auction after the end", async function () {
    const f = await loadFixture(deployPausable);
    const paid = await placeBids(f);

    await expect(f.asStranger.write.cancel()).to.be.rejectedWith(
      "AuctionNotPaused"
    );
    await f.asAdmin.write.pause();
    await time.increaseTo(f.end + 1n);
    await expect(f.asStranger.write.cancel()).to.be.fulfilled;

    expect(await withdrawnBy(f, 2)).to.equal(paid[2]);
  });

  it("does not let anybody cancel an auction that ended without a pause", async function () {
    const f = await loadFixture(deployPausable);
    await placeBids(f);
    await time.increaseTo(f.end + 1n);
    await expect(f.asAdmin.write.cancel()).to.be.rejectedWith(
      "AuctionNotPaused"
    );
    await expect(f.asStranger.write.withdrawProceeds()).to.be.fulfilled;
  });

  it("stops everything except withdraw after a cancel", async function () {
    const f = await loadFixture(deployPausable);
    await placeBids(f);
    await f.asAdmin.write.pause();
    await f.asAdmin.write.cancel();

    await expect(f.asAdmin.write.cancel()).to.be.rejectedWith(
      "AuctionIsCancelled"
    );
    await expect(f.asAdmin.write.unpause()).to.be.rejectedWith(
      "AuctionIsCancelled"
    );
    await expect(f.asAdmin.write.pause()).to.be.rejectedWith(
      "AuctionIsCancelled"
    );
    await expect(
      f.asBidders[0].write.bidOnShape([pack([{ lat: 40, lng: 40 }]), 0n, false], {
        value: minBid,
      })
    ).to.be.rejectedWith("AuctionIsCancelled");

    await time.increaseTo(f.end + 1n);
    await expect(f.asStranger.write.settleShape([1n, 0n])).to.be.rejectedWith(
      "AuctionIsCancelled"
    );
    await expect(f.asStranger.write.withdrawProceeds()).to.be.rejectedWith(
      "AuctionIsCancelled"
    );
  });

  it("follows the admin role of GaiaCountries", async function () {
    const f = await loadFixture(deployPausable);
    const adminRole = await f.countries.read.DEFAULT_ADMIN_ROLE();
    await f.countries.write.grantRole([adminRole, f.newAdmin.account.address]);
    await f.countries.write.renounceRole([adminRole, f.owner.account.address]);

    await expect(f.asAdmin.write.pause()).to.be.rejectedWith("NotAdmin");
    await f.asNewAdmin.write.pause();
    await expect(f.asAdmin.write.cancel()).to.be.rejectedWith("NotAdmin");
    await f.asNewAdmin.write.cancel();
    expect(await f.auction.read.cancelled()).to.equal(true);
  });

  it("cannot be paused after the admin renounces the role", async function () {
    const f = await loadFixture(deployPausable);
    await f.countries.write.renounceRole([
      await f.countries.read.DEFAULT_ADMIN_ROLE(),
      f.owner.account.address,
    ]);
    await expect(f.asAdmin.write.pause()).to.be.rejectedWith("NotAdmin");
  });
});
