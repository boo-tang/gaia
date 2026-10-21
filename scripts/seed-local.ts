import { network } from "hardhat";
import fs from "node:fs";
import path from "node:path";
import { zeroAddress } from "viem";

/*
 * Puts a small amount of data on the local deployment of `yarn deploy:local`, for app work:
 *
 *   yarn seed:local               # three bids from Anvil accounts 3, 4 and 5
 *   SEED_END=1 yarn seed:local    # also moves the chain clock past endTime and settles shape 1
 *
 * LOCAL_DEPLOYMENT_ID (default "local") selects deployments/<id>.json, as in deploy-local.ts.
 *
 * Only for a local node. A second run skips the bids that are already there and a shape that is
 * already settled. After SEED_END=1 the auction is closed and the land sale is open; restart
 * Anvil and deploy again for a new auction.
 */

const OUT_FILE = path.join("deployments", `${process.env.LOCAL_DEPLOYMENT_ID || "local"}.json`);
if (!fs.existsSync(OUT_FILE)) throw new Error(`No ${OUT_FILE}. Run \`yarn deploy:local\` first.`);
const deployment = JSON.parse(fs.readFileSync(OUT_FILE, "utf8"));

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
const auction = await viem.getContractAt("GaiaAuction", auctionAddress);
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

const now = async () => (await publicClient.getBlock()).timestamp;
let endTime = await auction.read.endTime();
if ((await now()) < endTime) {
  const minBid = await auction.read.minBidPerSquareWei();
  for (const { wallet, shape } of bids) {
    const [bidder] = await auction.read.highestBids([shape[0].lat, shape[0].lng]);
    if (bidder !== zeroAddress) {
      console.log(`Skip: ${wallet.account.address} has a bid there already.`);
      continue;
    }
    const asBidder = await viem.getContractAt("GaiaAuction", auctionAddress, {
      client: { wallet },
    });
    const hash = await asBidder.write.bidOnShape([pack(shape), 0n, false], {
      value: minBid * BigInt(shape.length),
    });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`Bid: ${wallet.account.address}, ${shape.length} squares.`);
  }
} else {
  console.log("The auction has ended. No bids.");
}

if (process.env.SEED_END === "1") {
  // Read endTime again: a bid in the extension window moves it.
  endTime = await auction.read.endTime();
  if ((await now()) <= endTime) {
    await provider.request({ method: "evm_setNextBlockTimestamp", params: [Number(endTime + 1n)] });
    await provider.request({ method: "evm_mine", params: [] });
    console.log(`Moved the chain clock past endTime (${endTime}).`);
  }
  if ((await auction.read.shapeCountryId([1n])) === 0n) {
    const hash = await auction.write.settleShape([1n, 0n]);
    await publicClient.waitForTransactionReceipt({ hash });
  }
  console.log(`Shape 1 is settled: country ${await auction.read.shapeCountryId([1n])}.`);
}
