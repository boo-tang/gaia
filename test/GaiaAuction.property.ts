import { type Abi, type Hex, getAddress, parseEventLogs, zeroAddress } from "viem";

import { loadFixture, networkHelpers, time, viem } from "./helpers/setup";
import { SHAPE_ERRORS, auctionAs, deployAuction, deploySale } from "./helpers/auction";
import { deployLand } from "./helpers/land";
import { revertMessage } from "./helpers/errors";
import { balanceChange } from "./helpers/eth";
import { Rng } from "./helpers/random";

/*
 * Model-based random tests of the auction bid rules.
 *
 * Each run sends random bids to a new auction and applies them to an off-chain model. Before each
 * call, the model predicts success or the revert error. After each call, the test compares the
 * contract state with the model: `highestBids`, `squareShapeId`, `shapeBidder`,
 * `shapeLiveSquares`, `pendingReturns`, `activeBids` and `proceeds`.
 *
 * ETH invariants, checked after each call (bid, withdraw, pause, unpause, cancel,
 * withdrawProceeds):
 * - The auction balance is at least the sum of `pendingReturns` of the bidders plus `proceeds`.
 *   The model also predicts the exact balance.
 * - Until a cancel, the sum of `activeBids` equals `proceeds`. After a cancel, `proceeds` is 0.
 *   withdrawProceeds sets `proceeds` to 0 and does not change `activeBids`, so after it the sum of
 *   `activeBids` equals the proceeds that the treasury got. (A cancel is not possible after
 *   withdrawProceeds, so `activeBids` is not used again.)
 * `pendingReturns` cannot be listed, so the test keeps the list of bidders.
 *
 * At the end, a run either ends normally or with a cancel:
 * - Normal end: the treasury gets exactly `proceeds` from withdrawProceeds, and each bidder can
 *   withdraw their refunds. Then every shape settles in random chunks (see `settlePhase`), and a
 *   land sale sells squares next to the window. After each
 *   purchase the sale holds no ETH, and the treasury gets exactly the price times the number of
 *   squares.
 * - Cancel: each bidder withdraws exactly the ETH that they sent, and the treasury gets nothing.
 *
 * Shape rule. `isHVConvex` checks the rule from its definition: the squares are in sort order,
 * have no duplicates, each row and each column is one unbroken run, and the shape is
 * 4-connected. It also checks the coordinates, the size and the aspect ratio. Thus the contract
 * is compared with the definition of the rule, not with a copy of its code. The error names are
 * part of the interface, but when a list breaks more than one rule, the error that comes first is
 * not. So the model expects any shape error, except for generators that break exactly one rule
 * (`empty`, `single`, `too large`, `thin`): then it expects the error of that rule.
 *
 * Remainder rule: each shape that a bid cuts into must keep zero squares, or a valid shape of at
 * least `minShapeSquares` squares. Each invalid remainder (too small, or not a valid shape) gives
 * OverlapWouldInvalidateShape. When a bid also sends too little ETH, the model accepts
 * InsufficientValue or OverlapWouldInvalidateShape.
 *
 * A run uses one window of WINDOW x WINDOW squares, so that bids collide often. Each window has a
 * fixed place: an ordinary place, across longitude 0, at latitude 0 (also across longitude 0), or
 * at the north limit. The north window has rows past latitude 17999, so some bids there revert
 * with InvalidCoordinates.
 *
 * Environment variables:
 * - AUCTION_FUZZ_RUNS: number of seeds (default 12).
 * - AUCTION_FUZZ_FIRST_SEED: the first seed (default 1). The seeds are FIRST_SEED to
 *   FIRST_SEED + RUNS - 1. The scheduled CI run starts at a different seed each day.
 * - AUCTION_FUZZ_OPS: operations for each seed (default 60).
 * - AUCTION_FUZZ_SEED: run only this seed (to repeat a failed run).
 * - AUCTION_FUZZ_VERBOSE=1: print a summary of each run.
 */

const RUNS = Number(process.env.AUCTION_FUZZ_RUNS ?? "12");
const FIRST_SEED = Number(process.env.AUCTION_FUZZ_FIRST_SEED ?? "1");
const OPS = Number(process.env.AUCTION_FUZZ_OPS ?? "60");
const ONLY_SEED =
  process.env.AUCTION_FUZZ_SEED === undefined
    ? undefined
    : Number(process.env.AUCTION_FUZZ_SEED);

const WINDOW = 10;
const MAX_LAT = 18000;
const MAX_LNG = 36000;

// Auction parameters. Small shapes, so that the window holds several shapes.
const MIN_BID = 1000n;
const INCREMENT_BPS = 500n;
const MIN_SHAPE = 2;
const MAX_SHAPE = 24;
const MAX_RATIO = 3;

// Land sale parameters. The price drops by 1 wei per second.
const SALE_START_PRICE = 9000n;
const SALE_END_PRICE = 1800n;
const SALE_HOLD = 3600n;
const SALE_DROP = 7200n;

type Address = `0x${string}`;

const PLACES = [
  { name: "ordinary", lat0: 9000, lng0: 18000 },
  { name: "across longitude 0", lat0: 9000, lng0: 35995 },
  { name: "latitude 0 across longitude 0", lat0: 0, lng0: 35996 },
  { name: "north limit (rows 17993 to 18002)", lat0: MAX_LAT - 7, lng0: 100 },
];
type Place = (typeof PLACES)[number];

// -------- Squares --------

// A cell is a square of the window, in local coordinates: key = row * WINDOW + col. Column 0 is
// the west edge of the window, also when the window crosses longitude 0. A packed square is
// `(lat << 16) | lng`, as bidOnShape takes it.
const key = (row: number, col: number) => row * WINDOW + col;
const rowOf = (k: number) => Math.floor(k / WINDOW);
const colOf = (k: number) => k % WINDOW;
const inWindow = (row: number, col: number) =>
  row >= 0 && row < WINDOW && col >= 0 && col < WINDOW;
const ALL_CELLS = Array.from({ length: WINDOW * WINDOW }, (_, i) => i);

const packOf = (place: Place, k: number) =>
  (place.lat0 + rowOf(k)) * 65536 + ((place.lng0 + colOf(k)) % MAX_LNG);
const latOf = (packed: number) => Math.floor(packed / 65536);
const lngOf = (packed: number) => packed % 65536;

/// The cell of a packed square, or undefined if the square is not in the window.
function cellOf(place: Place, packed: number): number | undefined {
  const lng = lngOf(packed);
  if (lng >= MAX_LNG) return undefined;
  const row = latOf(packed) - place.lat0;
  const col = (lng - place.lng0 + MAX_LNG) % MAX_LNG;
  if (!inWindow(row, col)) return undefined;
  return key(row, col);
}

/// Cells in sort order: south to north, then west to east.
const sortCells = (cells: Iterable<number>) => [...cells].sort((a, b) => a - b);

/// Rows of the window that are on the map.
const validRows = (place: Place) =>
  Math.min(WINDOW, MAX_LAT - place.lat0);

// -------- Shape rule --------

/// The shape rule from its definition. True if the list is a valid shape: coordinates on the
/// map, size and aspect ratio in the limits, sort order, no duplicates, each row and each column
/// one unbroken run, and 4-connected. Columns count east from the west edge of the window, so a
/// shape across longitude 0 has consecutive columns. The squares need not be in the window.
function isHVConvex(place: Place, squares: number[]): boolean {
  if (squares.length < MIN_SHAPE || squares.length > MAX_SHAPE) return false;
  const points: [number, number][] = [];
  for (const packed of squares) {
    if (lngOf(packed) >= MAX_LNG || latOf(packed) >= MAX_LAT) return false;
    points.push([latOf(packed), (lngOf(packed) - place.lng0 + MAX_LNG) % MAX_LNG]);
  }
  const id = ([r, c]: [number, number]) => r * MAX_LNG + c;
  const set = new Set(points.map(id));
  if (set.size !== points.length) return false;
  for (let i = 1; i < points.length; i++) {
    if (id(points[i]) <= id(points[i - 1])) return false;
  }

  const rows = new Map<number, number[]>();
  const cols = new Map<number, number[]>();
  for (const [r, c] of points) {
    rows.set(r, [...(rows.get(r) ?? []), c]);
    cols.set(c, [...(cols.get(c) ?? []), r]);
  }
  const isRun = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[sorted.length - 1] - sorted[0] === sorted.length - 1;
  };
  for (const values of rows.values()) if (!isRun(values)) return false;
  for (const values of cols.values()) if (!isRun(values)) return false;

  const seen = new Set<number>([id(points[0])]);
  const queue = [points[0]];
  while (queue.length > 0) {
    const [r, c] = queue.pop()!;
    for (const [dr, dc] of [
      [0, 1],
      [1, 0],
      [0, -1],
      [-1, 0],
    ]) {
      const n: [number, number] = [r + dr, c + dc];
      if (set.has(id(n)) && !seen.has(id(n))) {
        seen.add(id(n));
        queue.push(n);
      }
    }
  }
  if (seen.size !== set.size) return false;

  const height = Math.max(...rows.keys()) - Math.min(...rows.keys()) + 1;
  const width = Math.max(...cols.keys()) - Math.min(...cols.keys()) + 1;
  return Math.max(height, width) <= Math.min(height, width) * MAX_RATIO;
}

// -------- Model --------

/// Amount that a bid puts on a square (GaiaAuction._bidAmount).
function bidAmount(current: bigint, floor: bigint): bigint {
  let next = MIN_BID;
  if (current >= MIN_BID) {
    const relative = (current * INCREMENT_BPS) / 10_000n;
    next = current + (relative > MIN_BID ? relative : MIN_BID);
  }
  return floor > next ? floor : next;
}

/// The expected revert of a call: one error name, or a list of names when any of them is correct.
type Expected = string | readonly string[] | undefined;

const namesOf = (expected: string | readonly string[]) =>
  typeof expected === "string" ? [expected] : [...expected];

type SquareRecord = { amount: bigint; shape: number };
type ShapeRecord = { bidder: Address; cells: number[] };

class AuctionModel {
  squares = new Map<number, SquareRecord>();
  shapes = new Map<number, ShapeRecord>();
  pending = new Map<Address, bigint>();
  active = new Map<Address, bigint>();
  proceeds = 0n;
  nextShape = 1;
  paused = false;
  cancelled = false;
  // True if the last bid reverts because of the remainder of a shape that it cuts.
  remainderError = false;
  // True after endTime.
  ended = false;
  // ETH: the expected balance of the auction, and the ETH that each bidder sent and got back.
  balance = 0n;
  sent = new Map<Address, bigint>();
  withdrawn = new Map<Address, bigint>();
  // The ETH that the last withdraw or withdrawProceeds pays.
  lastPayment = 0n;
  // The proceeds that withdrawProceeds paid to the treasury.
  proceedsPaid = 0n;

  constructor(readonly place: Place) {}

  clone(): AuctionModel {
    const out = new AuctionModel(this.place);
    for (const [k, s] of this.squares) out.squares.set(k, { ...s });
    for (const [id, s] of this.shapes) {
      out.shapes.set(id, { bidder: s.bidder, cells: s.cells });
    }
    for (const [a, v] of this.pending) out.pending.set(a, v);
    for (const [a, v] of this.active) out.active.set(a, v);
    out.proceeds = this.proceeds;
    out.nextShape = this.nextShape;
    out.paused = this.paused;
    out.cancelled = this.cancelled;
    out.ended = this.ended;
    out.balance = this.balance;
    out.proceedsPaid = this.proceedsPaid;
    for (const [a, v] of this.sent) out.sent.set(a, v);
    for (const [a, v] of this.withdrawn) out.withdrawn.set(a, v);
    return out;
  }

  bidderOf(k: number): Address | undefined {
    const s = this.squares.get(k);
    if (s === undefined) return undefined;
    return this.shapes.get(s.shape)!.bidder;
  }

  /// Cells that a shape still holds, in its stored order.
  liveCells(id: number): number[] {
    return this.shapes
      .get(id)!
      .cells.filter((k) => this.squares.get(k)?.shape === id);
  }

  liveShapes(): number[] {
    return [...this.shapes.keys()].filter((id) => this.liveCells(id).length > 0);
  }

  pendingOf(a: Address) {
    return this.pending.get(a) ?? 0n;
  }

  activeOf(a: Address) {
    return this.active.get(a) ?? 0n;
  }

  /// The ETH that a bid spends, for the squares in the window. Changes nothing.
  cost(
    sender: Address,
    squares: number[],
    floor: bigint,
    raise: boolean,
  ): bigint {
    let paid = 0n;
    for (const packed of squares) {
      const k = cellOf(this.place, packed);
      if (k === undefined) continue;
      const current = this.squares.get(k)?.amount ?? 0n;
      if (this.bidderOf(k) !== sender) paid += bidAmount(current, floor);
      else if (raise) paid += bidAmount(current, floor) - current;
    }
    return paid;
  }

  /// Applies bidOnShape as the contract would. Returns the expected revert error, or undefined
  /// for success. After a revert, the model is discarded (see `attempt`).
  bid(
    sender: Address,
    squares: number[],
    floor: bigint,
    raise: boolean,
    value: bigint,
    shapeFault?: string,
  ): Expected {
    if (this.ended) return "AuctionAlreadyEnded";
    if (this.cancelled) return "AuctionIsCancelled";
    if (this.paused) return "AuctionIsPaused";
    const valid = isHVConvex(this.place, squares);
    if (shapeFault !== undefined && valid) {
      throw new Divergence(`generator for ${shapeFault} made a valid shape ${fmtSquares(squares)}`);
    }
    if (!valid) return shapeFault ?? SHAPE_ERRORS;

    const id = this.nextShape++;
    const cells = squares.map((packed) => cellOf(this.place, packed)!);
    this.shapes.set(id, { bidder: sender, cells });
    let paid = 0n;
    let increase = 0n;
    // Shapes that held squares of the bid, in the order of their first square in the bid.
    const affected: number[] = [];
    for (const k of cells) {
      const current = this.squares.get(k);
      const amount = current?.amount ?? 0n;
      const previous = this.bidderOf(k);
      let next = amount;
      if (previous !== sender) {
        if (previous !== undefined) {
          this.pending.set(previous, this.pendingOf(previous) + amount);
          this.active.set(previous, this.activeOf(previous) - amount);
        }
        next = bidAmount(amount, floor);
        paid += next;
      } else if (raise) {
        next = bidAmount(amount, floor);
        paid += next - amount;
      }
      increase += next - amount;
      if (current !== undefined && !affected.includes(current.shape)) {
        affected.push(current.shape);
      }
      this.squares.set(k, { amount: next, shape: id });
    }
    const remainderErrors = new Set<string>();
    for (const shape of affected) {
      const rest = this.liveCells(shape);
      if (rest.length === 0) continue;
      if (!isHVConvex(this.place, rest.map((k) => packOf(this.place, k)))) {
        remainderErrors.add("OverlapWouldInvalidateShape");
      }
    }
    this.remainderError = remainderErrors.size > 0;
    if (value < paid) return ["InsufficientValue", ...remainderErrors];
    if (remainderErrors.size > 0) return [...remainderErrors];

    if (value > paid) this.pending.set(sender, this.pendingOf(sender) + value - paid);
    this.proceeds += increase;
    this.active.set(sender, this.activeOf(sender) + paid);
    this.balance += value;
    this.sent.set(sender, (this.sent.get(sender) ?? 0n) + value);
    return undefined;
  }

  /// withdraw: pays the refunds, and after a cancel also the current bids. Never reverts.
  withdraw(sender: Address): string | undefined {
    const amount =
      this.pendingOf(sender) + (this.cancelled ? this.activeOf(sender) : 0n);
    this.pending.set(sender, 0n);
    if (this.cancelled) this.active.set(sender, 0n);
    this.balance -= amount;
    this.withdrawn.set(sender, (this.withdrawn.get(sender) ?? 0n) + amount);
    this.lastPayment = amount;
    return undefined;
  }

  pause(isAdmin: boolean): string | undefined {
    if (!isAdmin) return "NotAdmin";
    if (this.cancelled) return "AuctionIsCancelled";
    if (this.paused) return "AuctionIsPaused";
    if (this.ended) return "AuctionAlreadyEnded";
    this.paused = true;
    return undefined;
  }

  unpause(isAdmin: boolean): string | undefined {
    if (!isAdmin) return "NotAdmin";
    if (this.cancelled) return "AuctionIsCancelled";
    if (!this.paused) return "AuctionNotPaused";
    if (this.ended) return "AuctionAlreadyEnded";
    this.paused = false;
    return undefined;
  }

  /// cancel: the admin while paused; anybody while paused after endTime.
  cancel(isAdmin: boolean): string | undefined {
    if (this.cancelled) return "AuctionIsCancelled";
    if (!this.paused) return "AuctionNotPaused";
    if (!this.ended && !isAdmin) return "NotAdmin";
    this.cancelled = true;
    this.proceeds = 0n;
    return undefined;
  }

  withdrawProceeds(): string | undefined {
    if (!this.ended) return "AuctionNotYetEnded";
    if (this.cancelled) return "AuctionIsCancelled";
    if (this.paused) return "AuctionIsPaused";
    this.lastPayment = this.proceeds;
    this.proceedsPaid += this.proceeds;
    this.balance -= this.proceeds;
    this.proceeds = 0n;
    return undefined;
  }
}

class Divergence extends Error {}

function fmtSquares(squares: number[]) {
  return squares.map((p) => `(${latOf(p)},${lngOf(p)})`).join(" ");
}

// -------- Test --------

const NAMES = ["alice", "bob", "carol", "dave"];

async function deploy() {
  const [admin, alice, bob, carol, dave, treasury] =
    await viem.getWalletClients();
  const land = await deployLand(admin.account.address);
  return {
    admin,
    land,
    bidders: [alice, bob, carol, dave],
    treasury: getAddress(treasury.account.address),
    publicClient: await viem.getPublicClient(),
  };
}

type Fixture = Awaited<ReturnType<typeof deploy>>;

/// A new auction and land sale for one run. Its times come from the chain clock, so each run is open for 30
/// days from its start.
async function deployRun(fx: Fixture) {
  const end = BigInt(await time.latest()) + 30n * 86400n;
  const { auction } = await deployAuction(fx.land, {
    treasury: fx.treasury,
    endTime: end,
    minBidPerSquareWei: MIN_BID,
    minBidIncrementBps: INCREMENT_BPS,
    minShapeSquares: BigInt(MIN_SHAPE),
    maxShapeSquares: BigInt(MAX_SHAPE),
    maxShapeAspectRatio: BigInt(MAX_RATIO),
  });
  const sale = await deploySale(fx.land, auction.address, {
    treasury: fx.treasury,
    startPrice: SALE_START_PRICE,
    endPrice: SALE_END_PRICE,
    holdDuration: SALE_HOLD,
    dropDuration: SALE_DROP,
  });
  const as = new Map<Address, typeof auction>();
  for (const wallet of fx.bidders) {
    as.set(getAddress(wallet.account.address), await auctionAs(auction.address, wallet));
  }
  return { auction, sale, as, end };
}

describe("Auction bid rules: model-based random tests", function () {
  // The runs move the clock past endTime. Restore the chain after the runs, so that the clock
  // is back where it was for the next test files.
  let snapshot: Awaited<ReturnType<typeof networkHelpers.takeSnapshot>>;
  before(async function () {
    snapshot = await networkHelpers.takeSnapshot();
  });
  after(async function () {
    await snapshot.restore();
  });

  const seeds =
    ONLY_SEED === undefined
      ? Array.from({ length: RUNS }, (_, i) => FIRST_SEED + i)
      : [ONLY_SEED];

  for (const seed of seeds) {
    const place = PLACES[seed % PLACES.length];
    it(`seed ${seed}: ${OPS} operations, window ${place.name}`, async function () {
      // The default timeout is enough for the default length. Longer runs get more time.
      this.timeout(Math.max(this.timeout(), OPS * 500));
      const fx = await loadFixture(deploy);
      await runHistory(seed, place, fx);
    });
  }
});

async function runHistory(seed: number, place: Place, fx: Fixture) {
  const rng = new Rng(seed);
  const { auction, sale, as, end } = await deployRun(fx);
  let model = new AuctionModel(place);
  const bidders = fx.bidders.map((w) => getAddress(w.account.address));
  const admin = getAddress(fx.admin.account.address);
  // The auction as `caller`. The admin deployed it.
  const asCaller = (caller: Address) =>
    caller === admin ? auction : as.get(caller)!;
  const log: string[] = [];
  const counts = { ok: 0, reverted: 0 };
  const outcomes = new Map<string, number>();
  const who = (a: Address) =>
    a === admin ? "admin" : (NAMES[bidders.indexOf(a)] ?? a);
  // The squares of the last bid, for the checks after it.
  let lastSquares: number[] = [];
  // The errors that a call can revert with, to name an error that Hardhat does not name.
  const errorAbi: Abi = [...auction.abi, ...sale.abi];

  /// Runs one contract call. The model predicts the result on a copy. The copy becomes the model
  /// only if the call succeeds.
  async function attempt(
    label: string,
    predict: (m: AuctionModel) => Expected,
    send: () => Promise<unknown>,
  ): Promise<boolean> {
    const next = model.clone();
    const expected = predict(next);
    const shown = expected === undefined ? "success" : namesOf(expected).join(" | ");
    log.push(`${label} -> expect ${shown}`);
    let actual: string | undefined;
    let message = "";
    try {
      await send();
    } catch (e) {
      message = revertMessage(e, errorAbi);
      actual = "revert";
    }
    if (expected === undefined && actual !== undefined) {
      throw new Divergence(`model expects success, contract reverted: ${message}`);
    }
    if (expected !== undefined && actual === undefined) {
      throw new Divergence(`model expects ${shown}, contract succeeded`);
    }
    if (expected !== undefined) {
      const matched = namesOf(expected).find((name) =>
        new RegExp(`\\b${name}\\(`).test(message),
      );
      if (matched === undefined) {
        throw new Divergence(`model expects ${shown}, contract reverted with: ${message}`);
      }
      counts.reverted++;
      const outcome = next.remainderError ? `${matched} (remainder)` : matched;
      outcomes.set(outcome, (outcomes.get(outcome) ?? 0) + 1);
      return false;
    }
    model = next;
    counts.ok++;
    return true;
  }

  // -------- Shape generation --------

  /// A random HV-convex shape of cells, in sort order. The start of each row falls, then rises,
  /// and the end of each row rises, then falls. Adjacent rows overlap. If `anchor` is set, the
  /// shape contains it. The shape stays on the map, unless `pastLimit` is true.
  function convexShape(anchor?: number, pastLimit = false): number[] | undefined {
    const rows = pastLimit ? WINDOW : validRows(place);
    for (let attempt = 0; attempt < 50; attempt++) {
      const h = 1 + rng.int(4);
      const left = rng.int(h);
      const right = rng.int(h);
      const starts: number[] = new Array(h);
      const ends: number[] = new Array(h);
      starts[left] = 0;
      ends[right] = rng.int(6);
      for (let i = left - 1; i >= 0; i--) starts[i] = starts[i + 1] + rng.int(2);
      for (let i = left + 1; i < h; i++) starts[i] = starts[i - 1] + rng.int(2);
      for (let i = right - 1; i >= 0; i--) ends[i] = ends[i + 1] - rng.int(2);
      for (let i = right + 1; i < h; i++) ends[i] = ends[i - 1] - rng.int(2);
      let ok = true;
      for (let i = 0; i < h && ok; i++) {
        if (starts[i] > ends[i]) ok = false;
        if (i > 0 && (starts[i] > ends[i - 1] || starts[i - 1] > ends[i])) ok = false;
      }
      if (!ok) continue;
      // Most shapes keep the aspect ratio. Some do not, to test the rule.
      const width = Math.max(...ends) - Math.min(...starts) + 1;
      if (Math.max(h, width) > Math.min(h, width) * MAX_RATIO && !rng.chance(0.15)) {
        continue;
      }
      const local: [number, number][] = [];
      for (let i = 0; i < h; i++) {
        for (let c = starts[i]; c <= ends[i]; c++) local.push([i, c]);
      }
      let dr = rng.int(rows);
      let dc = rng.int(WINDOW);
      if (anchor !== undefined) {
        const [r, c] = rng.pick(local);
        dr = rowOf(anchor) - r;
        dc = colOf(anchor) - c;
      }
      if (local.some(([r, c]) => r + dr < 0 || r + dr >= rows || !inWindow(r + dr, c + dc))) {
        continue;
      }
      return sortCells(local.map(([r, c]) => key(r + dr, c + dc)));
    }
    return undefined;
  }

  const packCells = (cells: number[]) => cells.map((k) => packOf(place, k));

  /// A square list that breaks a rule, of a random kind.
  /// `fault` is set when the list breaks exactly one rule: the error of that rule.
  function badSquares(): { kind: string; squares: number[]; fault?: string } | undefined {
    const kind = rng.pick([
      "swap",
      "drop square",
      "drop row",
      "shift last row",
      "dent west",
      "dent east",
      "duplicate",
      "bad longitude",
      "past the limit",
      "single",
      "too large",
      "thin",
      "reverse",
      "empty",
    ]);
    if (kind === "empty") return { kind, squares: [], fault: "EmptyShape" };
    if (kind === "single") {
      return {
        kind,
        squares: packCells([rng.pick(ALL_CELLS.filter((k) => rowOf(k) < validRows(place)))]),
        fault: "ShapeTooSmall",
      };
    }
    if (kind === "too large") {
      const rect: number[] = [];
      for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) rect.push(key(r, c));
      return { kind, squares: packCells(rect), fault: "ShapeTooLarge" };
    }
    if (kind === "thin") {
      const len = MAX_RATIO + 1 + rng.int(WINDOW - MAX_RATIO - 1);
      const r0 = rng.int(validRows(place));
      const line = Array.from({ length: len }, (_, c) => key(r0, c));
      return { kind, squares: packCells(line), fault: "AspectRatioExceeded" };
    }
    if (kind === "dent west" || kind === "dent east") {
      // Three rows. The middle row is shorter on one side, so one column has a gap.
      const r0 = rng.int(Math.max(1, validRows(place) - 2));
      const c0 = rng.int(WINDOW - 3);
      const cells: number[] = [];
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 4; c++) {
          const dent = r === 1 && (kind === "dent west" ? c === 0 : c === 3);
          if (!dent) cells.push(key(r0 + r, c0 + c));
        }
      }
      return { kind, squares: packCells(cells) };
    }
    const base = convexShape(undefined, kind === "past the limit");
    if (base === undefined || base.length < 2) return undefined;
    const squares = packCells(base);
    if (kind === "swap") {
      const i = rng.int(squares.length);
      const j = rng.int(squares.length);
      const t = squares[i];
      squares[i] = squares[j];
      squares[j] = t;
    } else if (kind === "drop square") {
      squares.splice(1 + rng.int(squares.length - 1), 1);
    } else if (kind === "drop row") {
      const rowLats = [...new Set(squares.map(latOf))];
      const lat = rng.pick(rowLats);
      return { kind, squares: squares.filter((p) => latOf(p) !== lat) };
    } else if (kind === "shift last row") {
      // The row stays in the window.
      const last = rowOf(base[base.length - 1]);
      const shift = 1 + rng.int(4);
      const cells = base.map((k) => (rowOf(k) === last ? k + shift : k));
      if (cells.some((k, i) => rowOf(base[i]) === last && colOf(base[i]) + shift >= WINDOW)) {
        return undefined;
      }
      return { kind, squares: packCells(cells) };
    } else if (kind === "duplicate") {
      const i = rng.int(squares.length);
      squares.splice(i, 0, squares[i]);
    } else if (kind === "bad longitude") {
      const i = rng.int(squares.length);
      squares[i] += MAX_LNG;
    } else if (kind === "reverse") {
      squares.reverse();
    }
    return { kind, squares };
  }

  // -------- Operations --------

  /// A random jump bid floor: none, below the next bid, or above it.
  const randomFloor = () => {
    if (!rng.chance(0.3)) return 0n;
    return BigInt(rng.int(4000));
  };

  async function sendBid(
    label: string,
    sender: Address,
    squares: number[],
    options: { floor?: bigint; raise?: boolean; short?: boolean; fault?: string } = {},
  ) {
    lastSquares = squares;
    const floor = options.floor ?? randomFloor();
    const raise = options.raise ?? rng.chance(0.5);
    const paid = model.cost(sender, squares, floor, raise);
    let value = paid;
    if (options.short === true) value = paid - 1n;
    else if (rng.chance(0.3)) value += BigInt(1 + rng.int(5000));
    if (value < 0n) return;
    await attempt(
      `${label}: ${who(sender)} bids on ${squares.length} squares ${fmtSquares(squares)}, ` +
        `floor ${floor}, raise ${raise}, value ${value}`,
      (m) => m.bid(sender, squares, floor, raise, value, options.fault),
      () =>
        as.get(sender)!.write.bidOnShape([squares, floor, raise], { value }),
    );
  }

  const ops: { weight: number; name: string; run: () => Promise<void> }[] = [
    {
      weight: 4,
      name: "new shape",
      run: async () => {
        const cells = convexShape();
        if (cells === undefined) return;
        await sendBid("new shape", rng.pick(bidders), packCells(cells));
      },
    },
    {
      weight: 4,
      name: "outbid",
      run: async () => {
        // A shape that contains a square of another bidder. It often cuts a shape.
        const id = rng.pickOr(model.liveShapes());
        if (id === undefined) return;
        const owner = model.shapes.get(id)!.bidder;
        const cells = convexShape(rng.pick(model.liveCells(id)));
        if (cells === undefined) return;
        const sender = rng.pick(bidders.filter((b) => b !== owner));
        await sendBid(`outbid #${id}`, sender, packCells(cells));
      },
    },
    {
      weight: 3,
      name: "own squares",
      run: async () => {
        // A re-bid that contains own squares: all live squares of an own shape, or a shape
        // around one of them (it can join two own shapes).
        const id = rng.pickOr(model.liveShapes());
        if (id === undefined) return;
        const owner = model.shapes.get(id)!.bidder;
        const live = model.liveCells(id);
        let cells: number[] | undefined = live;
        if (rng.chance(0.5)) cells = convexShape(rng.pick(live));
        if (cells === undefined) return;
        await sendBid(`own squares of #${id}`, owner, packCells(cells), {
          floor: rng.chance(0.5) ? 0n : randomFloor(),
        });
      },
    },
    {
      weight: 3,
      name: "invalid shape",
      run: async () => {
        const bad = badSquares();
        if (bad === undefined) return;
        await sendBid(`invalid (${bad.kind})`, rng.pick(bidders), bad.squares, {
          fault: bad.fault,
        });
      },
    },
    {
      weight: 1,
      name: "short value",
      run: async () => {
        const cells = convexShape();
        if (cells === undefined) return;
        await sendBid("short value", rng.pick(bidders), packCells(cells), {
          short: true,
        });
      },
    },
    {
      weight: 2,
      name: "withdraw",
      run: async () => {
        await withdraw(rng.pick(bidders));
      },
    },
    {
      weight: 1,
      name: "pause or unpause",
      run: async () => {
        // Mostly the admin. Sometimes a bidder, who is not the admin.
        const caller = rng.chance(0.85) ? admin : rng.pick(bidders);
        const isAdmin = caller === admin;
        if (model.paused && rng.chance(0.8)) {
          await attempt(
            `unpause by ${who(caller)}`,
            (m) => m.unpause(isAdmin),
            () => asCaller(caller).write.unpause(),
          );
          return;
        }
        await attempt(
          `pause by ${who(caller)}`,
          (m) => m.pause(isAdmin),
          () => asCaller(caller).write.pause(),
        );
        if (!model.paused) return;
        // A short pause: a bid reverts and a withdraw works. Then the admin mostly unpauses.
        const cells = convexShape();
        if (cells !== undefined) {
          await sendBid("bid while paused", rng.pick(bidders), packCells(cells));
        }
        await withdraw(rng.pick(bidders));
        if (rng.chance(0.85)) {
          await attempt("unpause by admin", (m) => m.unpause(true), () => auction.write.unpause());
        }
      },
    },
    {
      weight: 1,
      name: "early cancel or withdrawProceeds",
      run: async () => {
        // Before endTime these revert: a bidder cannot cancel, an unpaused auction cannot be
        // cancelled, and the treasury cannot take the proceeds yet.
        const caller = rng.pick(bidders);
        if (rng.chance(0.5)) {
          await attempt(
            `cancel by ${who(caller)}`,
            (m) => m.cancel(false),
            () => asCaller(caller).write.cancel(),
          );
        } else {
          await attempt(
            `withdrawProceeds by ${who(caller)}`,
            (m) => m.withdrawProceeds(),
            () => asCaller(caller).write.withdrawProceeds(),
          );
        }
      },
    },
  ];
  const totalWeight = ops.reduce((n, o) => n + o.weight, 0);

  // -------- ETH --------

  const balanceOf = (address: Address) => fx.publicClient.getBalance({ address });

  /// withdraw by `bidder`. The bidder must get exactly the amount of the model.
  async function withdraw(bidder: Address) {
    let got = 0n;
    const ok = await attempt(
      `withdraw by ${who(bidder)}`,
      (m) => m.withdraw(bidder),
      async () => {
        ({ change: got } = await balanceChange(bidder, () =>
          as.get(bidder)!.write.withdraw(),
        ));
      },
    );
    if (ok && got !== model.lastPayment) {
      throw new Divergence(
        `withdraw paid ${who(bidder)} ${got}, model ${model.lastPayment}`,
      );
    }
  }

  /// withdrawProceeds by `caller`. On success the treasury must get exactly `proceeds`.
  async function withdrawProceeds(caller: Address) {
    let got = 0n;
    const ok = await attempt(
      `withdrawProceeds by ${who(caller)}`,
      (m) => m.withdrawProceeds(),
      async () => {
        const before = await balanceOf(fx.treasury);
        await asCaller(caller).write.withdrawProceeds();
        got = (await balanceOf(fx.treasury)) - before;
      },
    );
    const expected = ok ? model.lastPayment : 0n;
    if (got !== expected) {
      throw new Divergence(`withdrawProceeds paid the treasury ${got}, model ${expected}`);
    }
  }

  async function passEndTime() {
    await time.increaseTo(end + 1n);
    model.ended = true;
    log.push("time passes endTime");
  }

  /// The end of a run: a normal end, or a cancel.
  async function endRun() {
    const treasuryBefore = await balanceOf(fx.treasury);
    const proceeds = model.proceeds;
    const cancel = rng.chance(0.5);
    if (cancel) {
      if (!model.paused) {
        await attempt("pause by admin", (m) => m.pause(true), () => auction.write.pause());
      }
      // The admin can cancel before endTime. After endTime anybody can cancel.
      let caller = admin;
      if (rng.chance(0.5)) {
        await passEndTime();
        caller = rng.pick(bidders);
      }
      await attempt(
        `cancel by ${who(caller)}`,
        (m) => m.cancel(caller === admin),
        () => asCaller(caller).write.cancel(),
      );
      await check();
    } else {
      if (model.paused) {
        await attempt("unpause by admin", (m) => m.unpause(true), () => auction.write.unpause());
      }
      await passEndTime();
      const cells = convexShape();
      if (cells !== undefined) await sendBid("late bid", rng.pick(bidders), packCells(cells));
      await attempt("pause by admin", (m) => m.pause(true), () => auction.write.pause());
    }
    if (!model.ended) await passEndTime();

    await withdrawProceeds(rng.pick(bidders));
    await check();
    for (const b of bidders) {
      await withdraw(b);
      await check();
    }
    const left = await balanceOf(auction.address);
    if (left !== 0n) throw new Divergence(`auction holds ${left} after all withdrawals`);
    const treasuryGot = (await balanceOf(fx.treasury)) - treasuryBefore;
    if (cancel) {
      if (treasuryGot !== 0n) {
        throw new Divergence(`treasury got ${treasuryGot} after a cancel`);
      }
      for (const b of bidders) {
        const sent = model.sent.get(b) ?? 0n;
        const back = model.withdrawn.get(b) ?? 0n;
        if (sent !== back) {
          throw new Divergence(`${who(b)} sent ${sent} and got back ${back} after a cancel`);
        }
      }
    } else if (treasuryGot !== proceeds) {
      throw new Divergence(`treasury got ${treasuryGot}, proceeds were ${proceeds}`);
    }
    if (!cancel) await settlePhase();
    await salePhase(cancel);
  }

  // -------- Settlement --------

  /// Settles every shape: random callers, random chunk sizes (0 is the whole rest), and shapes in
  /// a random mix. A shape is done when settleShape reverts with ShapeAlreadySettled. The test
  /// does not model the settle cursor; it checks public results after each call:
  /// - A call that mints squares emits ShapeSquaresSettled with the country and the number of new
  ///   squares, and squareCount goes up by that number.
  /// - Until the country holds all live squares of the shape, the auction owns it. The call that
  ///   completes it sends it to the bidder and emits ShapeSettled.
  /// At the end: each shape with live squares has one country of its bidder with exactly those
  /// squares; a shape with no live squares has no country; and the squares that exist in the
  /// window are exactly the squares of the model.
  async function settlePhase() {
    const { countries, squares } = fx.land;
    const open = new Set(model.shapes.keys());
    const calls = new Map<number, number>();
    while (open.size > 0) {
      const id = rng.pick([...open]);
      const shape = model.shapes.get(id)!;
      const live = model.liveCells(id);
      const chunk = rng.chance(0.3) ? 0n : BigInt(1 + rng.int(6));
      const caller = rng.pick(bidders);
      const n = (calls.get(id) ?? 0) + 1;
      calls.set(id, n);
      // Each call settles at least one stored square, so a shape needs at most one call for
      // each stored square, plus the call that finds it settled.
      if (n > shape.cells.length + 1) {
        throw new Divergence(`settleShape(#${id}) does not end after ${n - 1} calls`);
      }
      log.push(`settleShape(#${id}, ${chunk}) by ${who(caller)}`);
      const before = await auction.read.shapeCountryId([BigInt(id)]);
      const countBefore = before === 0n ? 0n : await countries.read.squareCount([before]);
      const ownerBefore =
        before === 0n ? undefined : getAddress(await countries.read.ownerOf([before]));
      let receipt;
      try {
        const hash = await as.get(caller)!.write.settleShape([BigInt(id), chunk]);
        receipt = await fx.publicClient.waitForTransactionReceipt({ hash });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (!/\bShapeAlreadySettled\(/.test(message)) {
          throw new Divergence(`settleShape(#${id}) reverted with: ${message}`);
        }
        open.delete(id);
        await checkSettled(id, live);
        continue;
      }
      counts.ok++;
      const countryId = await auction.read.shapeCountryId([BigInt(id)]);
      if (live.length === 0) {
        if (countryId !== 0n) throw new Divergence(`shape #${id} has no live squares but country ${countryId}`);
        continue;
      }
      if (countryId === 0n) {
        // The chunk held only squares that the shape lost: nothing is minted yet.
        if (receipt.logs.length !== 0) throw new Divergence(`shape #${id}: events, but no country`);
        continue;
      }
      if (before !== 0n && countryId !== before) {
        throw new Divergence(`shape #${id} changed country from ${before} to ${countryId}`);
      }
      const count = await countries.read.squareCount([countryId]);
      const minted = parseEventLogs({
        abi: auction.abi,
        eventName: "ShapeSquaresSettled",
        logs: receipt.logs,
      });
      const added = count - countBefore;
      if (added === 0n ? minted.length !== 0 : minted.length !== 1) {
        throw new Divergence(`shape #${id}: ${added} squares added, ${minted.length} ShapeSquaresSettled`);
      }
      if (
        added !== 0n &&
        (minted[0].args.shapeId !== BigInt(id) ||
          minted[0].args.countryId !== countryId ||
          minted[0].args.count !== added)
      ) {
        throw new Divergence(`shape #${id}: ShapeSquaresSettled ${JSON.stringify(minted[0].args, (_, v) => (typeof v === "bigint" ? v.toString() : v))}, model ${added} squares in ${countryId}`);
      }
      // The auction owns the country until the call that reaches the end of the stored squares.
      // That call sends it to the bidder and emits ShapeSettled. It can come after the country
      // holds all live squares, when the last stored squares were lost to later bids.
      const owner = getAddress(await countries.read.ownerOf([countryId]));
      if (owner !== shape.bidder && owner !== getAddress(auction.address)) {
        throw new Divergence(`country ${countryId} of shape #${id} is at ${owner}`);
      }
      if (owner === shape.bidder && count !== BigInt(live.length)) {
        throw new Divergence(`shape #${id}: country ${countryId} sent with ${count} of ${live.length} squares`);
      }
      const transferred = owner === shape.bidder && ownerBefore !== shape.bidder;
      const settled = parseEventLogs({ abi: auction.abi, eventName: "ShapeSettled", logs: receipt.logs });
      if (settled.length !== (transferred ? 1 : 0)) {
        throw new Divergence(`shape #${id}: ${settled.length} ShapeSettled, country sent: ${transferred}`);
      }
      if (transferred) {
        const a = settled[0].args;
        if (
          a.shapeId !== BigInt(id) ||
          a.countryId !== countryId ||
          getAddress(a.winner!) !== shape.bidder ||
          a.totalSquares !== BigInt(live.length)
        ) {
          throw new Divergence(`shape #${id}: ShapeSettled with other values than the model`);
        }
      }
    }
    // The squares that exist in the window are exactly the squares of the model.
    const rows = validRows(place);
    for (const k of ALL_CELLS) {
      if (rowOf(k) >= rows) continue;
      const packed = packOf(place, k);
      const exists = await squares.read.exists([latOf(packed), lngOf(packed)]);
      if (exists !== model.squares.has(k)) {
        throw new Divergence(`exists${fmtSquares([packed])} is ${exists}, model ${model.squares.has(k)}`);
      }
    }
    log.push("all shapes settled");
  }

  /// After the last settleShape of shape `id`: its country, if any, holds exactly `live`.
  async function checkSettled(id: number, live: number[]) {
    const { countries, squares } = fx.land;
    const countryId = await auction.read.shapeCountryId([BigInt(id)]);
    if (live.length === 0) {
      if (countryId !== 0n) throw new Divergence(`shape #${id} has no live squares but country ${countryId}`);
      return;
    }
    const bidder = model.shapes.get(id)!.bidder;
    if (countryId === 0n) throw new Divergence(`shape #${id} settled without a country`);
    const owner = getAddress(await countries.read.ownerOf([countryId]));
    if (owner !== bidder) throw new Divergence(`country ${countryId} of shape #${id} is at ${owner}, not ${who(bidder)}`);
    const count = await countries.read.squareCount([countryId]);
    if (count !== BigInt(live.length)) {
      throw new Divergence(`country ${countryId} of shape #${id} has ${count} squares, model ${live.length}`);
    }
    for (const k of live) {
      const packed = packOf(place, k);
      const c = await squares.read.countryOf([latOf(packed), lngOf(packed)]);
      if (c !== countryId) throw new Divergence(`countryOf${fmtSquares([packed])} is ${c}, model ${countryId}`);
    }
  }

  // -------- Land sale --------

  // The sale bubbles up the reverts of GaiaCountries and GaiaSquares. Their errors are added to
  // the ABI, so that viem names them.
  const saleAbi = [
    ...sale.abi,
    ...fx.land.countries.abi.filter((item) => item.type === "error"),
    ...fx.land.squares.abi.filter((item) => item.type === "error"),
  ] as Abi;

  /// Sale price at `timestamp` (after endTime).
  function salePrice(timestamp: bigint): bigint {
    const elapsed = timestamp - end;
    if (elapsed <= SALE_HOLD) return SALE_START_PRICE;
    if (elapsed - SALE_HOLD >= SALE_DROP) return SALE_END_PRICE;
    return (
      SALE_START_PRICE -
      ((SALE_START_PRICE - SALE_END_PRICE) * (elapsed - SALE_HOLD)) / SALE_DROP
    );
  }

  /// Random purchases next to the window. Each new country gets its own slot of 6 columns; a
  /// purchase into a country adds the column east of it. The last bid squares are reserved.
  async function salePhase(cancelled: boolean) {
    const lat0 = place.lat0 >= 100 ? place.lat0 - 50 : place.lat0 + 50;
    const bought: { id: bigint; buyer: Address; lat: number; lng: number; rows: number; cols: number }[] = [];
    let slot = 0;
    for (let i = 0; i < 6; i++) {
      const buyer = rng.pick(bidders);
      const wallet = fx.bidders[bidders.indexOf(buyer)];
      let fn: "buy" | "buyInto" = "buy";
      let countryId = 0n;
      let squares: number[] = [];
      let expected: string | undefined;
      const kind = rng.pick(["new", "new", "into", "reserved", "short"]);
      const into = rng.pickOr(bought.filter((c) => c.buyer === buyer && c.cols < 5));
      if (kind === "into" && into !== undefined) {
        fn = "buyInto";
        countryId = into.id;
        for (let r = 0; r < into.rows; r++) {
          squares.push((into.lat + r) * 65536 + ((into.lng + into.cols) % MAX_LNG));
        }
      } else if (kind === "reserved" && model.squares.size > 0) {
        squares = [packOf(place, rng.pick([...model.squares.keys()]))];
        expected = "SquareReserved";
      } else {
        const rows = 1 + rng.int(3);
        const cols = 1 + rng.int(4);
        const lng0 = (place.lng0 + slot * 6) % MAX_LNG;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            squares.push((lat0 + r) * 65536 + ((lng0 + c) % MAX_LNG));
          }
        }
      }

      const timestamp = BigInt(await time.latest()) + 1n + BigInt(rng.int(4000));
      await time.setNextBlockTimestamp(timestamp);
      const price = salePrice(timestamp);
      const cost = price * BigInt(squares.length);
      let value = cost + (rng.chance(0.5) ? BigInt(rng.int(10_000)) : 0n);
      if (kind === "short") value = cost - 1n;
      if (cancelled) expected = "AuctionIsCancelled";
      else if (kind === "short") expected = "InsufficientValue";
      const label = `sale ${fn} of ${squares.length} squares ${fmtSquares(squares)} by ${who(buyer)} at price ${price}, value ${value}`;
      log.push(`${label} -> expect ${expected ?? "success"}`);

      const treasuryBefore = await balanceOf(fx.treasury);
      let message = "";
      let result: Awaited<ReturnType<typeof balanceChange>> | undefined;
      try {
        result = await balanceChange(buyer, () =>
          wallet.writeContract({
            address: sale.address,
            abi: saleAbi,
            functionName: fn,
            args: fn === "buy" ? [squares] : [countryId, squares],
            value,
          }),
        );
      } catch (e) {
        message = e instanceof Error ? e.message : String(e);
      }
      const saleBalance = await balanceOf(sale.address);
      if (saleBalance !== 0n) throw new Divergence(`sale holds ${saleBalance}`);
      const treasuryGot = (await balanceOf(fx.treasury)) - treasuryBefore;

      if (expected !== undefined) {
        if (result !== undefined) throw new Divergence(`sale: expected ${expected}, call succeeded`);
        if (!new RegExp(`\\b${expected}\\(`).test(message)) {
          throw new Divergence(`sale: expected ${expected}, reverted with: ${message}`);
        }
        if (treasuryGot !== 0n) throw new Divergence(`treasury got ${treasuryGot} from a reverted purchase`);
        counts.reverted++;
        outcomes.set(`sale ${expected}`, (outcomes.get(`sale ${expected}`) ?? 0) + 1);
        // A revert that is not mined leaves the next timestamp set. Mine it.
        if (BigInt(await time.latest()) < timestamp) await time.increaseTo(timestamp);
        continue;
      }
      if (result === undefined) throw new Divergence(`sale: expected success, reverted with: ${message}`);
      if (treasuryGot !== cost) {
        throw new Divergence(`treasury got ${treasuryGot}, price ${price} x ${squares.length} = ${cost}`);
      }
      if (result.change !== -cost) {
        throw new Divergence(`buyer paid ${-result.change}, cost ${cost}`);
      }
      const [event] = parseEventLogs({
        abi: sale.abi,
        eventName: "SquaresBought",
        logs: result.receipt.logs,
      });
      if (
        event.args.pricePerSquare !== price ||
        event.args.squareCount !== BigInt(squares.length)
      ) {
        throw new Divergence(
          `SquaresBought ${event.args.squareCount} at ${event.args.pricePerSquare}, ` +
            `model ${squares.length} at ${price}`,
        );
      }
      counts.ok++;
      if (fn === "buyInto") {
        into!.cols++;
      } else {
        const first = squares[0];
        bought.push({
          id: event.args.countryId,
          buyer,
          lat: latOf(first),
          lng: lngOf(first),
          rows: new Set(squares.map(latOf)).size,
          cols: squares.length / new Set(squares.map(latOf)).size,
        });
        slot++;
      }
    }
  }

  // -------- Checks --------

  /// Compares the contract with the model. `cells` and `shapes` limit the squares and shapes to
  /// read; undefined reads all of them.
  async function check(cells?: Iterable<number>, shapes?: Iterable<number>) {
    const problems: string[] = [];
    const reads: Promise<void>[] = [];
    const expectEq = (what: string, actual: unknown, expected: unknown) => {
      if (actual !== expected) {
        problems.push(`${what}: contract ${actual}, model ${expected}`);
      }
    };
    const cellList =
      cells === undefined
        ? ALL_CELLS.filter((k) => rowOf(k) < validRows(place))
        : [...new Set(cells)];
    const shapeList =
      shapes === undefined ? [...model.shapes.keys()] : [...new Set(shapes)];

    for (const k of cellList) {
      const packed = packOf(place, k);
      const lat = latOf(packed);
      const lng = lngOf(packed);
      reads.push(
        (async () => {
          const s = model.squares.get(k);
          const [bidder, amount] = await auction.read.highestBids([lat, lng]);
          expectEq(
            `highestBids(${lat},${lng}).bidder`,
            getAddress(bidder),
            model.bidderOf(k) ?? zeroAddress,
          );
          expectEq(`highestBids(${lat},${lng}).amount`, amount, s?.amount ?? 0n);
          expectEq(
            `squareShapeId(${lat},${lng})`,
            await auction.read.squareShapeId([lat, lng]),
            BigInt(s?.shape ?? 0),
          );
        })(),
      );
    }
    for (const id of shapeList) {
      reads.push(
        (async () => {
          const shape = model.shapes.get(id);
          expectEq(
            `shapeBidder(#${id})`,
            getAddress(await auction.read.shapeBidder([BigInt(id)])),
            shape?.bidder ?? zeroAddress,
          );
          expectEq(
            `shapeLiveSquares(#${id})`,
            await auction.read.shapeLiveSquares([BigInt(id)]),
            BigInt(shape === undefined ? 0 : model.liveCells(id).length),
          );
        })(),
      );
    }
    for (const b of bidders) {
      reads.push(
        (async () => {
          expectEq(
            `pendingReturns(${who(b)})`,
            await auction.read.pendingReturns([b]),
            model.pendingOf(b),
          );
          expectEq(
            `activeBids(${who(b)})`,
            await auction.read.activeBids([b]),
            model.activeOf(b),
          );
        })(),
      );
    }
    // ETH invariants, from the contract values.
    let sumPending = 0n;
    let sumActive = 0n;
    for (const b of bidders) {
      reads.push(
        (async () => {
          // Read first, then add: `sum += await read()` reads `sum` before the await.
          const pending = await auction.read.pendingReturns([b]);
          const active = await auction.read.activeBids([b]);
          sumPending += pending;
          sumActive += active;
        })(),
      );
    }
    let proceeds = 0n;
    let balance = 0n;
    let cancelled = false;
    reads.push(
      (async () => {
        proceeds = await auction.read.proceeds();
        balance = await balanceOf(auction.address);
        cancelled = await auction.read.cancelled();
      })(),
    );
    await Promise.all(reads);
    expectEq("proceeds", proceeds, model.proceeds);
    expectEq("auction balance", balance, model.balance);
    expectEq("cancelled", cancelled, model.cancelled);
    expectEq("paused", await auction.read.paused(), model.paused);
    if (balance < sumPending + proceeds) {
      problems.push(`balance ${balance} < sum of pendingReturns ${sumPending} + proceeds ${proceeds}`);
    }
    // withdrawProceeds sets `proceeds` to 0 and does not change `activeBids`.
    if (!cancelled && sumActive !== proceeds + model.proceedsPaid) {
      problems.push(
        `sum of activeBids ${sumActive} != proceeds ${proceeds} + paid ${model.proceedsPaid}`,
      );
    }
    if (cancelled && proceeds !== 0n) problems.push(`proceeds ${proceeds} after a cancel`);
    if (problems.length > 0) throw new Divergence(problems.join("\n"));
  }

  /// The squares and shapes that the last bid can change: the squares of the bid in the window,
  /// and all squares of the shapes that held them.
  function touched(before: AuctionModel): { cells: number[]; shapes: number[] } {
    const cells = new Set<number>();
    const shapes = new Set<number>([before.nextShape]);
    for (const packed of lastSquares) {
      const k = cellOf(place, packed);
      if (k === undefined) continue;
      cells.add(k);
      const s = before.squares.get(k);
      if (s !== undefined) shapes.add(s.shape);
    }
    for (const id of shapes) {
      for (const k of before.shapes.get(id)?.cells ?? []) cells.add(k);
    }
    return { cells: [...cells], shapes: [...shapes] };
  }

  // -------- Run --------

  try {
    for (let i = 0; i < OPS; i++) {
      let r = rng.float() * totalWeight;
      let op = ops[0];
      for (const o of ops) {
        if (r < o.weight) {
          op = o;
          break;
        }
        r -= o.weight;
      }
      log.push(`#${i} ${op.name}`);
      const before = model;
      lastSquares = [];
      await op.run();
      const t = touched(before);
      await check(t.cells, t.shapes);
    }
    await check();
    log.push("end of the run");
    await endRun();
  } catch (e) {
    const tail = log.slice(-40).join("\n  ");
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(
      `auction fuzz failed: seed ${seed}, window ${place.name}\n` +
        `repeat: AUCTION_FUZZ_SEED=${seed} AUCTION_FUZZ_OPS=${OPS} npx hardhat test test/GaiaAuction.property.ts\n` +
        `${message}\noperation log (last 40):\n  ${tail}`,
    );
  }
  if (process.env.AUCTION_FUZZ_VERBOSE !== undefined) {
    console.log(
      `seed ${seed}: ${counts.ok} calls succeeded, ${counts.reverted} reverted as expected, ` +
        `${model.shapes.size} shapes (${model.liveShapes().length} live), ` +
        `${model.squares.size} squares, ${model.cancelled ? "cancelled" : `proceeds ${model.proceedsPaid}`}, ` +
        `reverts ${[...outcomes].map(([e, n]) => `${e} ${n}`).join(", ")}`,
    );
  }
}
