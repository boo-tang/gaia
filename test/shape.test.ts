import { expect } from "chai";

import {
  sortLocs,
  validateShape,
  nextBidFor,
  computeBidTotal,
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

describe("utils/shape bid totals (mirrors GaiaAuction.sol._nextBid)", function () {
  const minBid = 1000n;

  it("nextBidFor requires minBid for an unbid square", function () {
    expect(nextBidFor(0n, minBid)).to.equal(minBid);
  });

  it("nextBidFor requires current + minBid for an already-bid square", function () {
    expect(nextBidFor(minBid, minBid)).to.equal(minBid + minBid);
  });

  it("computeBidTotal sums nextBidFor across squares", function () {
    const total = computeBidTotal([0n, minBid, 0n], minBid);
    expect(total).to.equal(minBid + (minBid + minBid) + minBid);
  });
});
