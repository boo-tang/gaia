import { getAddress, zeroAddress } from "viem";

import { loadFixture, time, viem } from "./helpers/setup";
import { deployLand } from "./helpers/land";

/*
 * Model-based random tests of the auction bid rules.
 *
 * Each run sends random bids to a new auction and applies them to an off-chain model. Before each
 * call, the model predicts success or the revert error. After each call, the test compares the
 * contract state with the model: `highestBids`, `squareShapeId`, `shapeBidder`,
 * `shapeLiveSquares`, `pendingReturns`, `activeBids` and `proceeds`.
 *
 * Shape rule. The model has two parts:
 * - `shapeError` gives the error of a square list. It reads the squares in the same order as the
 *   contract, so that it can name the first error that the contract finds.
 * - `isHVConvex` is an independent check of the rule from its definition: the squares are in sort
 *   order, have no duplicates, each row and each column is one unbroken run, and the shape is
 *   4-connected. It also checks the coordinates, the size and the aspect ratio.
 * The test fails if the two parts do not agree. Thus the contract is compared with the definition
 * of the rule, not only with a copy of its code.
 *
 * Remainder rule: each shape that a bid cuts into must keep zero squares, or a valid shape of at
 * least `minShapeSquares` squares. The contract checks the remainder in the stored order of the
 * shape, so the model does the same.
 *
 * A run uses one window of WINDOW x WINDOW squares, so that bids collide often. Each window has a
 * fixed place: an ordinary place, across longitude 0, at latitude 0 (also across longitude 0), or
 * at the north limit. The north window has rows past latitude 17999, so some bids there revert
 * with InvalidCoordinates.
 *
 * Environment variables:
 * - AUCTION_FUZZ_RUNS: number of seeds (default 12).
 * - AUCTION_FUZZ_OPS: operations for each seed (default 60).
 * - AUCTION_FUZZ_SEED: run only this seed (to repeat a failed run).
 * - AUCTION_FUZZ_VERBOSE=1: print a summary of each run.
 */

const RUNS = Number(process.env.AUCTION_FUZZ_RUNS ?? "12");
const OPS = Number(process.env.AUCTION_FUZZ_OPS ?? "60");
const ONLY_SEED =
  process.env.AUCTION_FUZZ_SEED === undefined
    ? undefined
    : Number(process.env.AUCTION_FUZZ_SEED);

const WINDOW = 10;
const MAX_LAT = 18000;
const MAX_LNG = 36000;
const LNG_ORIGIN = MAX_LNG / 2;

// Auction parameters. Small shapes, so that the window holds several shapes.
const MIN_BID = 1000n;
const INCREMENT_BPS = 500n;
const MIN_SHAPE = 2;
const MAX_SHAPE = 24;
const MAX_RATIO = 3;

type Address = `0x${string}`;

const PLACES = [
  { name: "ordinary", lat0: 9000, lng0: 18000 },
  { name: "across longitude 0", lat0: 9000, lng0: 35995 },
  { name: "latitude 0 across longitude 0", lat0: 0, lng0: 35996 },
  { name: "north limit (rows 17993 to 18002)", lat0: MAX_LAT - 7, lng0: 100 },
];
type Place = (typeof PLACES)[number];

// -------- Random numbers --------

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Rng {
  private next: () => number;
  constructor(seed: number) {
    this.next = mulberry32(seed);
  }
  float() {
    return this.next();
  }
  int(n: number) {
    return Math.floor(this.next() * n);
  }
  chance(p: number) {
    return this.next() < p;
  }
  pick<T>(items: T[]): T {
    return items[this.int(items.length)];
  }
  pickOr<T>(items: T[]): T | undefined {
    if (items.length === 0) return undefined;
    return this.pick(items);
  }
}

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

/// Same normalisation as GaiaAuction._normLng.
const normLng = (lng: number, ref: number) =>
  (lng + MAX_LNG + LNG_ORIGIN - ref) % MAX_LNG;

/// The error of `_validateShape` for a list of packed squares, or undefined if the list is a
/// valid shape. It reads the squares in the same order as the contract.
function shapeError(squares: number[]): string | undefined {
  const len = squares.length;
  if (len === 0) return "EmptyShape";
  if (len < MIN_SHAPE) return "ShapeTooSmall";
  if (len > MAX_SHAPE) return "ShapeTooLarge";
  const ref = lngOf(squares[0]);
  if (ref >= MAX_LNG) return "InvalidCoordinates";

  let lat = latOf(squares[0]);
  let prev = LNG_ORIGIN;
  let start = LNG_ORIGIN;
  let end = LNG_ORIGIN;
  let prevStart = LNG_ORIGIN;
  let prevEnd = LNG_ORIGIN;
  let minLng = LNG_ORIGIN;
  let maxLng = LNG_ORIGIN;
  let leftFlipped = false;
  let rightFlipped = false;
  let firstRow = true;
  let touches = true;

  // Checks the right edge of the row that ends. Its end must rise, then fall.
  const closeRow = (): string | undefined => {
    if (firstRow) return undefined;
    if (!touches) return "NoLatAdjacency";
    if (end < prevEnd && !rightFlipped) rightFlipped = true;
    else if (rightFlipped && end > prevEnd) return "NotConvexEnd";
    return undefined;
  };

  for (let i = 1; i < len; i++) {
    const rowLat = latOf(squares[i]);
    const raw = lngOf(squares[i]);
    if (raw >= MAX_LNG) return "InvalidCoordinates";
    const lng = normLng(raw, ref);
    if (rowLat === lat) {
      if (lng !== prev + 1) return "GapBetweenLongitudes";
      prev = lng;
      end = lng;
      if (lng > maxLng) maxLng = lng;
      if (!firstRow && !touches && lng >= prevStart && lng <= prevEnd) {
        touches = true;
      }
      continue;
    }
    if (rowLat < lat) return "Unsorted";
    if (rowLat !== lat + 1) return "NonConsecutiveLatitudes";
    const err = closeRow();
    if (err !== undefined) return err;

    prevStart = start;
    prevEnd = end;
    lat = rowLat;
    prev = lng;
    start = lng;
    end = lng;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    // The start of a row must fall, then rise.
    if (lng > prevStart && !leftFlipped) leftFlipped = true;
    else if (leftFlipped && lng < prevStart) return "NotConvexStart";
    firstRow = false;
    touches = lng >= prevStart && lng <= prevEnd;
  }
  const err = closeRow();
  if (err !== undefined) return err;

  if (latOf(squares[len - 1]) >= MAX_LAT) return "InvalidCoordinates";
  const height = latOf(squares[len - 1]) - latOf(squares[0]) + 1;
  const width = maxLng - minLng + 1;
  if (Math.max(height, width) > Math.min(height, width) * MAX_RATIO) {
    return "AspectRatioExceeded";
  }
  return undefined;
}

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
  ): string | undefined {
    if (this.cancelled) return "AuctionIsCancelled";
    if (this.paused) return "AuctionIsPaused";
    const err = shapeError(squares);
    const valid = isHVConvex(this.place, squares);
    if ((err === undefined) !== valid) {
      throw new Divergence(
        `model parts disagree: shapeError ${err ?? "none"}, isHVConvex ${valid}, ` +
          `squares ${fmtSquares(squares)}`,
      );
    }
    if (err !== undefined) return err;

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
    if (value < paid) return "InsufficientValue";

    for (const shape of affected) {
      const rest = this.liveCells(shape);
      if (rest.length === 0) continue;
      this.remainderError = true;
      if (rest.length < MIN_SHAPE) return "OverlapWouldInvalidateShape";
      const restError = shapeError(rest.map((k) => packOf(this.place, k)));
      if (restError !== undefined) return restError;
      this.remainderError = false;
    }

    if (value > paid) this.pending.set(sender, this.pendingOf(sender) + value - paid);
    this.proceeds += increase;
    this.active.set(sender, this.activeOf(sender) + paid);
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
  };
}

type Fixture = Awaited<ReturnType<typeof deploy>>;

/// A new auction for one run. Its times come from the chain clock, so each run is open for 30
/// days from its start.
async function deployAuction(fx: Fixture) {
  const now = BigInt(await time.latest());
  const end = now + 30n * 86400n;
  const auction = await viem.deployContract(
    "contracts/GaiaAuction.sol:GaiaAuction",
    [
      fx.land.countries.address,
      fx.treasury,
      now - 10n,
      end,
      end, // maxEndTime
      0n, // extensionWindow
      MIN_BID,
      INCREMENT_BPS,
      BigInt(MIN_SHAPE),
      BigInt(MAX_SHAPE),
      BigInt(MAX_RATIO),
    ],
  );
  await fx.land.countries.write.grantRole([
    await fx.land.countries.read.ISSUER_ROLE(),
    auction.address,
  ]);
  await fx.land.countries.write.addAuction([auction.address]);
  const as = new Map<Address, typeof auction>();
  for (const wallet of fx.bidders) {
    as.set(
      getAddress(wallet.account.address),
      await viem.getContractAt(
        "contracts/GaiaAuction.sol:GaiaAuction",
        auction.address,
        { client: { wallet } },
      ),
    );
  }
  return { auction, as, end };
}

describe("Auction bid rules: model-based random tests", function () {
  const seeds =
    ONLY_SEED === undefined
      ? Array.from({ length: RUNS }, (_, i) => i + 1)
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
  const { auction, as } = await deployAuction(fx);
  let model = new AuctionModel(place);
  const bidders = fx.bidders.map((w) => getAddress(w.account.address));
  const log: string[] = [];
  const counts = { ok: 0, reverted: 0 };
  const outcomes = new Map<string, number>();
  const who = (a: Address) => NAMES[bidders.indexOf(a)] ?? a;
  // The squares of the last bid, for the checks after it.
  let lastSquares: number[] = [];

  /// Runs one contract call. The model predicts the result on a copy. The copy becomes the model
  /// only if the call succeeds.
  async function attempt(
    label: string,
    predict: (m: AuctionModel) => string | undefined,
    send: () => Promise<unknown>,
  ): Promise<boolean> {
    const next = model.clone();
    const expected = predict(next);
    log.push(`${label} -> expect ${expected ?? "success"}`);
    let actual: string | undefined;
    let message = "";
    try {
      await send();
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
      actual = "revert";
    }
    if (expected === undefined && actual !== undefined) {
      throw new Divergence(`model expects success, contract reverted: ${message}`);
    }
    if (expected !== undefined && actual === undefined) {
      throw new Divergence(`model expects ${expected}, contract succeeded`);
    }
    if (expected !== undefined) {
      if (!new RegExp(`\\b${expected}\\(`).test(message)) {
        throw new Divergence(
          `model expects ${expected}, contract reverted with: ${message}`,
        );
      }
      counts.reverted++;
      const outcome = next.remainderError ? `${expected} (remainder)` : expected;
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
  function badSquares(): { kind: string; squares: number[] } | undefined {
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
    if (kind === "empty") return { kind, squares: [] };
    if (kind === "single") {
      return { kind, squares: packCells([rng.pick(ALL_CELLS.filter((k) => rowOf(k) < validRows(place)))]) };
    }
    if (kind === "too large") {
      const rect: number[] = [];
      for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) rect.push(key(r, c));
      return { kind, squares: packCells(rect) };
    }
    if (kind === "thin") {
      const len = MAX_RATIO + 1 + rng.int(WINDOW - MAX_RATIO - 1);
      const r0 = rng.int(validRows(place));
      const line = Array.from({ length: len }, (_, c) => key(r0, c));
      return { kind, squares: packCells(line) };
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
    options: { floor?: bigint; raise?: boolean; short?: boolean } = {},
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
      (m) => m.bid(sender, squares, floor, raise, value),
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
        await sendBid(`invalid (${bad.kind})`, rng.pick(bidders), bad.squares);
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
  ];
  const totalWeight = ops.reduce((n, o) => n + o.weight, 0);

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
    reads.push(
      (async () => {
        expectEq("proceeds", await auction.read.proceeds(), model.proceeds);
      })(),
    );
    await Promise.all(reads);
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
      `seed ${seed}: ${counts.ok} bids succeeded, ${counts.reverted} reverted as expected, ` +
        `${model.shapes.size} shapes (${model.liveShapes().length} live), ` +
        `${model.squares.size} squares, proceeds ${model.proceeds}, ` +
        `reverts ${[...outcomes].map(([e, n]) => `${e} ${n}`).join(", ")}`,
    );
  }
}
