import { network } from 'hardhat';
import fs from 'node:fs';
import path from 'node:path';
import { zeroAddress } from 'viem';

/*
 * Puts a small amount of data on the local deployment of `yarn deploy:local`, for app work:
 *
 *   yarn seed:local                     # three bids from Anvil accounts 3, 4 and 5
 *   SEED_SQUARES=15000 yarn seed:local  # about 15,000 squares with bids, for the map
 *   SEED_END=1 yarn seed:local          # also moves the chain clock past endTime and settles shape 1
 *
 * LOCAL_DEPLOYMENT_ID (default "local") selects deployments/<id>.json, as in deploy-local.ts.
 *
 * Only for a local node. A second run skips the bids that are already there and a shape that is
 * already settled. After SEED_END=1 the auction is closed and the land sale is open; restart
 * Anvil and deploy again for a new auction.
 *
 * SEED_SQUARES=<n>: rectangles of up to `maxShapeSquares` squares from Anvil accounts 3 to 9, at
 * different prices: 80% south-west of London, 10% across the antimeridian (Fiji), 10% at 86°N.
 * A second run with the same n bids on the north half of each rectangle from another account at
 * 1.5 times the price, or one bid step more (live updates, squares taken from other shapes). Each
 * run after it outbids the north halves again. Seed before the end of the auction (one hour after
 * `deploy:local`).
 */

const OUT_FILE = path.join('deployments', `${process.env.LOCAL_DEPLOYMENT_ID || 'local'}.json`);
if (!fs.existsSync(OUT_FILE)) throw new Error(`No ${OUT_FILE}. Run \`yarn deploy:local\` first.`);
const deployment = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));

const connection = await network.getOrCreate();
const { viem, provider } = connection;
const publicClient = await viem.getPublicClient();
if ((await publicClient.getChainId()) !== deployment.chainId) {
  throw new Error(`The node is not the chain of ${OUT_FILE}. Run \`yarn deploy:local\`.`);
}
const auctionAddress = deployment.contracts.GaiaAuction as `0x${string}`;
if ((await publicClient.getCode({ address: auctionAddress })) === undefined) {
  throw new Error(`No auction at ${auctionAddress}. Run \`yarn deploy:local\` on this node.`);
}
const auction = await viem.getContractAt('GaiaAuction', auctionAddress);
const wallets = await viem.getWalletClients();

type Loc = { lat: number; lng: number };
const pack = (locs: Loc[]) => locs.map(({ lat, lng }) => lat * 65536 + lng);
// A rectangle of squares, row by row from the south-west corner.
const rect = (lat: number, lng: number, rows: number, cols: number): Loc[] => {
  const locs: Loc[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) locs.push({ lat: lat + r, lng: lng + c });
  }
  return locs;
};

// Three shapes that do not touch, from Anvil accounts 3, 4 and 5 (0 to 2 are the deployer, the
// admin and the treasury). A square is 1/100 degree: lat = (latitude + 90) * 100 and
// lng = (longitude + 180) * 100. These squares are near 51.5 N, 0 E (London).
const bids = [
  { wallet: wallets[3], shape: rect(14150, 17990, 2, 2) },
  { wallet: wallets[4], shape: rect(14150, 18000, 3, 2) },
  { wallet: wallets[5], shape: rect(14160, 17990, 1, 4) },
];

const bidWith = async (wallet: (typeof wallets)[number], shape: Loc[], floorPerSquare: bigint) => {
  const asBidder = await viem.getContractAt('GaiaAuction', auctionAddress, { client: { wallet } });
  const hash = await asBidder.write.bidOnShape([pack(shape), floorPerSquare, false], {
    value: floorPerSquare * BigInt(shape.length),
  });
  await publicClient.waitForTransactionReceipt({ hash });
};

// SEED_SQUARES: blocks of rectangles. `perRow` rectangles side by side, then the next row of
// rectangles to the north. Columns wrap at the antimeridian.
const seedSquares = async (target: number, minBid: bigint) => {
  const maxSquares = Number(await auction.read.maxShapeSquares());
  const maxRatio = Number(await auction.read.maxShapeAspectRatio());
  const rows = Math.max(1, Math.floor(Math.sqrt(maxSquares / 2)));
  const cols = Math.min(Math.floor(maxSquares / rows), rows * maxRatio);
  const shapeCount = Math.ceil(target / (rows * cols));
  const blocks = [
    { lat: 14000, lng: 17500, perRow: 20, count: shapeCount - 2 * Math.floor(shapeCount / 10) },
    { lat: 7220, lng: 35970, perRow: 4, count: Math.floor(shapeCount / 10) },
    { lat: 17600, lng: 0, perRow: 10, count: Math.floor(shapeCount / 10) },
  ];
  // The London block must stay south of the three normal seed bids (row 14150).
  if (Math.ceil(blocks[0].count / blocks[0].perRow) * rows > 150) {
    throw new Error(`SEED_SQUARES=${target} is too large for the London block. Use a smaller value.`);
  }
  const bidders = wallets.slice(3, 10);
  let index = 0;
  let placed = 0;
  for (const block of blocks) {
    for (let i = 0; i < block.count; i++, index++) {
      const lat = block.lat + Math.floor(i / block.perRow) * rows;
      const lng = block.lng + (i % block.perRow) * cols;
      const shape = rect(lat, lng, rows, cols).map(loc => ({ lat: loc.lat, lng: loc.lng % 36000 }));
      const northHalf = shape.slice(Math.floor(rows / 2) * cols);
      const [bidder, amount] = await auction.read.highestBids([shape[0].lat, shape[0].lng]);
      if (bidder === zeroAddress) {
        await bidWith(bidders[index % bidders.length], shape, minBid * BigInt(1 + (index % 7)));
        placed += shape.length;
        continue;
      }
      // Outbid the north half from the next account after its current bidder.
      const [northBidder, northAmount] = await auction.read.highestBids([northHalf[0].lat, northHalf[0].lng]);
      const current = bidders.findIndex(w => w.account.address.toLowerCase() === northBidder.toLowerCase());
      const next = bidders[(current + 1) % bidders.length];
      // 1.5 times the price, and at least one bid step (`minBidPerSquareWei`) more.
      const highest = northAmount > amount ? northAmount : amount;
      const raised = (highest * 3n) / 2n;
      await bidWith(next, northHalf, raised > highest + minBid ? raised : highest + minBid);
      placed += northHalf.length;
    }
    console.log(`Block at row ${block.lat}, column ${block.lng}: ${block.count} shapes.`);
  }
  console.log(`Bids on ${placed} squares in ${index} shapes of up to ${rows} x ${cols}.`);
};

const now = async () => (await publicClient.getBlock()).timestamp;
let endTime = await auction.read.endTime();
const seedTarget = Number(process.env.SEED_SQUARES || 0);
if ((await now()) < endTime && seedTarget > 0) {
  await seedSquares(seedTarget, await auction.read.minBidPerSquareWei());
} else if ((await now()) < endTime) {
  const minBid = await auction.read.minBidPerSquareWei();
  for (const { wallet, shape } of bids) {
    const [bidder] = await auction.read.highestBids([shape[0].lat, shape[0].lng]);
    if (bidder !== zeroAddress) {
      console.log(`Skip: ${wallet.account.address} has a bid there already.`);
      continue;
    }
    const asBidder = await viem.getContractAt('GaiaAuction', auctionAddress, {
      client: { wallet },
    });
    const hash = await asBidder.write.bidOnShape([pack(shape), 0n, false], {
      value: minBid * BigInt(shape.length),
    });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`Bid: ${wallet.account.address}, ${shape.length} squares.`);
  }
} else {
  console.log('The auction has ended. No bids.');
}

if (process.env.SEED_END === '1') {
  // Read endTime again: a bid in the extension window moves it.
  endTime = await auction.read.endTime();
  if ((await now()) <= endTime) {
    await provider.request({ method: 'evm_setNextBlockTimestamp', params: [Number(endTime + 1n)] });
    await provider.request({ method: 'evm_mine', params: [] });
    console.log(`Moved the chain clock past endTime (${endTime}).`);
  }
  if ((await auction.read.shapeCountryId([1n])) === 0n) {
    const hash = await auction.write.settleShape([1n, 0n]);
    await publicClient.waitForTransactionReceipt({ hash });
  }
  console.log(`Shape 1 is settled: country ${await auction.read.shapeCountryId([1n])}.`);
}
