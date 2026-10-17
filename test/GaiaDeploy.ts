import { expect } from "chai";
import { getAddress, zeroHash } from "viem";

import GaiaSystemModule from "../ignition/modules/GaiaSystem";
import { auctionTimes, readParameters, withAuctionTimes } from "../scripts/lib/local-parameters";
import { CANONICAL_REGISTRY, ensureRegistry } from "../scripts/lib/registry";
import { grantSaleIssuer } from "../scripts/lib/sale-issuer";
import { pack } from "./helpers/auction";
import { ignition, loadFixture, provider, time, viem } from "./helpers/setup";

/*
 * The deployment of `npm run deploy:local`: the Ignition modules with
 * ignition/parameters/local.json, the registry at its canonical address, and the issuer grant of
 * the land sale. The contracts cannot change after deployment, so a wrong role or a missing step
 * here is a real risk.
 */
describe("Deploy: Ignition modules with the local parameters", function () {
  const DEFAULT_ADMIN_ROLE = zeroHash;

  async function deployLocal() {
    await ensureRegistry({ viem, provider });
    const now = (await (await viem.getPublicClient()).getBlock()).timestamp;
    // No environment variables, so that the test always uses the defaults.
    const parameters = withAuctionTimes(readParameters(), auctionTimes(now, {}));
    const deployed = await ignition.deploy(GaiaSystemModule, { parameters });
    const [deployer] = await viem.getWalletClients();
    return { ...deployed, parameters, deployer: getAddress(deployer.account.address) };
  }

  it("gets the parameters of the file and adds the auction times from the chain clock", async function () {
    const { parameters } = await loadFixture(deployLocal);
    const now = BigInt(await time.latest());
    const { startTime, endTime, maxEndTime } = parameters.GaiaModule;
    expect(startTime).to.be.a("bigint");
    expect(Number(now - (startTime as bigint))).to.be.lessThan(60);
    expect(endTime).to.equal((startTime as bigint) + 3600n);
    expect(maxEndTime).to.equal((endTime as bigint) + 24n * 3600n);
    expect(parameters.GaiaModule.registry).to.equal(CANONICAL_REGISTRY);
  });

  it("links GaiaCountries and GaiaSquares", async function () {
    const { countries, squares } = await loadFixture(deployLocal);
    expect(getAddress(await countries.read.squares())).to.equal(getAddress(squares.address));
    expect(getAddress(await squares.read.countries())).to.equal(getAddress(countries.address));
  });

  it("makes the auction an issuer and registers it", async function () {
    const { countries, auction } = await loadFixture(deployLocal);
    const issuerRole = await countries.read.ISSUER_ROLE();
    expect(await countries.read.hasRole([issuerRole, auction.address])).to.equal(true);
    expect((await countries.read.auctions()).map(getAddress)).to.deep.equal([
      getAddress(auction.address),
    ]);
  });

  it("moves the admin role from the deployer to the admin, with no issuer role for either", async function () {
    const { countries, parameters, deployer } = await loadFixture(deployLocal);
    const admin = parameters.GaiaModule.admin as `0x${string}`;
    const issuerRole = await countries.read.ISSUER_ROLE();
    expect(await countries.read.hasRole([DEFAULT_ADMIN_ROLE, admin])).to.equal(true);
    expect(await countries.read.hasRole([DEFAULT_ADMIN_ROLE, deployer])).to.equal(false);
    expect(await countries.read.hasRole([issuerRole, admin])).to.equal(false);
    expect(await countries.read.hasRole([issuerRole, deployer])).to.equal(false);
  });

  it("gives the auction each value of the parameters file", async function () {
    const { countries, auction, parameters } = await loadFixture(deployLocal);
    const p = parameters.GaiaModule;
    expect(getAddress(await auction.read.countries())).to.equal(getAddress(countries.address));
    expect(getAddress(await auction.read.treasury())).to.equal(getAddress(p.treasury as string));
    expect(await auction.read.startTime()).to.equal(p.startTime);
    expect(await auction.read.endTime()).to.equal(p.endTime);
    expect(await auction.read.maxEndTime()).to.equal(p.maxEndTime);
    expect(await auction.read.extensionWindow()).to.equal(p.extensionWindow);
    expect(await auction.read.minBidPerSquareWei()).to.equal(p.minBidPerSquareWei);
    expect(await auction.read.minBidIncrementBps()).to.equal(p.minBidIncrementBps);
    expect(await auction.read.minShapeSquares()).to.equal(p.minShapeSquares);
    expect(await auction.read.maxShapeSquares()).to.equal(p.maxShapeSquares);
    expect(await auction.read.maxShapeAspectRatio()).to.equal(p.maxShapeAspectRatio);
  });

  it("deploys the land sale with the values of the file, and with no issuer role", async function () {
    const { countries, auction, sale, parameters } = await loadFixture(deployLocal);
    const p = parameters.GaiaLandSaleModule;
    expect(getAddress(await sale.read.countries())).to.equal(getAddress(countries.address));
    expect(getAddress(await sale.read.auction())).to.equal(getAddress(auction.address));
    expect(getAddress(await sale.read.treasury())).to.equal(getAddress(p.treasury as string));
    expect(await sale.read.startPrice()).to.equal(p.startPrice);
    expect(await sale.read.endPrice()).to.equal(p.endPrice);
    expect(await sale.read.holdDuration()).to.equal(p.holdDuration);
    expect(await sale.read.dropDuration()).to.equal(p.dropDuration);
    const issuerRole = await countries.read.ISSUER_ROLE();
    expect(await countries.read.hasRole([issuerRole, sale.address])).to.equal(false);
  });

  it("lets the admin grant the issuer role to the land sale, once", async function () {
    const { countries, sale, parameters } = await loadFixture(deployLocal);
    const admin = parameters.GaiaModule.admin as `0x${string}`;
    const issuerRole = await countries.read.ISSUER_ROLE();
    expect(await grantSaleIssuer({ viem }, countries.address, sale.address, admin)).to.equal(true);
    expect(await countries.read.hasRole([issuerRole, sale.address])).to.equal(true);
    expect(await grantSaleIssuer({ viem }, countries.address, sale.address, admin)).to.equal(false);
  });

  it("deploys the country market for GaiaCountries", async function () {
    const { countries, market } = await loadFixture(deployLocal);
    expect(getAddress(await market.read.countries())).to.equal(getAddress(countries.address));
  });

  it("derives the country accounts from the registry at the canonical address", async function () {
    const { countries, accountImplementation } = await loadFixture(deployLocal);
    expect(getAddress(await countries.read.registry())).to.equal(CANONICAL_REGISTRY);
    expect(getAddress(await countries.read.accountImplementation())).to.equal(
      getAddress(accountImplementation.address)
    );
    const registry = await viem.getContractAt("ERC6551Registry", CANONICAL_REGISTRY);
    const chainId = BigInt(await (await viem.getPublicClient()).getChainId());
    const expected = await registry.read.account([
      accountImplementation.address,
      await countries.read.ACCOUNT_SALT(),
      chainId,
      countries.address,
      1n,
    ]);
    expect(getAddress(await countries.read.accountOf([1n]))).to.equal(getAddress(expected));
  });

  it("does not set the registry code again when the address has code", async function () {
    await loadFixture(deployLocal);
    expect(await ensureRegistry({ viem, provider })).to.equal(false);
  });

  it("runs one bid, the end of the auction and a settlement, and the country goes to the bidder", async function () {
    const { countries, auction, sale, parameters } = await loadFixture(deployLocal);
    const [, , , bidder] = await viem.getWalletClients();
    const asBidder = await viem.getContractAt("GaiaAuction", auction.address, {
      client: { wallet: bidder },
    });
    const squaresOfShape = [
      { lat: 10, lng: 10 },
      { lat: 10, lng: 11 },
    ];
    const minBid = parameters.GaiaModule.minBidPerSquareWei as bigint;
    await asBidder.write.bidOnShape([pack(squaresOfShape), 0n, false], {
      value: minBid * BigInt(squaresOfShape.length),
    });
    expect(await sale.read.isOpen()).to.equal(false);

    await time.increaseTo((await auction.read.endTime()) + 1n);
    expect(await sale.read.isOpen()).to.equal(true);
    await auction.write.settleShape([1n, 0n]);
    const countryId = await auction.read.shapeCountryId([1n]);
    expect(getAddress(await countries.read.ownerOf([countryId]))).to.equal(
      getAddress(bidder.account.address)
    );
    expect(await countries.read.squareCount([countryId])).to.equal(2n);
  });
});
