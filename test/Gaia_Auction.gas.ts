import { expect } from "chai";

import { network } from "hardhat";

import { coverage } from "./helpers/setup";
import { deployLand } from "./helpers/land";

// Own connection on the Prague hardfork, which has no per-transaction gas cap (EIP-7825 starts
// with Osaka). Thus a test can measure a bid above the cap. Base applies the cap.
const { viem, networkHelpers } = await network.create({
  override: { hardfork: "prague", blockGasLimit: 1_000_000_000n },
});
const loadFixture = networkHelpers.loadFixture.bind(networkHelpers);
const time = networkHelpers.time;

// Gas of the worst cases of a bid and of settlement, measured from transaction receipts.
// GAS_REPORT=1 prints each measurement. The bounds are skipped under --coverage, because the
// instrumented contracts use more gas.
describe("GaiaAuction: gas", function () {
  const minBid = 1000n;
  const report = process.env.GAS_REPORT === "1";

  type Loc = { lat: number; lng: number };

  async function deployGas() {
    const [owner, alice, bob] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();
    const { countries } = await deployLand(owner.account.address, viem);

    const now = await time.latest();
    const end = BigInt(now + 3600);
    const auction = await viem.deployContract(
      "contracts/GaiaAuction.sol:GaiaAuction",
      [
        countries.address,
        owner.account.address, // treasury
        BigInt(now - 10),
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

    const as = async (wallet: typeof owner) =>
      viem.getContractAt("contracts/GaiaAuction.sol:GaiaAuction", auction.address, {
        client: { wallet },
      });

    return {
      publicClient,
      auction,
      alice: alice.account.address,
      bob: bob.account.address,
      asAlice: await as(alice),
      asBob: await as(bob),
      end,
    };
  }

  type Gas = Awaited<ReturnType<typeof deployGas>>;
  type Bidder = Gas["asAlice"];

  // Rectangle of `rows` x `cols` squares with its south-west square at (lat, lng), in bid order.
  const rect = (lat: number, lng: number, rows: number, cols: number): Loc[] => {
    const locs: Loc[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) locs.push({ lat: lat + r, lng: lng + c });
    }
    return locs;
  };

  async function gasOf(f: Gas, hash: `0x${string}`) {
    const receipt = await f.publicClient.waitForTransactionReceipt({ hash });
    expect(receipt.status).to.equal("success");
    return receipt.gasUsed;
  }

  async function bid(
    f: Gas,
    as: Bidder,
    locs: Loc[],
    value: bigint,
    raiseOwnSquares = false
  ) {
    const hash = await as.write.bidOnShape([locs, 0n, raiseOwnSquares], {
      value,
      gas: 200_000_000n,
    });
    return gasOf(f, hash);
  }

  async function expectActiveBidsEqualProceeds(f: Gas) {
    const active =
      (await f.auction.read.activeBids([f.alice])) +
      (await f.auction.read.activeBids([f.bob]));
    expect(active).to.equal(await f.auction.read.proceeds());
  }

  function log(label: string, gas: bigint) {
    if (report) console.log(`      ${label}: ${gas.toLocaleString("en-US")}`);
  }

  describe("new bid on free land", function () {
    for (const n of [5, 10, 15, 20]) {
      it(`${n} x ${n} squares`, async function () {
        const f = await loadFixture(deployGas);
        const locs = rect(100, 100, n, n);
        const gas = await bid(f, f.asAlice, locs, minBid * BigInt(locs.length));
        log(`new ${n}x${n}`, gas);
        await expectActiveBidsEqualProceeds(f);
      });
    }
  });

  // K shapes of 4 rows x 25 columns (100 squares each) are stacked from south to north. The new
  // bid takes the 8 west columns of all of them, so each remainder is a valid 4 x 17 rectangle.
  // Each remainder check reads all squares of its shape.
  describe("bid that takes part of K shapes", function () {
    const rows = 4;
    const cols = 25;
    const taken = 8;
    for (const k of [5, 10, 20]) {
      it(`${k} shapes of ${rows * cols} squares`, async function () {
        const f = await loadFixture(deployGas);
        for (let i = 0; i < k; i++) {
          await bid(f, f.asAlice, rect(100 + i * rows, 100, rows, cols), minBid * BigInt(rows * cols));
        }
        const locs = rect(100, 100, k * rows, taken);
        const gas = await bid(f, f.asBob, locs, 2n * minBid * BigInt(locs.length));
        log(`overlap K=${k} (bid ${locs.length} squares)`, gas);
        await expectActiveBidsEqualProceeds(f);
      });
    }
  });

  describe("re-bid on own squares", function () {
    for (const raise of [false, true]) {
      it(`10 x 10, raiseOwnSquares = ${raise}`, async function () {
        const f = await loadFixture(deployGas);
        const locs = rect(100, 100, 10, 10);
        await bid(f, f.asAlice, locs, minBid * 100n);
        const gas = await bid(f, f.asAlice, locs, raise ? minBid * 100n : 0n, raise);
        log(`re-bid 10x10 raise=${raise}`, gas);
        await expectActiveBidsEqualProceeds(f);
      });
    }
  });

  describe("settlement", function () {
    for (const n of [10, 20]) {
      it(`${n * n} squares in chunks of 100`, async function () {
        const f = await loadFixture(deployGas);
        const locs = rect(100, 100, n, n);
        await bid(f, f.asAlice, locs, minBid * BigInt(locs.length));
        await time.increaseTo(f.end + 1n);

        let largest = 0n;
        let total = 0n;
        const chunks = (n * n) / 100;
        for (let i = 0; i < chunks; i++) {
          const hash = await f.asAlice.write.settleShape([1n, 100n], { gas: 200_000_000n });
          const gas = await gasOf(f, hash);
          if (gas > largest) largest = gas;
          total += gas;
        }
        log(`settle ${n * n} in ${chunks} chunks: largest`, largest);
        log(`settle ${n * n} in ${chunks} chunks: total`, total);
        expect(await f.auction.read.shapeSettleCursor([1n])).to.equal(BigInt(n * n));
      });
    }

    it("400 squares in one call", async function () {
      const f = await loadFixture(deployGas);
      const locs = rect(100, 100, 20, 20);
      await bid(f, f.asAlice, locs, minBid * 400n);
      await time.increaseTo(f.end + 1n);
      const hash = await f.asAlice.write.settleShape([1n, 0n], { gas: 200_000_000n });
      log("settle 400 in one call", await gasOf(f, hash));
    });
  });
});
