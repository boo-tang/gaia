import { expect } from "chai";

import {
  sortLocs,
  validateShape,
  nextBidFor,
  bidAmountFor,
  computeBidTotal,
  squareCostFor,
} from "../frontend/src/utils/shape";

const limits = {
  minShapeSquares: 1n,
  maxShapeSquares: 1000n,
  maxShapeAspectRatio: 10n,
};

describe("utils/shape (mirrors GaiaAuction.sol shape validation)", function () {
  it("accepts a valid convex, contiguous shape across rows", function () {
    const shape = [
      { lat: 33, lng: 69 },
      { lat: 33, lng: 70 },
      { lat: 33, lng: 71 },
      { lat: 34, lng: 68 },
      { lat: 34, lng: 69 },
      { lat: 34, lng: 70 },
      { lat: 34, lng: 71 },
      { lat: 35, lng: 69 },
      { lat: 35, lng: 70 },
      { lat: 35, lng: 71 },
    ];
    expect(validateShape(shape, limits)).to.deep.equal({ valid: true });
  });

  it("rejects gap between longitudes in the same row", function () {
    const shape = [
      { lat: 33, lng: 69 },
      { lat: 33, lng: 71 },
    ];
    expect(validateShape(shape, limits).valid).to.be.false;
  });

  it("rejects non-consecutive latitudes", function () {
    const shape = [
      { lat: 33, lng: 69 },
      { lat: 33, lng: 70 },
      { lat: 35, lng: 69 },
    ];
    expect(validateShape(shape, limits).valid).to.be.false;
  });

  it("rejects unsorted latitudes (descending)", function () {
    const shape = [
      { lat: 34, lng: 69 },
      { lat: 34, lng: 70 },
      { lat: 33, lng: 69 },
    ];
    expect(validateShape(shape, limits).valid).to.be.false;
  });

  it("rejects when subsequent latitude has no overlapping longitudes with previous", function () {
    const shape = [
      { lat: 33, lng: 69 },
      { lat: 33, lng: 70 },
      { lat: 34, lng: 72 },
      { lat: 34, lng: 73 },
    ];
    expect(validateShape(shape, limits).valid).to.be.false;
  });

  it("rejects concave start (left boundary)", function () {
    const shape = [
      { lat: 33, lng: 69 },
      { lat: 33, lng: 70 },
      { lat: 34, lng: 70 },
      { lat: 34, lng: 71 },
      { lat: 35, lng: 69 },
      { lat: 35, lng: 70 },
    ];
    expect(validateShape(shape, limits).valid).to.be.false;
  });

  it("rejects concave end (right boundary)", function () {
    const shape = [
      { lat: 33, lng: 69 },
      { lat: 33, lng: 70 },
      { lat: 33, lng: 71 },
      { lat: 34, lng: 69 },
      { lat: 34, lng: 70 },
      { lat: 35, lng: 69 },
      { lat: 35, lng: 70 },
      { lat: 35, lng: 71 },
    ];
    expect(validateShape(shape, limits).valid).to.be.false;
  });

  it("rejects empty shapes", function () {
    expect(validateShape([], limits).valid).to.be.false;
  });

  it("accepts a single cell", function () {
    expect(validateShape([{ lat: 40, lng: 10 }], limits)).to.deep.equal({ valid: true });
  });

  it("accepts a single contiguous row", function () {
    const shape = [
      { lat: 20, lng: 10 },
      { lat: 20, lng: 11 },
      { lat: 20, lng: 12 },
      { lat: 20, lng: 13 },
      { lat: 20, lng: 14 },
    ];
    expect(validateShape(shape, limits)).to.deep.equal({ valid: true });
  });

  it("accepts rows that overlap on a single edge cell", function () {
    const shape = [
      { lat: 10, lng: 10 },
      { lat: 10, lng: 11 },
      { lat: 10, lng: 12 },
      { lat: 11, lng: 12 },
      { lat: 11, lng: 13 },
      { lat: 11, lng: 14 },
      { lat: 12, lng: 13 },
      { lat: 12, lng: 14 },
    ];
    expect(validateShape(shape, limits)).to.deep.equal({ valid: true });
  });

  it("rejects duplicate coordinate in same row (not +1)", function () {
    const shape = [
      { lat: 33, lng: 69 },
      { lat: 33, lng: 69 },
    ];
    expect(validateShape(shape, limits).valid).to.be.false;
  });

  it("rejects shapes smaller than minShapeSquares", function () {
    const stricterLimits = { ...limits, minShapeSquares: 3n };
    const shape = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 1 },
    ];
    expect(validateShape(shape, stricterLimits).valid).to.be.false;
  });

  it("rejects shapes larger than maxShapeSquares", function () {
    const stricterLimits = { ...limits, maxShapeSquares: 2n };
    const shape = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 1 },
      { lat: 0, lng: 2 },
    ];
    expect(validateShape(shape, stricterLimits).valid).to.be.false;
  });

  it("rejects shapes exceeding the max aspect ratio", function () {
    const stricterLimits = { ...limits, maxShapeAspectRatio: 2n };
    // 1 row x 5 cols => aspect ratio 5:1, exceeds 2:1
    const shape = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 1 },
      { lat: 0, lng: 2 },
      { lat: 0, lng: 3 },
      { lat: 0, lng: 4 },
    ];
    expect(validateShape(shape, stricterLimits).valid).to.be.false;
  });

  it("sortLocs sorts by lat asc, then lng asc", function () {
    const shape = [
      { lat: 1, lng: 5 },
      { lat: 0, lng: 2 },
      { lat: 1, lng: 3 },
      { lat: 0, lng: 1 },
    ];
    expect(sortLocs(shape)).to.deep.equal([
      { lat: 0, lng: 1 },
      { lat: 0, lng: 2 },
      { lat: 1, lng: 3 },
      { lat: 1, lng: 5 },
    ]);
  });

  it("sortLocs sorts a crossing shape west to east across the antimeridian", function () {
    const shape = [
      { lat: 1, lng: 0 },
      { lat: 0, lng: 1 },
      { lat: 1, lng: 35999 },
      { lat: 0, lng: 35998 },
      { lat: 0, lng: 0 },
      { lat: 0, lng: 35999 },
    ];
    expect(sortLocs(shape)).to.deep.equal([
      { lat: 0, lng: 35998 },
      { lat: 0, lng: 35999 },
      { lat: 0, lng: 0 },
      { lat: 0, lng: 1 },
      { lat: 1, lng: 35999 },
      { lat: 1, lng: 0 },
    ]);
  });

  it("accepts a valid shape that crosses the antimeridian", function () {
    const shape = sortLocs([
      { lat: 50, lng: 35998 },
      { lat: 50, lng: 35999 },
      { lat: 50, lng: 0 },
      { lat: 50, lng: 1 },
      { lat: 51, lng: 35998 },
      { lat: 51, lng: 35999 },
      { lat: 51, lng: 0 },
      { lat: 51, lng: 1 },
    ]);
    expect(validateShape(shape, limits)).to.deep.equal({ valid: true });
  });

  it("rejects a crossing shape with a gap", function () {
    const shape = sortLocs([
      { lat: 50, lng: 35998 },
      { lat: 50, lng: 35999 },
      { lat: 50, lng: 1 },
    ]);
    expect(validateShape(shape, limits).valid).to.be.false;
  });

  it("uses the real width of a crossing shape for the aspect ratio", function () {
    const stricterLimits = { ...limits, maxShapeAspectRatio: 3n };
    const narrow = sortLocs([
      { lat: 50, lng: 35999 },
      { lat: 50, lng: 0 },
      { lat: 50, lng: 1 },
    ]);
    const wide = sortLocs([...narrow, { lat: 50, lng: 35998 }]);
    expect(validateShape(narrow, stricterLimits)).to.deep.equal({ valid: true });
    expect(validateShape(wide, stricterLimits).valid).to.be.false;
  });
});

describe("utils/shape bid totals (mirrors GaiaAuction.sol._nextBid, _bidAmount and _squareCost)", function () {
  const minBid = 1000n;
  const rules = { minBidPerSquareWei: minBid, minBidIncrementBps: 500n };

  it("nextBidFor requires minBid for an unbid square", function () {
    expect(nextBidFor(0n, rules)).to.equal(minBid);
  });

  it("nextBidFor adds minBid when it is larger than the percentage", function () {
    expect(nextBidFor(minBid, rules)).to.equal(minBid + minBid);
  });

  it("nextBidFor adds the percentage when it is larger than minBid", function () {
    expect(nextBidFor(100_000n, rules)).to.equal(105_000n);
  });

  it("bidAmountFor uses floorPerSquare only when it is above the next bid", function () {
    expect(bidAmountFor(0n, rules, 5000n)).to.equal(5000n);
    expect(bidAmountFor(10_000n, rules, 5000n)).to.equal(11_000n);
  });

  const other = (amount: bigint) => ({ amount, own: false });
  const own = (amount: bigint) => ({ amount, own: true });

  it("computeBidTotal sums bidAmountFor across squares of other bidders", function () {
    expect(computeBidTotal([other(0n), other(minBid), other(0n)], rules)).to.equal(
      minBid + (minBid + minBid) + minBid,
    );
    expect(computeBidTotal([other(0n), other(10_000n)], rules, 5000n)).to.equal(5000n + 11_000n);
  });

  it("squareCostFor charges 0 for an own square when raiseOwnSquares is false", function () {
    expect(squareCostFor(own(minBid), rules)).to.equal(0n);
    expect(squareCostFor(own(minBid), rules, 5000n, false)).to.equal(0n);
  });

  it("squareCostFor charges only the increase for an own square when raiseOwnSquares is true", function () {
    expect(squareCostFor(own(minBid), rules, 0n, true)).to.equal(minBid);
    expect(squareCostFor(own(minBid), rules, 2500n, true)).to.equal(1500n);
    expect(squareCostFor(own(100_000n), rules, 0n, true)).to.equal(5000n);
  });

  it("computeBidTotal matches a re-bid after a partial takeover", function () {
    // Same case as the GaiaAuction test: three own squares at minBid, one lost square at 2 * minBid.
    const current = [own(minBid), own(minBid), own(minBid), other(2n * minBid)];
    expect(computeBidTotal(current, rules)).to.equal(3n * minBid);
    expect(computeBidTotal(current, rules, 5n * minBid)).to.equal(5n * minBid);
    expect(computeBidTotal(current, rules, 0n, true)).to.equal(6n * minBid);
    expect(computeBidTotal(current, rules, 2500n, true)).to.equal(3n * 1500n + 3n * minBid);
  });

  it("computeBidTotal is 0 for a re-bid on own squares only", function () {
    expect(computeBidTotal([own(minBid), own(minBid)], rules)).to.equal(0n);
  });
});
