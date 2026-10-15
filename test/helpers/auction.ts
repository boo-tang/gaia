import { expect } from "chai";

import { viem } from "./setup";
import type { Land } from "./land";

type Loc = { lat: number; lng: number };
type Wallet = Awaited<ReturnType<typeof viem.getWalletClients>>[number];

/// Packs squares as `bidOnShape` takes them: `(lat << 16) | lng`.
export const pack = (locs: readonly Loc[]): number[] =>
  locs.map(({ lat, lng }) => lat * 65536 + lng);

/// The errors of the shape rule (GaiaAuction._validateShape). The names are part of the
/// interface, but when a square list breaks more than one rule, the error that comes first is
/// not. A test of such a list accepts any of these errors.
export const SHAPE_ERRORS = [
  "EmptyShape",
  "ShapeTooSmall",
  "ShapeTooLarge",
  "InvalidCoordinates",
  "GapBetweenLongitudes",
  "Unsorted",
  "NonConsecutiveLatitudes",
  "NoLatAdjacency",
  "NotConvexStart",
  "NotConvexEnd",
  "AspectRatioExceeded",
] as const;

/// Expects `call` to revert with one of `errors`.
export async function expectRevertWithOneOf(
  call: Promise<unknown>,
  errors: readonly string[]
) {
  await expect(call).to.be.rejectedWith(new RegExp(`\\b(${errors.join("|")})\\(`));
}

/// The constructor values of GaiaAuction, without the GaiaCountries address.
export type AuctionParams = {
  treasury: `0x${string}`;
  startTime: bigint;
  endTime: bigint;
  maxEndTime: bigint;
  extensionWindow: bigint;
  minBidPerSquareWei: bigint;
  minBidIncrementBps: bigint;
  minShapeSquares: bigint;
  maxShapeSquares: bigint;
  maxShapeAspectRatio: bigint;
};

/// Deploys GaiaAuction for `land`. A test gives only the values that it is about. Defaults: the
/// default wallet is the treasury; the auction started 10 s ago and ends in 1 h, from the chain
/// clock; no soft close (`maxEndTime = endTime`, window 0); bids of 1000 wei and a step of 1000
/// wei; shapes of 1 to 1000 squares with an aspect ratio of up to 10.
///
/// With `register` (default true), the auction gets ISSUER_ROLE and is registered in
/// GaiaCountries, as in the deployment. `v` is the connection to deploy on (default: the shared
/// connection). Returns the auction and the values that it got.
export async function deployAuction(
  land: Pick<Land, "countries">,
  params: Partial<AuctionParams> = {},
  { register = true, v = viem }: { register?: boolean; v?: typeof viem } = {}
) {
  const publicClient = await v.getPublicClient();
  const [admin] = await v.getWalletClients();
  const now = (await publicClient.getBlock()).timestamp;
  const endTime = params.endTime ?? now + 3600n;
  const p: AuctionParams = {
    treasury: admin.account.address,
    startTime: now - 10n,
    maxEndTime: endTime,
    extensionWindow: 0n,
    minBidPerSquareWei: 1000n,
    minBidIncrementBps: 0n,
    minShapeSquares: 1n,
    maxShapeSquares: 1000n,
    maxShapeAspectRatio: 10n,
    ...params,
    endTime,
  };
  const auction = await v.deployContract("GaiaAuction", auctionArgs(land, p));
  if (register) {
    const { countries } = land;
    await countries.write.grantRole([await countries.read.ISSUER_ROLE(), auction.address]);
    await countries.write.addAuction([auction.address]);
  }
  return { auction, ...p };
}

/// The constructor arguments of GaiaAuction, in order. For the tests of the constructor checks.
export function auctionArgs(land: Pick<Land, "countries">, p: AuctionParams) {
  return [
    land.countries.address,
    p.treasury,
    p.startTime,
    p.endTime,
    p.maxEndTime,
    p.extensionWindow,
    p.minBidPerSquareWei,
    p.minBidIncrementBps,
    p.minShapeSquares,
    p.maxShapeSquares,
    p.maxShapeAspectRatio,
  ] as const;
}

/// Expects the sum of `activeBids` of `bidders` to equal `proceeds`. `bidders` must be all the
/// bidders of the auction. Holds until a cancel or `withdrawProceeds`.
export async function expectActiveBidsEqualProceeds(
  auction: Awaited<ReturnType<typeof deployAuction>>["auction"],
  bidders: readonly `0x${string}`[]
) {
  let active = 0n;
  for (const bidder of bidders) active += await auction.read.activeBids([bidder]);
  expect(active).to.equal(await auction.read.proceeds());
}

/// The auction at `address`, with `wallet` as the sender.
export function auctionAs(address: `0x${string}`, wallet: Wallet, v = viem) {
  return v.getContractAt("GaiaAuction", address, { client: { wallet } });
}

/// The constructor values of GaiaLandSale, without the GaiaCountries and GaiaAuction addresses.
export type SaleParams = {
  treasury: `0x${string}`;
  startPrice: bigint;
  endPrice: bigint;
  holdDuration: bigint;
  dropDuration: bigint;
};

/// Deploys GaiaLandSale for `land` and `auction`. With `grantIssuer` (default true), the sale
/// gets ISSUER_ROLE.
export async function deploySale(
  land: Pick<Land, "countries">,
  auction: `0x${string}`,
  p: SaleParams,
  { grantIssuer = true, v = viem }: { grantIssuer?: boolean; v?: typeof viem } = {}
) {
  const sale = await v.deployContract("GaiaLandSale", saleArgs(land, auction, p));
  if (grantIssuer) {
    const { countries } = land;
    await countries.write.grantRole([await countries.read.ISSUER_ROLE(), sale.address]);
  }
  return sale;
}

/// The constructor arguments of GaiaLandSale, in order. For the tests of the constructor checks.
export function saleArgs(
  land: Pick<Land, "countries">,
  auction: `0x${string}`,
  p: SaleParams
) {
  return [
    land.countries.address,
    auction,
    p.treasury,
    p.startPrice,
    p.endPrice,
    p.holdDuration,
    p.dropDuration,
  ] as const;
}
