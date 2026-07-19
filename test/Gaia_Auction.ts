import { loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import hre from "hardhat";

describe("GaiaAuction::_validateConvexShape via bidOnShape", function () {
  async function deployAll() {
    const [owner] = await hre.viem.getWalletClients();

    const squares = await hre.viem.deployContract("GaiaLocation721", [
      owner.account.address,
    ]);
    const countries = await hre.viem.deployContract("Country1155", [
      owner.account.address,
      "ipfs://",
    ]);

    const now = Math.floor(Date.now() / 1000);
    const start = BigInt(now - 10);
    const end = BigInt(now + 3600);
    const minBid = 1000n;
    const auction = await hre.viem.deployContract(
      "contracts/GaiaAuction.sol:GaiaAuction",
      [
        squares.address,
        countries.address,
        start,
        end,
        minBid,
        1n,    // minShapeSquares
        1000n, // maxShapeSquares
        10n,   // maxShapeAspectRatio
      ]
    );

    return { owner, squares, countries, auction, minBid };
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
    await expect(auction.write.bidOnShape([shape], { value: total })).to.be
      .fulfilled;
  });

  it("rejects gap between longitudes in the same row", async function () {
    const { auction } = await loadFixture(deployAll);
    const shape = [
      { lat: 33, lng: 69 },
      { lat: 33, lng: 71 }, // gap
    ];
    await expect(auction.write.bidOnShape([shape])).to.be.rejected; // GapBetweenLongitudes
  });

  it("rejects non-consecutive latitudes", async function () {
    const { auction } = await loadFixture(deployAll);
    const shape = [
      { lat: 33, lng: 69 },
      { lat: 33, lng: 70 },
      // skip 34
      { lat: 35, lng: 69 },
    ];
    await expect(auction.write.bidOnShape([shape])).to.be.rejected; // NonConsecutiveLatitudes
  });

  it("rejects unsorted latitudes (descending)", async function () {
    const { auction } = await loadFixture(deployAll);
    const shape = [
      { lat: 34, lng: 69 },
      { lat: 34, lng: 70 },
      { lat: 33, lng: 69 }, // goes backward
    ];
    await expect(auction.write.bidOnShape([shape])).to.be.rejected; // Unsorted
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
    await expect(auction.write.bidOnShape([shape])).to.be.rejected; // NoLatAdjacency
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
    await expect(auction.write.bidOnShape([shape])).to.be.rejected; // NotConvexStart
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
    await expect(auction.write.bidOnShape([shape])).to.be.rejected; // NotConvexEnd
  });

  it("rejects empty shapes", async function () {
    const { auction } = await loadFixture(deployAll);
    await expect(auction.write.bidOnShape([[]])).to.be.rejected; // EmptyShape
  });

  it("accepts a single cell", async function () {
    const { auction, minBid } = await loadFixture(deployAll);
    const shape = [{ lat: 40, lng: 10 }];
    const total = minBid * 1n;
    await expect(auction.write.bidOnShape([shape], { value: total })).to.be
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
    await expect(auction.write.bidOnShape([shape], { value: total })).to.be
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
    await expect(auction.write.bidOnShape([shape], { value: total })).to.be
      .fulfilled;
  });

  it("rejects duplicate coordinate in same row (not +1)", async function () {
    const { auction } = await loadFixture(deployAll);
    const shape = [
      { lat: 33, lng: 69 },
      { lat: 33, lng: 69 },
    ];
    await expect(auction.write.bidOnShape([shape])).to.be.rejected; // GapBetweenLongitudes
  });

  it("rejects decreasing longitude within a row", async function () {
    const { auction } = await loadFixture(deployAll);
    const shape = [
      { lat: 33, lng: 70 },
      { lat: 33, lng: 69 },
    ];
    await expect(auction.write.bidOnShape([shape])).to.be.rejected; // GapBetweenLongitudes
  });
});

describe("GaiaAuction: totals and refunds", function () {
  async function deployAll() {
    const [owner, other] = await hre.viem.getWalletClients();

    const squares = await hre.viem.deployContract("GaiaLocation721", [
      owner.account.address,
    ]);
    const countries = await hre.viem.deployContract("Country1155", [
      owner.account.address,
      "ipfs://",
    ]);

    const now = Math.floor(Date.now() / 1000);
    const start = BigInt(now - 10);
    const end = BigInt(now + 3600);
    const minBid = 1000n;
    const auction = await hre.viem.deployContract(
      "contracts/GaiaAuction.sol:GaiaAuction",
      [
        squares.address,
        countries.address,
        start,
        end,
        minBid,
        1n,    // minShapeSquares
        1000n, // maxShapeSquares
        10n,   // maxShapeAspectRatio
      ]
    );

    return { owner, other, squares, countries, auction, minBid };
  }

  it("computes total as minBid per new square", async function () {
    const { auction, minBid } = await loadFixture(deployAll);
    const shape = [
      { lat: 10, lng: 10 },
      { lat: 10, lng: 11 },
      { lat: 10, lng: 12 },
    ];
    const total = minBid * 3n;
    await expect(auction.write.bidOnShape([shape], { value: total })).to.be
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
    await auction.write.bidOnShape([shape], { value: minBid * 2n });

    // Second bidder (other) must pay next step per square (minBid + minBid)
    const auctionAsOther = await hre.viem.getContractAt(
      "contracts/GaiaAuction.sol:GaiaAuction",
      auction.address,
      { client: { wallet: other } }
    );
    const requiredNext = (minBid + minBid) * 2n;
    await expect(
      auctionAsOther.write.bidOnShape([shape], { value: requiredNext })
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

    await auction.write.bidOnShape([shape], { value: minBid * 2n });

    const auctionAsOther = await hre.viem.getContractAt(
      "contracts/GaiaAuction.sol:GaiaAuction",
      auction.address,
      { client: { wallet: other } }
    );
    await auctionAsOther.write.bidOnShape([shape], {
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
    await auction.write.bidOnShape([first], { value: minBid * 2n });

    // Second bid includes the two existing + one new
    const second = [
      { lat: 30, lng: 30 }, // existing → requires 2*minBid
      { lat: 30, lng: 31 }, // existing → requires 2*minBid
      { lat: 30, lng: 32 }, // new → requires minBid
    ];
    const expected = (minBid + minBid) * 2n + minBid; // 5 * minBid
    await expect(auction.write.bidOnShape([second], { value: expected })).to.be
      .fulfilled;

    const b2 = await auction.read.highestBids([30, 32]);
    expect(b2[1]).to.equal(minBid);
  });

  it("reverts when value is insufficient for the required total", async function () {
    const { auction, minBid } = await loadFixture(deployAll);
    const shape = [
      { lat: 40, lng: 40 },
      { lat: 40, lng: 41 },
      { lat: 40, lng: 42 },
    ];
    const total = minBid * 3n;
    await expect(auction.write.bidOnShape([shape], { value: total - 1n })).to.be
      .rejected; // InsufficientValue
  });
});

describe("GaiaAuction: shape size and aspect-ratio bounds", function () {
  async function deployBounded() {
    const [owner] = await hre.viem.getWalletClients();

    const squares = await hre.viem.deployContract("GaiaLocation721", [
      owner.account.address,
    ]);
    const countries = await hre.viem.deployContract("Country1155", [
      owner.account.address,
      "ipfs://",
    ]);

    const now = Math.floor(Date.now() / 1000);
    const start = BigInt(now - 10);
    const end = BigInt(now + 3600);
    const minBid = 1000n;
    // minShapeSquares=2, maxShapeSquares=6, maxShapeAspectRatio=3
    const auction = await hre.viem.deployContract(
      "contracts/GaiaAuction.sol:GaiaAuction",
      [
        squares.address,
        countries.address,
        start,
        end,
        minBid,
        2n, // minShapeSquares
        6n, // maxShapeSquares
        3n, // maxShapeAspectRatio
      ]
    );

    return { owner, squares, countries, auction, minBid };
  }

  it("rejects a single-square bid when minShapeSquares=2", async function () {
    const { auction, minBid } = await loadFixture(deployBounded);
    const shape = [{ lat: 50, lng: 50 }];
    await expect(
      auction.write.bidOnShape([shape], { value: minBid })
    ).to.be.rejected; // ShapeTooSmall
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
      auction.write.bidOnShape([shape], { value: total })
    ).to.be.rejected; // ShapeTooLarge
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
    await expect(auction.write.bidOnShape([shape], { value: total })).to.be
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
      auction.write.bidOnShape([shape], { value: total })
    ).to.be.rejected; // AspectRatioExceeded
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
      auction.write.bidOnShape([shape], { value: total })
    ).to.be.rejected; // AspectRatioExceeded
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
    await expect(auction.write.bidOnShape([shape], { value: total })).to.be
      .fulfilled;
  });
});

describe("GaiaAuction: anti-griefing overlap rules", function () {
  async function deployAntiGrief() {
    const [owner, bidder1, bidder2] = await hre.viem.getWalletClients();

    const squares = await hre.viem.deployContract("GaiaLocation721", [
      owner.account.address,
    ]);
    const countries = await hre.viem.deployContract("Country1155", [
      owner.account.address,
      "ipfs://",
    ]);

    const now = Math.floor(Date.now() / 1000);
    const start = BigInt(now - 10);
    const end = BigInt(now + 3600);
    const minBid = 1000n;
    // minShapeSquares=2 so single-square remainders are invalid
    const auction = await hre.viem.deployContract(
      "contracts/GaiaAuction.sol:GaiaAuction",
      [
        squares.address,
        countries.address,
        start,
        end,
        minBid,
        2n,    // minShapeSquares
        1000n, // maxShapeSquares
        10n,   // maxShapeAspectRatio
      ]
    );

    const auctionAs1 = await hre.viem.getContractAt(
      "contracts/GaiaAuction.sol:GaiaAuction",
      auction.address,
      { client: { wallet: bidder1 } }
    );
    const auctionAs2 = await hre.viem.getContractAt(
      "contracts/GaiaAuction.sol:GaiaAuction",
      auction.address,
      { client: { wallet: bidder2 } }
    );

    return { owner, bidder1, bidder2, auction, auctionAs1, auctionAs2, minBid };
  }

  // Alice holds a 1×3 row: (80,10), (80,11), (80,12)
  // Bob bids on just (80,11) — the middle square — leaving Alice with
  // (80,10) and (80,12) which have a gap: invalid remainder.
  it("rejects a single-square bid that would leave a gap in an existing shape", async function () {
    const { auction, auctionAs2, minBid } = await loadFixture(deployAntiGrief);

    const aliceShape = [
      { lat: 80, lng: 10 },
      { lat: 80, lng: 11 },
      { lat: 80, lng: 12 },
    ];
    await auction.write.bidOnShape([aliceShape], {
      value: minBid * BigInt(aliceShape.length),
    });

    const bobShape = [{ lat: 80, lng: 11 }];
    await expect(
      auctionAs2.write.bidOnShape([bobShape], { value: minBid * 2n })
    ).to.be.rejected; // GapBetweenLongitudes in remainder
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
    await auction.write.bidOnShape([aliceShape], {
      value: minBid * BigInt(aliceShape.length),
    });

    // Bob takes the left 2 squares — Alice's remainder (80,22)+(80,23) is a valid 1×2 row
    const bobShape = [
      { lat: 80, lng: 20 },
      { lat: 80, lng: 21 },
    ];
    const nextBid = minBid + minBid; // 2nd bid on these squares
    await expect(
      auctionAs2.write.bidOnShape([bobShape], {
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
    await auction.write.bidOnShape([aliceShape], {
      value: minBid * BigInt(aliceShape.length),
    });

    const bobShape = [
      { lat: 80, lng: 30 },
      { lat: 80, lng: 31 },
      { lat: 80, lng: 32 },
    ];
    const requiredNext = (minBid + minBid) * BigInt(bobShape.length);
    await expect(
      auctionAs2.write.bidOnShape([bobShape], { value: requiredNext })
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
    await auction.write.bidOnShape([aliceShape], {
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
      auctionAs2.write.bidOnShape([bobShape], { value: requiredNext })
    ).to.be.fulfilled;
  });

  // Alice has a 1×3 row. Bob bids on just the middle, which would leave a disconnected
  // row-pair with a gap. Tests that the NoLatAdjacency / GapBetweenLongitudes check fires
  // for the simulated remainder.
  it("rejects an overlap that would leave a non-contiguous remainder across rows", async function () {
    const { auction, auctionAs2, minBid } = await loadFixture(deployAntiGrief);

    // Alice: 2 rows that only overlap at lng=41
    const aliceShape = [
      { lat: 100, lng: 40 },
      { lat: 100, lng: 41 },
      { lat: 100, lng: 42 },
      { lat: 101, lng: 41 },
      { lat: 101, lng: 42 },
      { lat: 101, lng: 43 },
    ];
    await auction.write.bidOnShape([aliceShape], {
      value: minBid * BigInt(aliceShape.length),
    });

    // Bob takes only (100,41) — the sole overlap cell — breaking adjacency between rows.
    const bobShape = [{ lat: 100, lng: 41 }];
    await expect(
      auctionAs2.write.bidOnShape([bobShape], { value: minBid * 2n })
    ).to.be.rejected; // NoLatAdjacency in remainder
  });
});
