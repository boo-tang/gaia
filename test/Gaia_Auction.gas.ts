import { expect } from 'chai';
import { network } from 'hardhat';

import { auctionAs, deployAuction, expectActiveBidsEqualProceeds, pack } from './helpers/auction';
import { deployLand } from './helpers/land';
import { type Loc, rect } from './helpers/shapes';

// Own connection on the Prague hardfork, which has no per-transaction gas cap (EIP-7825 starts
// with Osaka). Thus a test can measure a bid above the cap. Base applies the cap.
const { viem, networkHelpers } = await network.create({
  override: { hardfork: 'prague', blockGasLimit: 1_000_000_000n },
});
const loadFixture = networkHelpers.loadFixture.bind(networkHelpers);
const time = networkHelpers.time;

// Gas of the worst cases of a bid and of settlement, measured from transaction receipts.
// GAS_REPORT=1 prints each measurement. The tests check no gas bounds: the requirement is the Base
// per-transaction cap, and the values that must fit under it (BOO-44, BOO-45) are not chosen yet.
describe('GaiaAuction: gas', function () {
  const minBid = 1000n;
  const report = process.env.GAS_REPORT === '1';

  async function deployGas() {
    const [owner, alice, bob] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();
    const { countries } = await deployLand(owner.account.address, viem);

    // This file has its own connection (`viem`), so the helpers get it as `v`.
    const { auction, endTime: end } = await deployAuction({ countries }, { minBidPerSquareWei: minBid }, { v: viem });

    const as = async (wallet: typeof owner) => auctionAs(auction.address, wallet, viem);

    return {
      publicClient,
      countries,
      auction,
      alice: alice.account.address,
      bob: bob.account.address,
      asAlice: await as(alice),
      asBob: await as(bob),
      end,
    };
  }

  type Gas = Awaited<ReturnType<typeof deployGas>>;
  type Bidder = Gas['asAlice'];

  async function gasOf(f: Gas, hash: `0x${string}`) {
    const receipt = await f.publicClient.waitForTransactionReceipt({ hash });
    expect(receipt.status).to.equal('success');
    return receipt.gasUsed;
  }

  async function bid(f: Gas, as: Bidder, locs: Loc[], value: bigint, raiseOwnSquares = false) {
    const hash = await as.write.bidOnShape([pack(locs), 0n, raiseOwnSquares], {
      value,
      gas: 900_000_000n,
    });
    return gasOf(f, hash);
  }

  function log(label: string, gas: bigint) {
    if (report) console.log(`      ${label}: ${gas.toLocaleString('en-US')}`);
  }

  describe('new bid on free land', function () {
    for (const n of [5, 10, 15, 20]) {
      it(`${n} x ${n} squares`, async function () {
        const f = await loadFixture(deployGas);
        const locs = rect(100, 100, n, n);
        const gas = await bid(f, f.asAlice, locs, minBid * BigInt(locs.length));
        log(`new ${n}x${n}`, gas);
        await expectActiveBidsEqualProceeds(f.auction, [f.alice, f.bob]);
      });
    }
  });

  // K shapes of 4 rows x 25 columns (100 squares each) are stacked from south to north. The new
  // bid takes the 8 west columns of all of them, so each remainder is a valid 4 x 17 rectangle.
  // Each remainder check reads all squares of its shape.
  describe('bid that takes part of K shapes', function () {
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
        await expectActiveBidsEqualProceeds(f.auction, [f.alice, f.bob]);
      });
    }
  });

  // K shapes of 10 rows x 100 columns (1000 squares, the maximum) are stacked from south to
  // north. The new bid takes the 5 west columns of all of them, so each remainder (950
  // squares) is valid and each remainder check reads a full shape. Then a second bid takes the
  // next 5 columns: the remainder check of a shape that lost squares before.
  describe('bid that takes a little of K shapes of 1000 squares', function () {
    const rows = 10;
    const cols = 100;
    const taken = 5;
    for (const k of [1, 2, 5]) {
      it(`${k} shapes`, async function () {
        const f = await loadFixture(deployGas);
        for (let i = 0; i < k; i++) {
          await bid(f, f.asAlice, rect(100 + i * rows, 100, rows, cols), minBid * BigInt(rows * cols));
        }
        const first = rect(100, 100, k * rows, taken);
        const gas = await bid(f, f.asBob, first, 2n * minBid * BigInt(first.length));
        log(`large K=${k} (bid ${first.length} squares)`, gas);
        const second = rect(100, 100 + taken, k * rows, taken);
        const again = await bid(f, f.asBob, second, 2n * minBid * BigInt(second.length));
        log(`large K=${k} again (bid ${second.length} squares)`, again);
        await expectActiveBidsEqualProceeds(f.auction, [f.alice, f.bob]);
      });
    }
  });

  // K shapes of 10 rows x 100 columns (1000 squares, the maximum) in two stacks: the west stack
  // at longitudes 1000 to 1099 and the east stack at 1100 to 1199. The new bid is 10 columns
  // wide (1095 to 1104) and as high as the stacks, so it takes 5 columns of each shape. With
  // `reduce`, Bob first takes 90 columns of each shape, and each shape keeps 10 x 10 squares; the
  // new bid then cuts K small leftovers of shapes that were large.
  function twoStacks(k: number) {
    const rows = 10;
    const cols = 100;
    const shapes: Loc[][] = [];
    const reduce: Loc[][] = [];
    for (let i = 0; i < k; i++) {
      const lat = 100 + Math.floor(i / 2) * rows;
      const west = i % 2 === 0;
      shapes.push(rect(lat, west ? 1000 : 1100, rows, cols));
      reduce.push(rect(lat, west ? 1000 : 1110, rows, 90));
    }
    const bid = rect(100, 1095, Math.ceil(k / 2) * rows, 10);
    return { shapes, reduce, bid };
  }

  for (const reduce of [false, true]) {
    const what = reduce ? 'K small leftovers of shapes of 1000 squares' : 'K shapes of 1000 squares';
    describe(`bid that cuts ${what}`, function () {
      for (const k of [2, 4, 10, 20]) {
        it(`K = ${k}`, async function () {
          const f = await loadFixture(deployGas);
          const layout = twoStacks(k);
          for (const s of layout.shapes) {
            await bid(f, f.asAlice, s, minBid * BigInt(s.length));
          }
          if (reduce) {
            for (const s of layout.reduce) {
              await bid(f, f.asBob, s, 2n * minBid * BigInt(s.length));
            }
          }
          const gas = await bid(f, f.asBob, layout.bid, 2n * minBid * BigInt(layout.bid.length));
          log(`cut ${reduce ? 'leftovers' : 'shapes'} K=${k} (bid ${layout.bid.length} squares)`, gas);
          await expectActiveBidsEqualProceeds(f.auction, [f.alice, f.bob]);
        });
      }
    });
  }

  // The bid that cuts the most shapes: a staircase of N squares (rows of 2 squares, each row one
  // column east of the row below). Each square of the bid is in its own shape of 2 squares, so
  // each square of the bid cuts one shape. With `eachBidder`, each of these shapes has its own
  // bidder, so each square also refunds a different bidder (cold storage for each). Else Alice
  // holds all of them.
  for (const eachBidder of [true, false]) {
    const who = eachBidder ? 'one bidder for each shape' : 'one bidder';
    describe(`bid that cuts one shape for each square, ${who}`, function () {
      for (const n of [100, 500, 1000]) {
        it(`N = ${n}`, async function () {
          this.timeout(600_000);
          const f = await loadFixture(deployGas);
          const stair: Loc[] = [];
          const bidders: `0x${string}`[] = [];
          for (let j = 0; j < n / 2; j++) {
            const lat = 100 + j;
            const lng = 1000 + j;
            stair.push({ lat, lng }, { lat, lng: lng + 1 });
            const dominoes = [
              [
                { lat, lng: lng - 1 },
                { lat, lng },
              ],
              [
                { lat, lng: lng + 1 },
                { lat, lng: lng + 2 },
              ],
            ];
            for (const d of dominoes) {
              let as = f.asAlice;
              if (eachBidder) {
                const address = `0x${(0x10000 + bidders.length).toString(16).padStart(40, '0')}` as const;
                bidders.push(address);
                await networkHelpers.impersonateAccount(address);
                await networkHelpers.setBalance(address, 10n ** 18n);
                as = await auctionAs(f.auction.address, await viem.getWalletClient(address), viem);
              }
              await bid(f, as, d, minBid * 2n);
            }
          }
          const gas = await bid(f, f.asBob, stair, 2n * minBid * BigInt(n));
          log(`cut ${n} shapes of 2 squares, ${who} (bid ${n} squares)`, gas);
          await expectActiveBidsEqualProceeds(f.auction, [...bidders, f.alice, f.bob]);
        });
      }
    });
  }

  describe('re-bid on own squares', function () {
    for (const raise of [false, true]) {
      it(`10 x 10, raiseOwnSquares = ${raise}`, async function () {
        const f = await loadFixture(deployGas);
        const locs = rect(100, 100, 10, 10);
        await bid(f, f.asAlice, locs, minBid * 100n);
        const gas = await bid(f, f.asAlice, locs, raise ? minBid * 100n : 0n, raise);
        log(`re-bid 10x10 raise=${raise}`, gas);
        await expectActiveBidsEqualProceeds(f.auction, [f.alice, f.bob]);
      });
    }
  });

  describe('settlement', function () {
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
        const countryId = await f.auction.read.shapeCountryId([1n]);
        expect(await f.countries.read.squareCount([countryId])).to.equal(BigInt(n * n));
      });
    }

    it('400 squares in one call', async function () {
      const f = await loadFixture(deployGas);
      const locs = rect(100, 100, 20, 20);
      await bid(f, f.asAlice, locs, minBid * 400n);
      await time.increaseTo(f.end + 1n);
      const hash = await f.asAlice.write.settleShape([1n, 0n], { gas: 200_000_000n });
      log('settle 400 in one call', await gasOf(f, hash));
    });
  });
});
