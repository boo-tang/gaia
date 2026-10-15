import { encodeFunctionData, getAddress, zeroAddress } from "viem";

import { loadFixture, viem, provider } from "./helpers/setup";
import {
  accountTransferSquare,
  deployAccount,
  deployLand,
  squareId,
} from "./helpers/land";
import { Rng } from "./helpers/random";

/*
 * Model-based random tests of the land rules.
 *
 * Each run applies random operations to the contracts and to an off-chain model. Before each
 * call, the model predicts success or the revert error. After each call, the test compares the
 * contract state with the model.
 *
 * The model does not use the local check of the contract (Yokoi number). It uses the global
 * rule with flood fill:
 * - A country is 4-connected.
 * - A country has no holes: each empty square reaches the outside through empty squares, with
 *   8-connectivity.
 * - The first square of a country is always allowed. The removal of the last square is always
 *   allowed, and it burns the country.
 *
 * At the end of each run, the test rebuilds the land state from the events only, as the indexer
 * does, and compares it with the model (see `checkEventRebuild`).
 *
 * A run uses one window of WINDOW x WINDOW squares, so that shapes collide often. Each window
 * has a fixed place: an ordinary place, across longitude 0, at latitude 0, or at latitude 17999
 * (also across longitude 0).
 *
 * Environment variables:
 * - LAND_FUZZ_RUNS: number of seeds (default 20).
 * - LAND_FUZZ_OPS: operations for each seed (default 60).
 * - LAND_FUZZ_SEED: run only this seed (to repeat a failed run).
 */

const RUNS = Number(process.env.LAND_FUZZ_RUNS ?? "20");
const OPS = Number(process.env.LAND_FUZZ_OPS ?? "60");
const ONLY_SEED =
  process.env.LAND_FUZZ_SEED === undefined
    ? undefined
    : Number(process.env.LAND_FUZZ_SEED);

const WINDOW = 8;
const MAX_LAT = 18000;
const MAX_LNG = 36000;

type Address = `0x${string}`;
type Wallet = Awaited<ReturnType<typeof viem.getWalletClients>>[number];

const PLACES = [
  { name: "ordinary", lat0: 9000, lng0: 18000 },
  { name: "across longitude 0", lat0: 9000, lng0: 35996 },
  { name: "latitude 0", lat0: 0, lng0: 100 },
  {
    name: "latitude 17999 across longitude 0",
    lat0: MAX_LAT - WINDOW,
    lng0: 35996,
  },
];
type Place = (typeof PLACES)[number];

// -------- Window geometry --------

// A cell is a square in the window, in local coordinates: key = row * WINDOW + col.
const key = (row: number, col: number) => row * WINDOW + col;
const rowOf = (k: number) => Math.floor(k / WINDOW);
const colOf = (k: number) => k % WINDOW;
const inWindow = (row: number, col: number) =>
  row >= 0 && row < WINDOW && col >= 0 && col < WINDOW;

const ALL_CELLS = Array.from({ length: WINDOW * WINDOW }, (_, i) => i);

const SIDES = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
];
const AROUND = [
  [0, 1],
  [1, 1],
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, -1],
  [-1, 0],
  [-1, 1],
];

function toLoc(place: Place, k: number) {
  return {
    lat: place.lat0 + rowOf(k),
    lng: (place.lng0 + colOf(k)) % MAX_LNG,
  };
}

/// The global shape rule. The cells are local to the window, so the longitude wrap is already
/// removed. The grid is the window plus a margin of one square. The margin is always empty, so
/// it is the outside. For a window at a latitude limit, the margin row beyond the pole is not on
/// the map: it is never in a country, so it is empty and open.
function isValidShape(place: Place, cells: Set<number>): boolean {
  if (cells.size <= 1) return true;
  for (const k of cells) {
    const lat = place.lat0 + rowOf(k);
    if (lat < 0 || lat >= MAX_LAT) return false;
  }

  // 4-connected.
  const first = cells.values().next().value as number;
  const seen = new Set<number>([first]);
  const queue = [first];
  while (queue.length > 0) {
    const k = queue.pop()!;
    for (const [dr, dc] of SIDES) {
      const r = rowOf(k) + dr;
      const c = colOf(k) + dc;
      if (!inWindow(r, c)) continue;
      const n = key(r, c);
      if (cells.has(n) && !seen.has(n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  if (seen.size !== cells.size) return false;

  // No holes: flood fill the empty squares from the margin, with 8-connectivity.
  const side = WINDOW + 2;
  const filled = new Set<number>();
  const gridKey = (r: number, c: number) => (r + 1) * side + (c + 1);
  const isEmpty = (r: number, c: number) =>
    !inWindow(r, c) || !cells.has(key(r, c));
  const fill = [[-1, -1]];
  filled.add(gridKey(-1, -1));
  while (fill.length > 0) {
    const [r, c] = fill.pop()!;
    for (const [dr, dc] of AROUND) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < -1 || nr > WINDOW || nc < -1 || nc > WINDOW) continue;
      if (!isEmpty(nr, nc)) continue;
      const g = gridKey(nr, nc);
      if (filled.has(g)) continue;
      filled.add(g);
      fill.push([nr, nc]);
    }
  }
  return filled.size === side * side - cells.size;
}

// -------- Model --------

type SquareRecord = { country: bigint; holder: Address };
type CountryRecord = {
  owner: Address | undefined; // undefined after the burn
  lastOwner: Address;
  version: bigint;
};

class LandModel {
  squares = new Map<number, SquareRecord>();
  countries = new Map<bigint, CountryRecord>();
  approvals = new Map<number, Address>();
  nextId = 1n;

  constructor(
    readonly place: Place,
    readonly accountOf: (id: bigint) => Address,
  ) {}

  clone(): LandModel {
    const out = new LandModel(this.place, this.accountOf);
    for (const [k, s] of this.squares) out.squares.set(k, { ...s });
    for (const [id, c] of this.countries) out.countries.set(id, { ...c });
    for (const [k, a] of this.approvals) out.approvals.set(k, a);
    out.nextId = this.nextId;
    return out;
  }

  cellsOf(id: bigint): Set<number> {
    const out = new Set<number>();
    for (const [k, s] of this.squares) if (s.country === id) out.add(k);
    return out;
  }

  /// Country id of a registered account, or 0.
  countryOfAccount(address: Address): bigint {
    for (const id of this.countries.keys()) {
      if (this.accountOf(id) === address) return id;
    }
    return 0n;
  }

  /// Country id of an account address, also before the country exists, or 0 for a wallet.
  tokenOfAccount(address: Address): bigint {
    for (let id = 1n; id <= this.nextId + 2n; id++) {
      if (this.accountOf(id) === address) return id;
    }
    return 0n;
  }

  liveIds(): bigint[] {
    return [...this.countries.keys()].filter(
      (id) => this.countries.get(id)!.owner !== undefined,
    );
  }

  ownerOf(id: bigint): Address | undefined {
    return this.countries.get(id)?.owner;
  }

  controllerOf(k: number): Address {
    const s = this.squares.get(k)!;
    if (s.country === 0n) return s.holder;
    return this.ownerOf(s.country)!;
  }

  /// Each method below changes the model as the contract would, and returns the expected revert
  /// error, or undefined for success. After a revert, the model is discarded (see `attempt`).

  createCountry(owner: Address, cells: number[]): string | undefined {
    if (cells.length === 0) return "EmptySquares";
    const id = this.nextId++;
    this.countries.set(id, { owner, lastOwner: owner, version: 0n });
    return this.mint(id, cells);
  }

  addSquares(id: bigint, buyer: Address, cells: number[]): string | undefined {
    if (cells.length === 0) return "EmptySquares";
    const owner = this.ownerOf(id);
    if (owner === undefined) return "UnknownCountry";
    if (owner !== buyer) return "NotCountryOwner";
    return this.mint(id, cells);
  }

  private mint(id: bigint, cells: number[]): string | undefined {
    for (const k of cells) {
      if (this.squares.has(k)) return "SquareAlreadyExists";
      this.squares.set(k, { country: id, holder: this.accountOf(id) });
      const err = this.enter(id);
      if (err !== undefined) return err;
    }
    return undefined;
  }

  private enter(id: bigint): string | undefined {
    const c = this.countries.get(id)!;
    c.version++;
    if (!isValidShape(this.place, this.cellsOf(id))) return "ShapeBroken";
    return undefined;
  }

  private leave(id: bigint): string | undefined {
    const c = this.countries.get(id)!;
    c.version++;
    const cells = this.cellsOf(id);
    if (cells.size === 0) {
      c.owner = undefined;
      return undefined;
    }
    if (!isValidShape(this.place, cells)) return "ShapeBroken";
    return undefined;
  }

  /// ERC-721 transferFrom on GaiaSquares, sent by `auth`.
  transferSquare(
    auth: Address,
    from: Address,
    to: Address,
    k: number,
  ): string | undefined {
    const s = this.squares.get(k);
    if (s === undefined) return "ERC721NonexistentToken";
    if (s.holder !== from) return "ERC721IncorrectOwner";
    if (auth !== from && this.approvals.get(k) !== auth) {
      return "ERC721InsufficientApproval";
    }
    this.approvals.delete(k);
    s.holder = to;
    if (from === to) return undefined;

    const fromCountry = s.country;
    const toCountry = this.countryOfAccount(to);
    s.country = toCountry;

    if (toCountry !== 0n) {
      const toOwner = this.ownerOf(toCountry);
      if (toOwner === undefined) return "ERC721NonexistentToken";
      const sameOwner =
        fromCountry !== 0n &&
        auth === from &&
        this.ownerOf(fromCountry) === toOwner;
      if (auth !== toOwner && !sameOwner) return "NoConsent";
    }
    if (fromCountry !== 0n) {
      if (auth !== from) return "TransferNotByAccount";
      const err = this.leave(fromCountry);
      if (err !== undefined) return err;
    }
    if (toCountry !== 0n) return this.enter(toCountry);
    return undefined;
  }

  approve(caller: Address, spender: Address, k: number): string | undefined {
    const s = this.squares.get(k)!;
    if (s.holder !== caller) return "ERC721InvalidApprover";
    this.approvals.set(k, spender);
    return undefined;
  }

  /// The access check of GaiaCountryAccount.execute.
  execute(caller: Address, account: Address): string | undefined {
    const id = this.tokenOfAccount(account);
    const owner = this.ownerOf(id);
    if (owner === undefined) return "ERC721NonexistentToken";
    if (caller !== owner) return "NotOwner";
    return undefined;
  }

  /// A split or a move: the country owner makes `account` send square k to `to`.
  executeTransfer(
    caller: Address,
    account: Address,
    to: Address,
    k: number,
  ): string | undefined {
    const err = this.execute(caller, account);
    if (err !== undefined) return err;
    return this.transferSquare(account, account, to, k);
  }

  transferCountry(
    caller: Address,
    to: Address,
    id: bigint,
  ): string | undefined {
    const c = this.countries.get(id);
    if (c === undefined || c.owner === undefined)
      return "ERC721NonexistentToken";
    if (caller !== c.owner) return "ERC721InsufficientApproval";
    if (this.countryOfAccount(to) !== 0n) return "OwnershipLoop";
    c.owner = to;
    c.lastOwner = to;
    return undefined;
  }
}

// -------- Test --------

async function deploy() {
  const [admin, issuer, alice, bob, carol] = await viem.getWalletClients();
  const land = await deployLand(admin.account.address);
  await land.countries.write.grantRole([
    await land.countries.read.ISSUER_ROLE(),
    issuer.account.address,
  ]);
  const asIssuer = await viem.getContractAt(
    "GaiaCountries",
    land.countries.address,
    { client: { wallet: issuer } },
  );
  const users = [alice, bob, carol];
  const squaresAs = new Map<Address, Awaited<ReturnType<typeof squaresFor>>>();
  const countriesAs = new Map<
    Address,
    Awaited<ReturnType<typeof countriesFor>>
  >();
  async function squaresFor(wallet: Wallet) {
    return viem.getContractAt("GaiaSquares", land.squares.address, {
      client: { wallet },
    });
  }
  async function countriesFor(wallet: Wallet) {
    return viem.getContractAt("GaiaCountries", land.countries.address, {
      client: { wallet },
    });
  }
  for (const u of users) {
    const a = getAddress(u.account.address);
    squaresAs.set(a, await squaresFor(u));
    countriesAs.set(a, await countriesFor(u));
  }
  // The account address of each country id is a fixed function of the id.
  const accounts: Address[] = [];
  for (let id = 0n; id < 200n; id++) {
    accounts.push(getAddress(await land.countries.read.accountOf([id])));
  }
  return { land, asIssuer, users, squaresAs, countriesAs, accounts };
}

type Fixture = Awaited<ReturnType<typeof deploy>>;

describe("Land rules: model-based random tests", function () {
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

class Divergence extends Error {}

async function runHistory(seed: number, place: Place, fx: Fixture) {
  const rng = new Rng(seed);
  const { land, asIssuer } = fx;
  const startBlock = await (await viem.getPublicClient()).getBlockNumber();
  const accountOf = (id: bigint) => fx.accounts[Number(id)];
  let model = new LandModel(place, accountOf);
  const users = fx.users.map((u) => getAddress(u.account.address));
  const walletOf = (a: Address) =>
    fx.users.find((u) => getAddress(u.account.address) === a)!;
  const deployed = new Set<Address>();
  const log: string[] = [];
  const counts = { ok: 0, reverted: 0 };
  const outcomes = new Map<string, number>();

  const locOf = (k: number) => toLoc(place, k);
  const fmt = (k: number) => {
    const l = locOf(k);
    return `(${l.lat},${l.lng})`;
  };
  const who = (a: Address) => {
    const i = users.indexOf(a);
    if (i >= 0) return ["alice", "bob", "carol"][i];
    const id = model.tokenOfAccount(a);
    if (id !== 0n) return `account#${id}`;
    return a;
  };

  async function ensureDeployed(account: Address) {
    if (deployed.has(account)) return;
    const id = model.tokenOfAccount(account);
    await deployAccount(land, id);
    deployed.add(account);
  }

  /// Runs one contract call. The model predicts the result on a copy. The copy becomes the model
  /// only if the call succeeds.
  async function attempt(
    label: string,
    predict: (m: LandModel) => string | undefined,
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
      throw new Divergence(
        `model expects success, contract reverted: ${message}`,
      );
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
      outcomes.set(expected, (outcomes.get(expected) ?? 0) + 1);
      return false;
    }
    model = next;
    counts.ok++;
    return true;
  }

  // -------- Shape generation --------

  const freeCells = () => ALL_CELLS.filter((k) => !model.squares.has(k));
  const sideTouch = (k: number, cells: Set<number>) =>
    SIDES.some(([dr, dc]) => {
      const r = rowOf(k) + dr;
      const c = colOf(k) + dc;
      return inWindow(r, c) && cells.has(key(r, c));
    });
  const anyTouch = (k: number, cells: Set<number>) =>
    AROUND.some(([dr, dc]) => {
      const r = rowOf(k) + dr;
      const c = colOf(k) + dc;
      return inWindow(r, c) && cells.has(key(r, c));
    });

  /// Grows `base` by up to `count` free squares. Each new square touches the squares before it
  /// at a side, and keeps the shape valid in the model.
  function grow(base: Set<number>, count: number): number[] {
    const cells = new Set(base);
    const added: number[] = [];
    for (let i = 0; i < count; i++) {
      const options = freeCells().filter(
        (k) =>
          !cells.has(k) &&
          (cells.size === 0 || sideTouch(k, cells)) &&
          isValidShape(place, new Set([...cells, k])),
      );
      const k = rng.pickOr(options);
      if (k === undefined) break;
      cells.add(k);
      added.push(k);
    }
    return added;
  }

  /// A square that the rule rejects after `cells`, of a random kind. Undefined if no square of
  /// that kind is free.
  function badSquare(
    cells: Set<number>,
  ): { k: number; kind: string } | undefined {
    const free = freeCells().filter((k) => !cells.has(k));
    const kind = rng.pick([
      "no contact",
      "corner only",
      "closes a ring",
      "taken",
    ]);
    let options: number[] = [];
    if (kind === "no contact") {
      options = free.filter((k) => !anyTouch(k, cells));
    } else if (kind === "corner only") {
      options = free.filter((k) => anyTouch(k, cells) && !sideTouch(k, cells));
    } else if (kind === "closes a ring") {
      options = free.filter(
        (k) =>
          sideTouch(k, cells) && !isValidShape(place, new Set([...cells, k])),
      );
    } else {
      options = [...model.squares.keys(), ...cells];
    }
    const k = rng.pickOr(options);
    if (k === undefined) return undefined;
    return { k, kind };
  }

  /// The 8 squares around a free 3 x 3 block, in ring order. The last one closes the ring.
  function ringShape(): number[] | undefined {
    const centres = ALL_CELLS.filter((k) => {
      const r = rowOf(k);
      const c = colOf(k);
      if (r < 1 || r > WINDOW - 2 || c < 1 || c > WINDOW - 2) return false;
      return [[0, 0], ...AROUND].every(
        ([dr, dc]) => !model.squares.has(key(r + dr, c + dc)),
      );
    });
    const centre = rng.pickOr(centres);
    if (centre === undefined) return undefined;
    const start = rng.int(8);
    const out: number[] = [];
    for (let i = 0; i < 8; i++) {
      const [dr, dc] = AROUND[(start + i) % 8];
      out.push(key(rowOf(centre) + dr, colOf(centre) + dc));
    }
    return out;
  }

  // -------- Checks after a burn --------

  async function checkBurned(id: bigint) {
    // A raw eth_call: viem retries a read that reverts, and that is slow.
    let reverted = false;
    try {
      await provider.request({
        method: "eth_call",
        params: [
          {
            to: land.countries.address,
            data: encodeFunctionData({
              abi: land.countries.abi,
              functionName: "ownerOf",
              args: [id],
            }),
          },
        ],
      });
    } catch (e) {
      reverted = String(e).includes("ERC721NonexistentToken");
    }
    if (!reverted)
      throw new Divergence(`ownerOf(#${id}) does not revert after the burn`);

    const account = accountOf(id);
    const formerOwner = model.countries.get(id)!.lastOwner;
    await ensureDeployed(account);
    const asOwner = await viem.getContractAt(
      "GaiaCountryAccount",
      account,
      {
        client: { wallet: walletOf(formerOwner) },
      },
    );
    await attempt(
      `burned #${id}: execute by former owner ${who(formerOwner)}`,
      (m) => m.execute(formerOwner, account),
      () => asOwner.write.execute([formerOwner, 0n, "0x", 0]),
    );
    const k = rng.pickOr(freeCells());
    if (k !== undefined) {
      await attempt(
        `burned #${id}: addSquares ${fmt(k)}`,
        (m) => m.addSquares(id, formerOwner, [k]),
        () => asIssuer.write.addSquares([id, formerOwner, [locOf(k)]]),
      );
    }
    const standalone = [...model.squares.entries()].filter(
      ([, s]) => s.country === 0n && users.includes(s.holder),
    );
    const pick = rng.pickOr(standalone);
    if (pick !== undefined) {
      const [sk, s] = pick;
      await attempt(
        `burned #${id}: merge ${fmt(sk)} by ${who(s.holder)}`,
        (m) => m.transferSquare(s.holder, s.holder, account, sk),
        () =>
          fx.squaresAs
            .get(s.holder)!
            .write.transferFrom([
              s.holder,
              account,
              squareId(locOf(sk).lat, locOf(sk).lng),
            ]),
      );
    }
  }

  // -------- Operations --------

  async function split(
    id: bigint,
    k: number,
    caller: Address,
    to: Address,
    label: string,
  ) {
    const account = accountOf(id);
    await ensureDeployed(account);
    const live = model.ownerOf(id) !== undefined;
    const ok = await attempt(
      `${label} ${fmt(k)} from #${id} to ${who(to)} by ${who(caller)}`,
      (m) => m.executeTransfer(caller, account, to, k),
      () =>
        accountTransferSquare(
          land,
          walletOf(caller),
          account,
          to,
          locOf(k).lat,
          locOf(k).lng,
        ),
    );
    if (ok && live && model.ownerOf(id) === undefined) {
      log.push(`  #${id} burned`);
      await checkBurned(id);
    }
  }

  /// Squares of live countries whose removal keeps the shape valid.
  function removable(): { id: bigint; k: number }[] {
    const out: { id: bigint; k: number }[] = [];
    for (const id of model.liveIds()) {
      const cells = model.cellsOf(id);
      for (const k of cells) {
        const rest = new Set(cells);
        rest.delete(k);
        if (isValidShape(place, rest)) out.push({ id, k });
      }
    }
    return out;
  }

  function inCountry(): { id: bigint; k: number }[] {
    const out: { id: bigint; k: number }[] = [];
    for (const [k, s] of model.squares) {
      if (s.country !== 0n) out.push({ id: s.country, k });
    }
    return out;
  }

  const ops: { weight: number; name: string; run: () => Promise<void> }[] = [
    {
      weight: 4,
      name: "create",
      run: async () => {
        const owner = rng.pick(users);
        let cells: number[];
        let note = "";
        if (rng.chance(0.25)) {
          // The 8th square closes the ring. Without it, the shape is a valid C. If the gap is a
          // corner, the free centre reaches the outside only through that corner.
          const ring = ringShape();
          if (ring === undefined) return;
          cells = rng.chance(0.5) ? ring : ring.slice(0, 7);
          note = cells.length === 8 ? " (ring)" : " (open ring)";
        } else {
          cells = grow(new Set(), 1 + rng.int(6));
          if (cells.length === 0) return;
          if (rng.chance(0.3)) {
            const bad = badSquare(new Set(cells));
            if (bad !== undefined) {
              cells.push(bad.k);
              note = ` (${bad.kind})`;
            }
          }
        }
        const id = model.nextId;
        await attempt(
          `create #${id} for ${who(owner)}: ${cells.map(fmt).join(" ")}${note}`,
          (m) => m.createCountry(owner, cells),
          () => asIssuer.write.createCountry([owner, cells.map(locOf)]),
        );
      },
    },
    {
      weight: 3,
      name: "addSquares",
      run: async () => {
        const ids = [...model.countries.keys()];
        if (ids.length === 0) return;
        const live = model.liveIds();
        const id =
          rng.chance(0.85) && live.length > 0 ? rng.pick(live) : rng.pick(ids);
        const owner = model.countries.get(id)!.lastOwner;
        const buyer = rng.chance(0.9) ? owner : rng.pick(users);
        const base = model.cellsOf(id);
        let cells = grow(base, 1 + rng.int(3));
        let note = "";
        if (cells.length === 0 || rng.chance(0.3)) {
          const bad = badSquare(new Set([...base, ...cells]));
          if (bad !== undefined) {
            cells = [...cells, bad.k];
            note = ` (${bad.kind})`;
          }
        }
        if (cells.length === 0) return;
        await attempt(
          `addSquares #${id} buyer ${who(buyer)}: ${cells.map(fmt).join(" ")}${note}`,
          (m) => m.addSquares(id, buyer, cells),
          () => asIssuer.write.addSquares([id, buyer, cells.map(locOf)]),
        );
      },
    },
    {
      weight: 5,
      name: "split",
      run: async () => {
        const choice = rng.chance(0.75)
          ? rng.pickOr(removable())
          : rng.pickOr(inCountry());
        if (choice === undefined) return;
        const owner = model.ownerOf(choice.id)!;
        const caller = rng.chance(0.85) ? owner : rng.pick(users);
        const to = rng.chance(0.8) ? caller : rng.pick(users);
        await split(choice.id, choice.k, caller, to, "split");
      },
    },
    {
      weight: 5,
      name: "merge",
      run: async () => {
        const standalone = [...model.squares.entries()].filter(
          ([, s]) => s.country === 0n && users.includes(s.holder),
        );
        const pick = rng.pickOr(standalone);
        if (pick === undefined) return;
        const [k, s] = pick;
        const holder = s.holder;
        const fits = model.liveIds().filter((id) => {
          const cells = model.cellsOf(id);
          cells.add(k);
          return isValidShape(place, cells);
        });
        const own = fits.filter((id) => model.ownerOf(id) === holder);
        const all = [...model.countries.keys()];
        let id: bigint | undefined;
        if (rng.chance(0.5)) id = rng.pickOr(own);
        if (id === undefined && rng.chance(0.6)) id = rng.pickOr(fits);
        if (id === undefined) id = rng.pickOr(all);
        if (id === undefined) return;
        const account = accountOf(id);
        const toOwner = model.ownerOf(id);
        const sq = squareId(locOf(k).lat, locOf(k).lng);
        if (toOwner !== undefined && toOwner !== holder && rng.chance(0.5)) {
          // Consent: the holder approves the country owner, and the country owner pulls.
          await attempt(
            `approve ${fmt(k)} by ${who(holder)} for ${who(toOwner)}`,
            (m) => m.approve(holder, toOwner, k),
            () => fx.squaresAs.get(holder)!.write.approve([toOwner, sq]),
          );
          await attempt(
            `merge ${fmt(k)} of ${who(holder)} into #${id} by ${who(toOwner)}`,
            (m) => m.transferSquare(toOwner, holder, account, k),
            () =>
              fx.squaresAs
                .get(toOwner)!
                .write.transferFrom([holder, account, sq]),
          );
          return;
        }
        await attempt(
          `merge ${fmt(k)} into #${id} by ${who(holder)}`,
          (m) => m.transferSquare(holder, holder, account, k),
          () =>
            fx.squaresAs.get(holder)!.write.transferFrom([holder, account, sq]),
        );
      },
    },
    {
      weight: 3,
      name: "move",
      run: async () => {
        // A square in a country, or a square parked at the account of a live country.
        const parked = [...model.squares.entries()]
          .filter(
            ([, s]) =>
              s.country === 0n && model.countryOfAccount(s.holder) !== 0n,
          )
          .map(([k, s]) => ({ id: model.countryOfAccount(s.holder), k }))
          .filter(({ id }) => model.ownerOf(id) !== undefined);
        let from = rng.chance(0.2) ? rng.pickOr(parked) : undefined;
        if (from === undefined) from = rng.pickOr(inCountry());
        if (from === undefined) return;
        const { id: fromId, k } = from;
        const owner = model.ownerOf(fromId)!;
        const others = [...model.countries.keys()].filter(
          (id) => id !== fromId,
        );
        const sameOwner = others.filter((id) => model.ownerOf(id) === owner);
        const fits = sameOwner.filter((id) => {
          const cells = model.cellsOf(id);
          cells.add(k);
          return isValidShape(place, cells);
        });
        let toId = rng.chance(0.6) ? rng.pickOr(fits) : undefined;
        if (toId === undefined) toId = rng.pickOr(others);
        if (toId === undefined) return;
        await split(fromId, k, owner, accountOf(toId), "move");
      },
    },
    {
      weight: 1,
      name: "transfer country",
      run: async () => {
        const id = rng.pickOr(model.liveIds());
        if (id === undefined) return;
        const owner = model.ownerOf(id)!;
        const to = rng.pick(users.filter((u) => u !== owner));
        const asOwner = fx.countriesAs.get(owner)!;
        await attempt(
          `transfer country #${id} from ${who(owner)} to ${who(to)}`,
          (m) => m.transferCountry(owner, to, id),
          () => asOwner.write.transferFrom([owner, to, id]),
        );
        // Authority follows the new owner.
        const account = accountOf(id);
        await ensureDeployed(account);
        const asOld = await viem.getContractAt(
          "GaiaCountryAccount",
          account,
          {
            client: { wallet: walletOf(owner) },
          },
        );
        await attempt(
          `execute on #${id} by old owner ${who(owner)}`,
          (m) => m.execute(owner, account),
          () => asOld.write.execute([owner, 0n, "0x", 0]),
        );
        // A country cannot go into a country account.
        const target = accountOf(rng.pick([...model.countries.keys()]));
        await attempt(
          `transfer country #${id} by ${who(to)} into ${who(target)}`,
          (m) => m.transferCountry(to, target, id),
          () => fx.countriesAs.get(to)!.write.transferFrom([to, target, id]),
        );
      },
    },
    {
      weight: 2,
      name: "park",
      run: async () => {
        const target = accountOf(model.nextId + BigInt(rng.int(2)));
        if (rng.chance(0.5)) {
          const pick = rng.pickOr(
            [...model.squares.entries()].filter(
              ([, s]) => s.country === 0n && users.includes(s.holder),
            ),
          );
          if (pick === undefined) return;
          const [k, s] = pick;
          await attempt(
            `park ${fmt(k)} of ${who(s.holder)} at ${who(target)}`,
            (m) => m.transferSquare(s.holder, s.holder, target, k),
            () =>
              fx.squaresAs
                .get(s.holder)!
                .write.transferFrom([
                  s.holder,
                  target,
                  squareId(locOf(k).lat, locOf(k).lng),
                ]),
          );
          return;
        }
        const choice = rng.pickOr(removable());
        if (choice === undefined) return;
        await split(
          choice.id,
          choice.k,
          model.ownerOf(choice.id)!,
          target,
          "park",
        );
      },
    },
    {
      weight: 2,
      name: "unpark",
      run: async () => {
        const parked = [...model.squares.entries()].filter(
          ([, s]) => s.country === 0n && model.tokenOfAccount(s.holder) !== 0n,
        );
        const pick = rng.pickOr(parked);
        if (pick === undefined) return;
        const [k, s] = pick;
        const id = model.tokenOfAccount(s.holder);
        const c = model.countries.get(id);
        const caller =
          c !== undefined && c.owner !== undefined && rng.chance(0.85)
            ? c.owner
            : rng.pick(users);
        await split(id, k, caller, caller, "unpark");
      },
    },
    {
      weight: 1,
      name: "give",
      run: async () => {
        const pick = rng.pickOr(
          [...model.squares.entries()].filter(
            ([, s]) => s.country === 0n && users.includes(s.holder),
          ),
        );
        if (pick === undefined) return;
        const [k, s] = pick;
        const to = rng.pick(users.filter((u) => u !== s.holder));
        await attempt(
          `give ${fmt(k)} from ${who(s.holder)} to ${who(to)}`,
          (m) => m.transferSquare(s.holder, s.holder, to, k),
          () =>
            fx.squaresAs
              .get(s.holder)!
              .write.transferFrom([
                s.holder,
                to,
                squareId(locOf(k).lat, locOf(k).lng),
              ]),
        );
      },
    },
    {
      weight: 1,
      name: "dissolve",
      run: async () => {
        // Split all squares of a small country, so that it is burned.
        const small = model
          .liveIds()
          .filter((id) => model.cellsOf(id).size <= 4);
        const id = rng.pickOr(small);
        if (id === undefined) return;
        const owner = model.ownerOf(id)!;
        while (model.ownerOf(id) !== undefined) {
          const cells = model.cellsOf(id);
          const options = [...cells].filter((k) => {
            const rest = new Set(cells);
            rest.delete(k);
            return isValidShape(place, rest);
          });
          const k = rng.pickOr(options);
          if (k === undefined) return;
          await split(id, k, owner, owner, "dissolve");
        }
      },
    },
  ];
  const totalWeight = ops.reduce((n, o) => n + o.weight, 0);

  // -------- Invariants --------

  async function checkInvariants() {
    const problems: string[] = [];
    const reads: Promise<void>[] = [];
    const expectEq = (what: string, actual: unknown, expected: unknown) => {
      if (actual !== expected) {
        problems.push(`${what}: contract ${actual}, model ${expected}`);
      }
    };

    for (const [id, c] of model.countries) {
      const account = accountOf(id);
      reads.push(
        (async () => {
          expectEq(
            `squareCount(#${id})`,
            await land.countries.read.squareCount([id]),
            BigInt(model.cellsOf(id).size),
          );
          expectEq(
            `compositionVersion(#${id})`,
            await land.countries.read.compositionVersion([id]),
            c.version,
          );
          expectEq(
            `countryOfAccount(#${id})`,
            await land.countries.read.countryOfAccount([account]),
            id,
          );
          // checkBurned checks that ownerOf of a burned country reverts.
          if (c.owner !== undefined) {
            expectEq(
              `ownerOf(#${id})`,
              getAddress(await land.countries.read.ownerOf([id])),
              c.owner,
            );
          }
        })(),
      );
    }
    for (const [k, s] of model.squares) {
      const { lat, lng } = locOf(k);
      reads.push(
        (async () => {
          expectEq(
            `countryOf${fmt(k)}`,
            await land.squares.read.countryOf([lat, lng]),
            s.country,
          );
          expectEq(
            `ownerOf${fmt(k)}`,
            getAddress(await land.squares.read.ownerOf([squareId(lat, lng)])),
            s.holder,
          );
          expectEq(
            `controllerOf${fmt(k)}`,
            getAddress(await land.squares.read.controllerOf([lat, lng])),
            model.controllerOf(k),
          );
        })(),
      );
    }
    await Promise.all(reads);
    if (problems.length > 0) throw new Divergence(problems.join("\n"));
  }

  // -------- Rebuild from events --------

  /// Rebuilds the land state from the events of the run only, as the indexer does: Transfer of
  /// countries and squares, CountryCreated and CountryCompositionChanged, in log order. A square
  /// is in a country when a Transfer puts it at the account of a country that exists at that time
  /// (CountryCreated comes before the mints of a new country). The result must equal the model,
  /// which checkInvariants compares with the contracts after each operation.
  async function checkEventRebuild() {
    const range = { fromBlock: startBlock };
    const all = [
      ...(await land.countries.getEvents.Transfer({}, range)).map((e) => ({ kind: "country" as const, e })),
      ...(await land.squares.getEvents.Transfer({}, range)).map((e) => ({ kind: "square" as const, e })),
      ...(await land.countries.getEvents.CountryCreated({}, range)).map((e) => ({ kind: "created" as const, e })),
      ...(await land.countries.getEvents.CountryCompositionChanged({}, range)).map((e) => ({
        kind: "composition" as const,
        e,
      })),
    ];
    all.sort((a, b) =>
      a.e.blockNumber !== b.e.blockNumber
        ? Number(a.e.blockNumber - b.e.blockNumber)
        : a.e.logIndex - b.e.logIndex,
    );

    const countryOfAccount = new Map<Address, bigint>();
    const owners = new Map<bigint, Address | undefined>();
    const versions = new Map<bigint, { version: bigint; squareCount: bigint }>();
    const holders = new Map<bigint, { holder: Address; country: bigint }>();
    for (const { kind, e } of all) {
      if (kind === "created") {
        countryOfAccount.set(getAddress(e.args.account!), e.args.countryId!);
      } else if (kind === "composition") {
        versions.set(e.args.countryId!, { version: e.args.version!, squareCount: e.args.squareCount! });
      } else if (kind === "country") {
        const to = getAddress(e.args.to!);
        owners.set(e.args.tokenId!, to === zeroAddress ? undefined : to);
      } else {
        const to = getAddress(e.args.to!);
        holders.set(e.args.tokenId!, { holder: to, country: countryOfAccount.get(to) ?? 0n });
      }
    }

    const problems: string[] = [];
    for (const [id, c] of model.countries) {
      if (owners.get(id) !== c.owner) problems.push(`owner of #${id}: events ${owners.get(id)}, model ${c.owner}`);
      const v = versions.get(id);
      const count = BigInt(model.cellsOf(id).size);
      if (v?.version !== c.version || v?.squareCount !== count) {
        problems.push(`#${id}: events version ${v?.version} count ${v?.squareCount}, model ${c.version} ${count}`);
      }
    }
    if (owners.size !== model.countries.size) {
      problems.push(`events name ${owners.size} countries, model ${model.countries.size}`);
    }
    for (const [k, sq] of model.squares) {
      const { lat, lng } = locOf(k);
      const h = holders.get(squareId(lat, lng));
      if (h?.holder !== sq.holder || h?.country !== sq.country) {
        problems.push(`square ${fmt(k)}: events ${h?.holder} in ${h?.country}, model ${sq.holder} in ${sq.country}`);
      }
    }
    if (holders.size !== model.squares.size) {
      problems.push(`events name ${holders.size} squares, model ${model.squares.size}`);
    }
    if (problems.length > 0) throw new Divergence(`rebuild from events:\n${problems.join("\n")}`);
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
      await op.run();
      await checkInvariants();
    }
    await checkEventRebuild();
  } catch (e) {
    const tail = log.slice(-40).join("\n  ");
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(
      `land fuzz failed: seed ${seed}, window ${place.name}\n` +
        `repeat: LAND_FUZZ_SEED=${seed} LAND_FUZZ_OPS=${OPS} npx hardhat test test/GaiaLand.property.ts\n` +
        `${message}\noperation log (last 40):\n  ${tail}`,
    );
  }
  if (process.env.LAND_FUZZ_VERBOSE !== undefined) {
    console.log(
      `seed ${seed}: ${counts.ok} calls succeeded, ${counts.reverted} reverted as expected, ` +
        `${model.countries.size} countries, ${model.squares.size} squares, ` +
        `burned ${model.countries.size - model.liveIds().length}, ` +
        `reverts ${[...outcomes].map(([e, n]) => `${e} ${n}`).join(", ")}`,
    );
  }
}
