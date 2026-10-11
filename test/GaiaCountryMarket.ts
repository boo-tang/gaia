import { loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import hre from "hardhat";
import { encodeFunctionData, getAddress, parseEther, zeroAddress } from "viem";

import {
  accountTransferSquare,
  deployAccount,
  deployLand,
  squareId,
} from "./helpers/land";

const row = (lat: number, from: number, to: number) => {
  const out: { lat: number; lng: number }[] = [];
  for (let lng = from; lng <= to; lng++) out.push({ lat, lng });
  return out;
};

describe("GaiaCountryMarket", function () {
  // Alice owns country 1 (row 10, columns 10-12) and lists it for 2 ETH.
  async function deploy() {
    const [admin, issuer, alice, bob, carol] = await hre.viem.getWalletClients();
    const publicClient = await hre.viem.getPublicClient();
    const land = await deployLand(admin.account.address);
    await land.countries.write.grantRole([
      await land.countries.read.ISSUER_ROLE(),
      issuer.account.address,
    ]);
    const asIssuer = await hre.viem.getContractAt(
      "GaiaCountries",
      land.countries.address,
      { client: { wallet: issuer } }
    );
    await asIssuer.write.createCountry([alice.account.address, row(10, 10, 12)]);

    const market = await hre.viem.deployContract("GaiaCountryMarket", [
      land.countries.address,
    ]);
    const marketAs = (
      wallet: Awaited<ReturnType<typeof hre.viem.getWalletClients>>[number]
    ) =>
      hre.viem.getContractAt("GaiaCountryMarket", market.address, {
        client: { wallet },
      });
    const countriesAs = (
      wallet: Awaited<ReturnType<typeof hre.viem.getWalletClients>>[number]
    ) =>
      hre.viem.getContractAt("GaiaCountries", land.countries.address, {
        client: { wallet },
      });
    return {
      land,
      market,
      marketAs,
      countriesAs,
      alice,
      bob,
      carol,
      publicClient,
    };
  }

  const price = parseEther("2");

  async function withListing() {
    const f = await deploy();
    await (await f.countriesAs(f.alice)).write.approve([f.market.address, 1n]);
    await (await f.marketAs(f.alice)).write.list([1n, price]);
    const version = await f.land.countries.read.compositionVersion([1n]);
    return { ...f, version };
  }

  describe("list and cancel", function () {
    it("lists a country for its owner after an approval", async function () {
      const { market, alice } = await loadFixture(withListing);
      const listing = await market.read.listingOf([1n]);
      expect(getAddress(listing.seller)).to.equal(getAddress(alice.account.address));
      expect(listing.price).to.equal(price);
      expect(listing.version).to.equal(3n);
    });

    it("rejects a listing with only an operator approval for all countries", async function () {
      const { market, marketAs, countriesAs, alice } = await loadFixture(deploy);
      await (await countriesAs(alice)).write.setApprovalForAll([
        market.address,
        true,
      ]);
      await expect(
        (await marketAs(alice)).write.list([1n, price])
      ).to.be.rejectedWith("MarketNotApproved");
    });

    it("rejects a listing by a different address than the owner", async function () {
      const { marketAs, bob } = await loadFixture(withListing);
      await expect((await marketAs(bob)).write.list([1n, 1n])).to.be.rejectedWith(
        "NotCountryOwner"
      );
    });

    it("rejects a listing without an approval", async function () {
      const { marketAs, alice } = await loadFixture(deploy);
      await expect(
        (await marketAs(alice)).write.list([1n, price])
      ).to.be.rejectedWith("MarketNotApproved");
    });

    it("lets only the seller cancel", async function () {
      const { market, marketAs, alice, bob, version } = await loadFixture(
        withListing
      );
      await expect((await marketAs(bob)).write.cancel([1n])).to.be.rejectedWith(
        "NotSeller"
      );
      await (await marketAs(alice)).write.cancel([1n]);
      expect((await market.read.listingOf([1n])).price).to.equal(0n);
      await expect(
        (await marketAs(bob)).write.buy([1n, version, 0n], { value: price })
      ).to.be.rejectedWith("NotListed");
    });
  });

  describe("buy", function () {
    it("transfers the country and everything in its account, and pays the seller", async function () {
      const { land, market, marketAs, alice, bob, publicClient } =
        await loadFixture(withListing);
      const account = await deployAccount(land, 1n);
      await alice.sendTransaction({ to: account, value: parseEther("1") });
      const version = await land.countries.read.compositionVersion([1n]);
      const state = await market.read.accountState([1n]);

      const sellerBefore = await publicClient.getBalance({
        address: alice.account.address,
      });
      await (await marketAs(bob)).write.buy([1n, version, state], {
        value: price,
      });

      expect(getAddress(await land.countries.read.ownerOf([1n]))).to.equal(
        getAddress(bob.account.address)
      );
      expect(
        getAddress(await land.squares.read.controllerOf([10, 11]))
      ).to.equal(getAddress(bob.account.address));
      expect(await publicClient.getBalance({ address: account })).to.equal(
        parseEther("1")
      );
      expect(
        await publicClient.getBalance({ address: alice.account.address })
      ).to.equal(sellerBefore + price);
      expect(
        await publicClient.getBalance({ address: market.address })
      ).to.equal(0n);
      expect((await market.read.listingOf([1n])).price).to.equal(0n);

      const sold = await market.getEvents.Sold();
      expect(sold).to.have.lengthOf(1);
      expect(sold[0].args.price).to.equal(price);
    });

    it("uses state 0 for an account that is not deployed", async function () {
      const { land, market, marketAs, bob, version } = await loadFixture(
        withListing
      );
      expect(await market.read.accountState([1n])).to.equal(0n);
      await (await marketAs(bob)).write.buy([1n, version, 0n], { value: price });
      expect(getAddress(await land.countries.read.ownerOf([1n]))).to.equal(
        getAddress(bob.account.address)
      );
    });

    it("rejects a wrong payment", async function () {
      const { marketAs, bob, version } = await loadFixture(withListing);
      await expect(
        (await marketAs(bob)).write.buy([1n, version, 0n], { value: price - 1n })
      ).to.be.rejectedWith("WrongPrice");
    });

    it("makes the listing outdated after a split", async function () {
      const { land, marketAs, alice, bob, version } = await loadFixture(
        withListing
      );
      const account = await deployAccount(land, 1n);
      await accountTransferSquare(land, alice, account, alice.account.address, 10, 12);
      const newVersion = await land.countries.read.compositionVersion([1n]);
      await expect(
        (await marketAs(bob)).write.buy([1n, newVersion, 1n], { value: price })
      ).to.be.rejectedWith("ListingOutdated");
    });

    it("rejects a buyer who saw an older version than the listing", async function () {
      const { land, market, marketAs, alice, bob, version } = await loadFixture(
        withListing
      );
      const account = await deployAccount(land, 1n);
      await accountTransferSquare(land, alice, account, alice.account.address, 10, 12);
      // The seller lists again for the smaller country. The approval was not used, so it stays.
      await (await marketAs(alice)).write.list([1n, price]);
      const newVersion = await land.countries.read.compositionVersion([1n]);
      expect((await market.read.listingOf([1n])).version).to.equal(newVersion);

      await expect(
        (await marketAs(bob)).write.buy([1n, version, 1n], { value: price })
      ).to.be.rejectedWith("CompositionChanged");
      await (await marketAs(bob)).write.buy([1n, newVersion, 1n], {
        value: price,
      });
      expect(getAddress(await land.countries.read.ownerOf([1n]))).to.equal(
        getAddress(bob.account.address)
      );
    });

    it("makes the listing outdated after a merge", async function () {
      const { land, market, marketAs, countriesAs, alice, bob } =
        await loadFixture(deploy);
      const account = await deployAccount(land, 1n);
      await accountTransferSquare(land, alice, account, alice.account.address, 10, 12);
      await (await countriesAs(alice)).write.approve([market.address, 1n]);
      await (await marketAs(alice)).write.list([1n, price]);
      const version = await land.countries.read.compositionVersion([1n]);
      const state = 1n;

      const squaresAsAlice = await hre.viem.getContractAt(
        "GaiaSquares",
        land.squares.address,
        { client: { wallet: alice } }
      );
      await squaresAsAlice.write.transferFrom([
        alice.account.address,
        account,
        squareId(10, 12),
      ]);
      await expect(
        (await marketAs(bob)).write.buy([1n, version + 1n, state], {
          value: price,
        })
      ).to.be.rejectedWith("ListingOutdated");
    });

    it("rejects the purchase after the account sends assets out", async function () {
      const { land, market, marketAs, alice, bob, version } = await loadFixture(
        withListing
      );
      const account = await deployAccount(land, 1n);
      await alice.sendTransaction({ to: account, value: parseEther("1") });
      const state = await market.read.accountState([1n]);

      const asOwner = await hre.viem.getContractAt(
        "GaiaCountryAccount",
        account,
        { client: { wallet: alice } }
      );
      await asOwner.write.execute([
        alice.account.address,
        parseEther("1"),
        "0x",
        0,
      ]);
      await expect(
        (await marketAs(bob)).write.buy([1n, version, state], { value: price })
      ).to.be.rejectedWith("AccountStateChanged");
    });

    it("leaves no approved address that can take assets out after the sale", async function () {
      const { land, market, marketAs, alice, bob, carol, version } =
        await loadFixture(withListing);
      const account = await deployAccount(land, 1n);
      const token = await hre.viem.deployContract("MockERC20");
      await token.write.mint([account, 100n]);
      const asOwner = await hre.viem.getContractAt(
        "GaiaCountryAccount",
        account,
        { client: { wallet: alice } }
      );

      // Before the sale, the seller tries to approve Carol for the token and the squares.
      await expect(
        asOwner.write.execute([
          token.address,
          0n,
          encodeFunctionData({
            abi: token.abi,
            functionName: "approve",
            args: [carol.account.address, 100n],
          }),
          0,
        ])
      ).to.be.rejectedWith("ApprovalNotAllowed");
      await expect(
        asOwner.write.execute([
          land.squares.address,
          0n,
          encodeFunctionData({
            abi: land.squares.abi,
            functionName: "setApprovalForAll",
            args: [carol.account.address, true],
          }),
          0,
        ])
      ).to.be.rejectedWith("ApprovalNotAllowed");

      const state = await market.read.accountState([1n]);
      expect(state).to.equal(0n);
      await (await marketAs(bob)).write.buy([1n, version, state], {
        value: price,
      });

      // After the sale, Carol cannot take the token or a square out of the account.
      expect(await token.read.allowance([account, carol.account.address])).to.equal(0n);
      expect(
        await land.squares.read.isApprovedForAll([account, carol.account.address])
      ).to.equal(false);
      const tokenAsCarol = await hre.viem.getContractAt("MockERC20", token.address, {
        client: { wallet: carol },
      });
      await expect(
        tokenAsCarol.write.transferFrom([account, carol.account.address, 100n])
      ).to.be.rejectedWith("ERC20InsufficientAllowance");
      const squaresAsCarol = await hre.viem.getContractAt(
        "GaiaSquares",
        land.squares.address,
        { client: { wallet: carol } }
      );
      await expect(
        squaresAsCarol.write.transferFrom([
          account,
          carol.account.address,
          squareId(10, 12),
        ])
      ).to.be.rejectedWith("ERC721InsufficientApproval");

      expect(await token.read.balanceOf([account])).to.equal(100n);
      expect(await land.countries.read.squareCount([1n])).to.equal(3n);
    });

    it("does not make a listing valid again when the country comes back to the seller", async function () {
      const { land, market, marketAs, countriesAs, alice, carol, bob, version } =
        await loadFixture(withListing);
      // Alice also has an operator approval for all countries. It must not keep the listing.
      await (await countriesAs(alice)).write.setApprovalForAll([
        market.address,
        true,
      ]);
      await (await countriesAs(alice)).write.transferFrom([
        alice.account.address,
        carol.account.address,
        1n,
      ]);
      await (await countriesAs(carol)).write.transferFrom([
        carol.account.address,
        alice.account.address,
        1n,
      ]);
      expect(getAddress(await land.countries.read.ownerOf([1n]))).to.equal(
        getAddress(alice.account.address)
      );
      expect(await land.countries.read.compositionVersion([1n])).to.equal(version);

      await expect(
        (await marketAs(bob)).write.buy([1n, version, 0n], { value: price })
      ).to.be.rejectedWith("MarketNotApproved");

      // A new approval and a new listing work.
      await (await countriesAs(alice)).write.approve([market.address, 1n]);
      await (await marketAs(alice)).write.list([1n, price]);
      await (await marketAs(bob)).write.buy([1n, version, 0n], { value: price });
      expect(getAddress(await land.countries.read.ownerOf([1n]))).to.equal(
        getAddress(bob.account.address)
      );
    });

    it("rejects the purchase after the seller revokes the approval", async function () {
      const { marketAs, countriesAs, alice, bob, version } = await loadFixture(
        withListing
      );
      await (await countriesAs(alice)).write.approve([zeroAddress, 1n]);
      await expect(
        (await marketAs(bob)).write.buy([1n, version, 0n], { value: price })
      ).to.be.rejectedWith("MarketNotApproved");
    });

    it("rejects the purchase after the seller transfers the country", async function () {
      const { marketAs, countriesAs, alice, carol, bob, version } =
        await loadFixture(withListing);
      await (await countriesAs(alice)).write.transferFrom([
        alice.account.address,
        carol.account.address,
        1n,
      ]);
      await expect(
        (await marketAs(bob)).write.buy([1n, version, 0n], { value: price })
      ).to.be.rejectedWith("SellerNotOwner");
    });

    it("rejects the purchase of a burned country", async function () {
      const { land, marketAs, alice, bob, version } = await loadFixture(
        withListing
      );
      const account = await deployAccount(land, 1n);
      for (const lng of [12, 11, 10]) {
        await accountTransferSquare(land, alice, account, alice.account.address, 10, lng);
      }
      await expect(
        (await marketAs(bob)).write.buy([1n, version, 3n], { value: price })
      ).to.be.rejectedWith("ERC721NonexistentToken");
    });
  });
});
