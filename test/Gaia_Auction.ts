import {
  loadFixture,
  time,
} from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import hre from "hardhat";
import { getAddress } from "viem";

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
        owner.account.address, // treasury
        start,
        end,
        minBid,
        1n,    // minShapeSquares
        1000n, // maxShapeSquares
        10n,   // maxShapeAspectRatio
      ]
    );

    await squares.write.grantRole([
      await squares.read.MINTER_ROLE(),
      auction.address,
    ]);
    await countries.write.grantRole([
      await countries.read.AUCTION_ROLE(),
      auction.address,
    ]);

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
        owner.account.address, // treasury
        start,
        end,
        minBid,
        1n,    // minShapeSquares
        1000n, // maxShapeSquares
        10n,   // maxShapeAspectRatio
      ]
    );

    await squares.write.grantRole([
      await squares.read.MINTER_ROLE(),
      auction.address,
    ]);
    await countries.write.grantRole([
      await countries.read.AUCTION_ROLE(),
      auction.address,
    ]);

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
        owner.account.address, // treasury
        start,
        end,
        minBid,
        2n, // minShapeSquares
        6n, // maxShapeSquares
        3n, // maxShapeAspectRatio
      ]
    );

    await squares.write.grantRole([
      await squares.read.MINTER_ROLE(),
      auction.address,
    ]);
    await countries.write.grantRole([
      await countries.read.AUCTION_ROLE(),
      auction.address,
    ]);

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
        owner.account.address, // treasury
        start,
        end,
        minBid,
        2n,    // minShapeSquares
        1000n, // maxShapeSquares
        10n,   // maxShapeAspectRatio
      ]
    );

    await squares.write.grantRole([
      await squares.read.MINTER_ROLE(),
      auction.address,
    ]);
    await countries.write.grantRole([
      await countries.read.AUCTION_ROLE(),
      auction.address,
    ]);

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

describe("GaiaAuction: settleShape", function () {
  async function deploySettle() {
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
    const auction = await hre.viem.deployContract(
      "contracts/GaiaAuction.sol:GaiaAuction",
      [
        squares.address,
        countries.address,
        owner.account.address, // treasury
        start,
        end,
        minBid,
        1n, // minShapeSquares
        1000n, // maxShapeSquares
        10n, // maxShapeAspectRatio
      ]
    );

    await squares.write.grantRole([
      await squares.read.MINTER_ROLE(),
      auction.address,
    ]);
    await countries.write.grantRole([
      await countries.read.AUCTION_ROLE(),
      auction.address,
    ]);

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

    return {
      owner,
      bidder1,
      bidder2,
      squares,
      countries,
      auction,
      auctionAs1,
      auctionAs2,
      minBid,
      end,
    };
  }

  it("mints the winner's squares to Country1155 custody and mints the country on completion", async function () {
    const { auctionAs1, bidder1, squares, countries, minBid, end } =
      await loadFixture(deploySettle);

    const shape = [
      { lat: 10, lng: 10 },
      { lat: 10, lng: 11 },
      { lat: 10, lng: 12 },
    ];
    await auctionAs1.write.bidOnShape([shape], {
      value: minBid * BigInt(shape.length),
    });

    await time.increaseTo(end + 1n);

    const shapeId = 1n;
    await expect(auctionAs1.write.settleShape([shapeId, 0n])).to.be.fulfilled;

    const balance = await countries.read.balanceOf([
      bidder1.account.address,
      shapeId,
    ]);
    expect(balance).to.equal(1n);

    const tokenIds = await countries.read.getSquares([shapeId]);
    expect(tokenIds.length).to.equal(shape.length);

    for (const loc of shape) {
      const owner = await squares.read.ownerOfLoc([loc.lat, loc.lng]);
      expect(getAddress(owner)).to.equal(getAddress(countries.address));
    }
  });

  it("only mints the country once fully settled across paginated calls", async function () {
    const { auctionAs1, bidder1, countries, minBid, end } = await loadFixture(
      deploySettle
    );

    const shape = [
      { lat: 20, lng: 10 },
      { lat: 20, lng: 11 },
      { lat: 20, lng: 12 },
      { lat: 20, lng: 13 },
    ];
    await auctionAs1.write.bidOnShape([shape], {
      value: minBid * BigInt(shape.length),
    });

    await time.increaseTo(end + 1n);

    const shapeId = 1n;

    await auctionAs1.write.settleShape([shapeId, 2n]);
    expect(
      await countries.read.balanceOf([bidder1.account.address, shapeId])
    ).to.equal(0n);

    await expect(auctionAs1.write.settleShape([shapeId, 2n])).to.be.fulfilled;
    expect(
      await countries.read.balanceOf([bidder1.account.address, shapeId])
    ).to.equal(1n);

    const tokenIds = await countries.read.getSquares([shapeId]);
    expect(tokenIds.length).to.equal(shape.length);
  });

  it("skips squares overtaken by a later bid and settles them under the new shape", async function () {
    const { auctionAs1, auctionAs2, bidder1, bidder2, countries, minBid, end } =
      await loadFixture(deploySettle);

    const aliceShape = [
      { lat: 30, lng: 10 },
      { lat: 30, lng: 11 },
      { lat: 30, lng: 12 },
    ];
    await auctionAs1.write.bidOnShape([aliceShape], {
      value: minBid * BigInt(aliceShape.length),
    });

    // Bob takes over the last square of Alice's shape.
    const bobShape = [{ lat: 30, lng: 12 }];
    await auctionAs2.write.bidOnShape([bobShape], { value: minBid * 2n });

    await time.increaseTo(end + 1n);

    const aliceShapeId = 1n;
    const bobShapeId = 2n;

    await auctionAs1.write.settleShape([aliceShapeId, 0n]);
    await auctionAs2.write.settleShape([bobShapeId, 0n]);

    const aliceTokens = await countries.read.getSquares([aliceShapeId]);
    const bobTokens = await countries.read.getSquares([bobShapeId]);
    expect(aliceTokens.length).to.equal(2); // (30,10) and (30,11)
    expect(bobTokens.length).to.equal(1); // (30,12), no double-mint

    expect(
      await countries.read.balanceOf([bidder1.account.address, aliceShapeId])
    ).to.equal(1n);
    expect(
      await countries.read.balanceOf([bidder2.account.address, bobShapeId])
    ).to.equal(1n);
  });

  it("settles a fully-overtaken shape without minting a country", async function () {
    const { auctionAs1, auctionAs2, bidder1, countries, minBid, end } =
      await loadFixture(deploySettle);

    const aliceShape = [
      { lat: 40, lng: 10 },
      { lat: 40, lng: 11 },
    ];
    await auctionAs1.write.bidOnShape([aliceShape], {
      value: minBid * BigInt(aliceShape.length),
    });

    // Bob fully overtakes Alice's shape.
    await auctionAs2.write.bidOnShape([aliceShape], {
      value: (minBid + minBid) * BigInt(aliceShape.length),
    });

    await time.increaseTo(end + 1n);

    const aliceShapeId = 1n;
    await expect(auctionAs1.write.settleShape([aliceShapeId, 0n])).to.be
      .fulfilled;

    expect(
      await countries.read.balanceOf([bidder1.account.address, aliceShapeId])
    ).to.equal(0n);
    expect(await countries.read.getSquares([aliceShapeId])).to.have.length(0);
  });

  it("reverts when settling before the auction has ended", async function () {
    const { auctionAs1, minBid } = await loadFixture(deploySettle);

    const shape = [{ lat: 50, lng: 10 }];
    await auctionAs1.write.bidOnShape([shape], { value: minBid });

    await expect(auctionAs1.write.settleShape([1n, 0n])).to.be.rejected; // AuctionNotYetEnded
  });

  it("reverts when settling an unknown shape id", async function () {
    const { auctionAs1, end } = await loadFixture(deploySettle);

    await time.increaseTo(end + 1n);

    await expect(auctionAs1.write.settleShape([999n, 0n])).to.be.rejected; // UnknownShape
  });

  it("reverts when settling an already-settled shape", async function () {
    const { auctionAs1, minBid, end } = await loadFixture(deploySettle);

    const shape = [{ lat: 60, lng: 10 }];
    await auctionAs1.write.bidOnShape([shape], { value: minBid });

    await time.increaseTo(end + 1n);

    await auctionAs1.write.settleShape([1n, 0n]);
    await expect(auctionAs1.write.settleShape([1n, 0n])).to.be.rejected; // ShapeAlreadySettled
  });

  it("rejects a bid with lat out of range", async function () {
    const { auctionAs1, minBid } = await loadFixture(deploySettle);

    const shape = [{ lat: 18000, lng: 10 }];
    await expect(
      auctionAs1.write.bidOnShape([shape], { value: minBid })
    ).to.be.rejectedWith("InvalidCoordinates");
  });

  it("rejects a bid with lng out of range", async function () {
    const { auctionAs1, minBid } = await loadFixture(deploySettle);

    const shape = [
      { lat: 10, lng: 35999 },
      { lat: 10, lng: 36000 },
    ];
    await expect(
      auctionAs1.write.bidOnShape([shape], { value: minBid * 2n })
    ).to.be.rejectedWith("InvalidCoordinates");
  });

  it("settles a shape on the last valid row and column", async function () {
    const { auctionAs1, bidder1, countries, minBid, end } = await loadFixture(
      deploySettle
    );

    const shape = [
      { lat: 17998, lng: 35998 },
      { lat: 17998, lng: 35999 },
      { lat: 17999, lng: 35998 },
      { lat: 17999, lng: 35999 },
    ];
    await auctionAs1.write.bidOnShape([shape], {
      value: minBid * BigInt(shape.length),
    });

    await time.increaseTo(end + 1n);

    const shapeId = 1n;
    await expect(auctionAs1.write.settleShape([shapeId, 0n])).to.be.fulfilled;
    expect(
      await countries.read.balanceOf([bidder1.account.address, shapeId])
    ).to.equal(1n);
    expect(await countries.read.getSquares([shapeId])).to.have.length(
      shape.length
    );
  });
});

describe("GaiaAuction: shapes that cross the antimeridian", function () {
  async function deployAntimeridian() {
    const [owner, bidder1, bidder2] = await hre.viem.getWalletClients();

    const squares = await hre.viem.deployContract("GaiaLocation721", [
      owner.account.address,
    ]);
    const countries = await hre.viem.deployContract("Country1155", [
      owner.account.address,
      "ipfs://",
    ]);

    const publicClient = await hre.viem.getPublicClient();
    const now = (await publicClient.getBlock()).timestamp;
    const start = now - 10n;
    const end = now + 3600n;
    const minBid = 1000n;
    const auction = await hre.viem.deployContract(
      "contracts/GaiaAuction.sol:GaiaAuction",
      [
        squares.address,
        countries.address,
        owner.account.address, // treasury
        start,
        end,
        minBid,
        2n, // minShapeSquares
        1000n, // maxShapeSquares
        3n, // maxShapeAspectRatio
      ]
    );

    await squares.write.grantRole([
      await squares.read.MINTER_ROLE(),
      auction.address,
    ]);
    await countries.write.grantRole([
      await countries.read.AUCTION_ROLE(),
      auction.address,
    ]);

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

    return {
      bidder1,
      squares,
      countries,
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
    const { auctionAs1, bidder1, squares, countries, minBid, end } =
      await loadFixture(deployAntimeridian);

    const shape = crossingRect(50);
    await expect(
      auctionAs1.write.bidOnShape([shape], {
        value: minBid * BigInt(shape.length),
      })
    ).to.be.fulfilled;

    await time.increaseTo(end + 1n);

    const shapeId = 1n;
    await expect(auctionAs1.write.settleShape([shapeId, 0n])).to.be.fulfilled;
    expect(
      await countries.read.balanceOf([bidder1.account.address, shapeId])
    ).to.equal(1n);
    expect(await countries.read.getSquares([shapeId])).to.have.length(
      shape.length
    );
    for (const loc of shape) {
      const owner = await squares.read.ownerOfLoc([loc.lat, loc.lng]);
      expect(getAddress(owner)).to.equal(getAddress(countries.address));
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
      auctionAs1.write.bidOnShape([shape], { value: minBid * 3n })
    ).to.be.rejectedWith("GapBetweenLongitudes");
  });

  it("rejects a crossing shape that is not sorted west to east", async function () {
    const { auctionAs1, minBid } = await loadFixture(deployAntimeridian);

    const shape = [
      { lat: 50, lng: 0 },
      { lat: 50, lng: 35999 },
    ];
    await expect(
      auctionAs1.write.bidOnShape([shape], { value: minBid * 2n })
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
      auctionAs1.write.bidOnShape([shape], {
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
      auctionAs1.write.bidOnShape([narrow], { value: minBid * 3n })
    ).to.be.fulfilled;

    // 1 x 4 → ratio 4 > maxShapeAspectRatio.
    const wide = [
      { lat: 60, lng: 35998 },
      { lat: 60, lng: 35999 },
      { lat: 60, lng: 0 },
      { lat: 60, lng: 1 },
    ];
    await expect(
      auctionAs1.write.bidOnShape([wide], { value: minBid * 4n })
    ).to.be.rejectedWith("AspectRatioExceeded");
  });

  it("permits an overlap on a crossing shape that leaves a valid remainder", async function () {
    const { auctionAs1, auctionAs2, countries, minBid, end } =
      await loadFixture(deployAntimeridian);

    const aliceShape = crossingRect(70);
    await auctionAs1.write.bidOnShape([aliceShape], {
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
      auctionAs2.write.bidOnShape([bobShape], {
        value: (minBid + minBid) * BigInt(bobShape.length),
      })
    ).to.be.fulfilled;

    await time.increaseTo(end + 1n);

    await auctionAs1.write.settleShape([1n, 0n]);
    await auctionAs2.write.settleShape([2n, 0n]);
    expect(await countries.read.getSquares([1n])).to.have.length(4);
    expect(await countries.read.getSquares([2n])).to.have.length(4);
  });

  it("rejects an overlap on a crossing shape that splits the remainder", async function () {
    const { auctionAs1, auctionAs2, minBid } = await loadFixture(
      deployAntimeridian
    );

    const aliceShape = crossingRect(80);
    await auctionAs1.write.bidOnShape([aliceShape], {
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
      auctionAs2.write.bidOnShape([bobShape], {
        value: (minBid + minBid) * BigInt(bobShape.length),
      })
    ).to.be.rejectedWith("GapBetweenLongitudes");
  });
});

describe("GaiaAuction: treasury proceeds", function () {
  async function deployProceeds() {
    const [owner, bidder1, bidder2, treasury] =
      await hre.viem.getWalletClients();
    const publicClient = await hre.viem.getPublicClient();

    const squares = await hre.viem.deployContract("GaiaLocation721", [
      owner.account.address,
    ]);
    const countries = await hre.viem.deployContract("Country1155", [
      owner.account.address,
      "ipfs://",
    ]);

    const now = (await publicClient.getBlock()).timestamp;
    const start = now - 10n;
    const end = now + 3600n;
    const minBid = 1000n;
    const auction = await hre.viem.deployContract(
      "contracts/GaiaAuction.sol:GaiaAuction",
      [
        squares.address,
        countries.address,
        treasury.account.address,
        start,
        end,
        minBid,
        1n, // minShapeSquares
        1000n, // maxShapeSquares
        10n, // maxShapeAspectRatio
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
        [
          { lat: 10, lng: 10 },
          { lat: 10, lng: 11 },
          { lat: 10, lng: 12 },
        ],
      ],
      { value: minBid * 3n }
    );
    await auctionAs2.write.bidOnShape([[{ lat: 10, lng: 12 }]], {
      value: minBid * 2n,
    });
    await auctionAs1.write.bidOnShape(
      [
        [
          { lat: 20, lng: 10 },
          { lat: 20, lng: 11 },
        ],
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

    await auctionAs2.write.bidOnShape([[{ lat: 30, lng: 10 }]], {
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

    await expect(f.auctionAs1.write.withdrawProceeds()).to.be.rejected; // AuctionNotYetEnded
  });
});
