import { expect } from "chai";

import { encodeFunctionData, getAddress } from "viem";
import { network } from "hardhat";

import { coverage } from "./helpers/setup";
import { pack } from "./helpers/auction";
import { deployAccount, deployLand, executeAs, squareId } from "./helpers/land";

// Own connection on the Prague hardfork, the same as test/Gaia_Auction.gas.ts.
const { viem, networkHelpers } = await network.create({
  override: { hardfork: "prague", blockGasLimit: 1_000_000_000n },
});
const loadFixture = networkHelpers.loadFixture.bind(networkHelpers);
const time = networkHelpers.time;

// Gas of the land operations after the auction, measured from transaction receipts: a split of
// one square out of a country, a merge of one square into a country, a country transfer (plain
// ERC-721 and through GaiaCountryMarket), and purchases from GaiaLandSale. GAS_REPORT=1 prints
// each measurement. Each test checks an upper bound of two times its measurement, except under
// --coverage, because the instrumented contracts use more gas. These operations are far below the
// Base gas cap, so gas is only a cost to the user, and no requirement sets the bounds. A bound
// finds a large regression (for example an operation that becomes proportional to the size of
// the country). A failure means "look at the change", not "a bug": if the change is correct,
// update the measurement.
describe("Land: gas", function () {
  const report = process.env.GAS_REPORT === "1";

  type Loc = { lat: number; lng: number };

  // Rectangle of `rows` x `cols` squares with its south-west square at (lat, lng). Each square
  // touches an earlier square.
  const rect = (lat: number, lng: number, rows: number, cols: number): Loc[] => {
    const locs: Loc[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) locs.push({ lat: lat + r, lng: lng + c });
    }
    return locs;
  };

  // Alice owns country 1, a 10 x 10 square at (100, 100), and country 2, one square at
  // (200, 200). The account of country 1 is deployed. An auction is registered and has ended,
  // so the land sale is open.
  async function deployGas() {
    const [admin, alice, bob, treasury] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();
    const land = await deployLand(admin.account.address, viem);
    const { countries } = land;
    const issuerRole = await countries.read.ISSUER_ROLE();
    await countries.write.grantRole([issuerRole, admin.account.address]);

    const now = BigInt(await time.latest());
    const end = now + 3600n;
    const auction = await viem.deployContract(
      "contracts/GaiaAuction.sol:GaiaAuction",
      [
        countries.address,
        treasury.account.address,
        now - 10n,
        end,
        end, // maxEndTime
        0n, // extensionWindow
        1000n, // minBidPerSquareWei
        0n, // minBidIncrementBps
        1n, // minShapeSquares
        1000n, // maxShapeSquares
        10n, // maxShapeAspectRatio
      ]
    );
    await countries.write.grantRole([issuerRole, auction.address]);
    await countries.write.addAuction([auction.address]);
    const sale = await viem.deployContract("GaiaLandSale", [
      countries.address,
      auction.address,
      treasury.account.address,
      1000n, // startPrice
      1000n, // endPrice
      0n, // holdDuration
      1n, // dropDuration
    ]);
    await countries.write.grantRole([issuerRole, sale.address]);
    const market = await viem.deployContract("GaiaCountryMarket", [
      countries.address,
    ]);

    await countries.write.createCountry([alice.account.address, rect(100, 100, 10, 10)]);
    await countries.write.createCountry([alice.account.address, rect(200, 200, 1, 1)]);
    const account = await deployAccount(land, 1n);
    await time.increaseTo(end + 1n);

    const as = (wallet: typeof admin) => ({
      countries: viem.getContractAt("GaiaCountries", countries.address, {
        client: { wallet },
      }),
      squares: viem.getContractAt("GaiaSquares", land.squares.address, {
        client: { wallet },
      }),
      market: viem.getContractAt("GaiaCountryMarket", market.address, {
        client: { wallet },
      }),
      sale: viem.getContractAt("GaiaLandSale", sale.address, {
        client: { wallet },
      }),
    });

    return {
      publicClient,
      land,
      market,
      account,
      alice,
      bob,
      aliceAddress: getAddress(alice.account.address),
      bobAddress: getAddress(bob.account.address),
      asAlice: as(alice),
      asBob: as(bob),
    };
  }

  type Gas = Awaited<ReturnType<typeof deployGas>>;

  async function gasOf(f: Gas, hash: `0x${string}`) {
    const receipt = await f.publicClient.waitForTransactionReceipt({ hash });
    expect(receipt.status).to.equal("success");
    return receipt.gasUsed;
  }

  // `measured` is the gas at 45889d1 (GAS_REPORT=1).
  function expectBelowTwice(gas: bigint, measured: bigint) {
    expect(gas < 2n * measured, `gas ${gas} is more than 2 x ${measured}`).to.equal(true);
  }

  function log(label: string, gas: bigint) {
    if (report) console.log(`      ${label}: ${gas.toLocaleString("en-US")}`);
  }

  // The account of country `countryId` sends one square to `to`. Alice owns the country.
  async function split(f: Gas, account: `0x${string}`, to: `0x${string}`, loc: Loc) {
    const data = encodeFunctionData({
      abi: f.land.squares.abi,
      functionName: "transferFrom",
      args: [account, to, squareId(loc.lat, loc.lng)],
    });
    return gasOf(f, await executeAs(f.land, f.alice, account, f.land.squares, data));
  }

  // Alice sends one square from her wallet into the account of a country that she owns.
  async function merge(f: Gas, account: `0x${string}`, loc: Loc) {
    const squares = await f.asAlice.squares;
    const hash = await squares.write.transferFrom([
      f.aliceAddress,
      account,
      squareId(loc.lat, loc.lng),
    ]);
    return gasOf(f, hash);
  }

  describe("split and merge", function () {
    it("splits a corner square of a 10 x 10 country to a wallet", async function () {
      const f = await loadFixture(deployGas);
      const gas = await split(f, f.account, f.aliceAddress, { lat: 100, lng: 100 });
      log("split (corner)", gas);
      expect(await f.land.countries.read.squareCount([1n])).to.equal(99n);
      if (coverage) this.skip();
      expectBelowTwice(gas, 138_861n);
    });

    it("splits an edge square of a 10 x 10 country to a wallet", async function () {
      const f = await loadFixture(deployGas);
      const gas = await split(f, f.account, f.aliceAddress, { lat: 100, lng: 105 });
      log("split (edge)", gas);
      if (coverage) this.skip();
      expectBelowTwice(gas, 138_922n);
    });

    it("splits the last square of a country (burns the country)", async function () {
      const f = await loadFixture(deployGas);
      const account = await deployAccount(f.land, 2n);
      const gas = await split(f, account, f.aliceAddress, { lat: 200, lng: 200 });
      log("split (last square, burn)", gas);
      expect(await f.land.countries.read.squareCount([2n])).to.equal(0n);
      if (coverage) this.skip();
      expectBelowTwice(gas, 116_502n);
    });

    it("merges a square from a wallet into a 10 x 10 country", async function () {
      const f = await loadFixture(deployGas);
      await split(f, f.account, f.aliceAddress, { lat: 100, lng: 105 });
      const gas = await merge(f, f.account, { lat: 100, lng: 105 });
      log("merge (into the notch)", gas);
      expect(await f.land.countries.read.squareCount([1n])).to.equal(100n);
      if (coverage) this.skip();
      expectBelowTwice(gas, 107_835n);
    });

    it("merges a square from a wallet onto the edge of a 10 x 10 country", async function () {
      const f = await loadFixture(deployGas);
      // Alice buys a free square next to the country as country 3, splits it to her wallet
      // (country 3 is burned), then merges it.
      const sale = await f.asAlice.sale;
      await sale.write.buy([pack([{ lat: 110, lng: 100 }])], { value: 1000n });
      const account3 = await deployAccount(f.land, 3n);
      await split(f, account3, f.aliceAddress, { lat: 110, lng: 100 });
      const gas = await merge(f, f.account, { lat: 110, lng: 100 });
      log("merge (onto the edge)", gas);
      expect(await f.land.countries.read.squareCount([1n])).to.equal(101n);
      if (coverage) this.skip();
      expectBelowTwice(gas, 107_732n);
    });
  });

  describe("land sale", function () {
    for (const n of [1, 10]) {
      it(`buys a new country of ${n} squares`, async function () {
        const f = await loadFixture(deployGas);
        const sale = await f.asBob.sale;
        const hash = await sale.write.buy([pack(rect(300, 300, 1, n))], {
          value: 1000n * BigInt(n),
        });
        const gas = await gasOf(f, hash);
        log(`sale buy ${n}`, gas);
        expect(await f.land.countries.read.squareCount([3n])).to.equal(BigInt(n));
        if (coverage) this.skip();
        expectBelowTwice(gas, n === 1 ? 266_509n : 898_319n);
      });

      it(`buys ${n} squares into a 10 x 10 country`, async function () {
        const f = await loadFixture(deployGas);
        const sale = await f.asAlice.sale;
        // The row north of country 1.
        const hash = await sale.write.buyInto([1n, pack(rect(110, 100, 1, n))], {
          value: 1000n * BigInt(n),
        });
        const gas = await gasOf(f, hash);
        log(`sale buyInto ${n}`, gas);
        expect(await f.land.countries.read.squareCount([1n])).to.equal(100n + BigInt(n));
        if (coverage) this.skip();
        expectBelowTwice(gas, n === 1 ? 163_522n : 785_816n);
      });
    }
  });

  describe("country transfer", function () {
    it("transfers a country (ERC-721 transferFrom)", async function () {
      const f = await loadFixture(deployGas);
      const countries = await f.asAlice.countries;
      const hash = await countries.write.transferFrom([f.aliceAddress, f.bobAddress, 1n]);
      const gas = await gasOf(f, hash);
      log("country transferFrom", gas);
      if (coverage) this.skip();
      expectBelowTwice(gas, 62_164n);
    });

    it("sells a country through GaiaCountryMarket.buy", async function () {
      const f = await loadFixture(deployGas);
      const countries = await f.asAlice.countries;
      const market = await f.asAlice.market;
      await countries.write.approve([f.market.address, 1n]);
      const listGas = await gasOf(f, await market.write.list([1n, 10n ** 18n]));
      log("market list", listGas);
      const version = await f.land.countries.read.compositionVersion([1n]);
      const state = await f.market.read.accountState([1n]);
      const buy = await f.asBob.market;
      const hash = await buy.write.buy([1n, version, state], { value: 10n ** 18n });
      const gas = await gasOf(f, hash);
      log("market buy", gas);
      expect(getAddress(await f.land.countries.read.ownerOf([1n]))).to.equal(f.bobAddress);
      if (coverage) this.skip();
      expectBelowTwice(listGas, 102_115n);
      expectBelowTwice(gas, 95_481n);
    });
  });
});
