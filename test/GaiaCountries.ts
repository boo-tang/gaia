import { expect } from "chai";
import { encodeFunctionData, getAddress, zeroAddress } from "viem";

import { loadFixture, viem } from "./helpers/setup";
import { auctionAs, deployAuction, pack } from "./helpers/auction";
import { deployAccount, deployLand } from "./helpers/land";

describe("GaiaCountries", function () {
  async function deployCountries() {
    const [admin, issuer, alice, bob] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();

    const land = await deployLand(admin.account.address);
    const { countries } = land;
    const issuerRole = await countries.read.ISSUER_ROLE();
    await countries.write.grantRole([issuerRole, issuer.account.address]);

    const asIssuer = await viem.getContractAt(
      "GaiaCountries",
      countries.address,
      { client: { wallet: issuer } }
    );
    const asAlice = await viem.getContractAt(
      "GaiaCountries",
      countries.address,
      { client: { wallet: alice } }
    );

    return {
      admin,
      issuer,
      alice,
      bob,
      publicClient,
      land,
      countries,
      asIssuer,
      asAlice,
      issuerRole,
    };
  }

  describe("access control", function () {
    it("does not give the issuer role to the admin", async function () {
      const { admin, countries, issuerRole } = await loadFixture(
        deployCountries
      );
      expect(
        await countries.read.hasRole([issuerRole, admin.account.address])
      ).to.equal(false);
    });

    it("rejects createCountry and addSquares from the admin", async function () {
      const { admin, countries, asIssuer, alice } = await loadFixture(
        deployCountries
      );
      await expect(
        countries.write.createCountry([
          admin.account.address,
          [{ lat: 1, lng: 1 }],
        ])
      ).to.be.rejectedWith("AccessControlUnauthorizedAccount");

      await asIssuer.write.createCountry([
        alice.account.address,
        [{ lat: 1, lng: 1 }],
      ]);
      await expect(
        countries.write.addSquares([
          1n,
          alice.account.address,
          [{ lat: 1, lng: 2 }],
        ])
      ).to.be.rejectedWith("AccessControlUnauthorizedAccount");
    });

    it("rejects createCountry and addSquares from a random address", async function () {
      const { asIssuer, asAlice, alice } = await loadFixture(deployCountries);
      await expect(
        asAlice.write.createCountry([
          alice.account.address,
          [{ lat: 1, lng: 1 }],
        ])
      ).to.be.rejectedWith("AccessControlUnauthorizedAccount");

      await asIssuer.write.createCountry([
        alice.account.address,
        [{ lat: 1, lng: 1 }],
      ]);
      await expect(
        asAlice.write.addSquares([
          1n,
          alice.account.address,
          [{ lat: 1, lng: 2 }],
        ])
      ).to.be.rejectedWith("AccessControlUnauthorizedAccount");
    });

    it("lets only the admin manage auctions and link the square contract", async function () {
      const { asAlice, bob, land } = await loadFixture(deployCountries);
      await expect(
        asAlice.write.addAuction([bob.account.address])
      ).to.be.rejectedWith("AccessControlUnauthorizedAccount");
      await expect(
        asAlice.write.setSquares([land.squares.address])
      ).to.be.rejectedWith("AccessControlUnauthorizedAccount");
    });
  });

  describe("linking the square contract", function () {
    it("can link the square contract only once", async function () {
      const { countries, land } = await loadFixture(deployCountries);
      await expect(
        countries.write.setSquares([land.squares.address])
      ).to.be.rejectedWith("SquaresAlreadySet");
    });

    it("rejects a square contract that belongs to another countries contract", async function () {
      const { admin, land } = await loadFixture(deployCountries);
      const other = await viem.deployContract("GaiaCountries", [
        admin.account.address,
        land.registry.address,
        land.accountImpl.address,
      ]);
      await expect(
        other.write.setSquares([land.squares.address])
      ).to.be.rejectedWith("SquaresMismatch");
    });

    it("cannot create countries before the square contract is linked", async function () {
      const { admin, land, alice } = await loadFixture(deployCountries);
      const other = await viem.deployContract("GaiaCountries", [
        admin.account.address,
        land.registry.address,
        land.accountImpl.address,
      ]);
      await other.write.grantRole([
        await other.read.ISSUER_ROLE(),
        admin.account.address,
      ]);
      await expect(
        other.write.createCountry([
          alice.account.address,
          [{ lat: 1, lng: 1 }],
        ])
      ).to.be.rejectedWith("SquaresNotSet");
    });
  });

  describe("createCountry", function () {
    it("mints a country and its squares into the country account", async function () {
      const { countries, land, asIssuer, alice, issuer } = await loadFixture(
        deployCountries
      );
      await asIssuer.write.createCountry([
        alice.account.address,
        [
          { lat: 10, lng: 10 },
          { lat: 10, lng: 11 },
        ],
      ]);

      expect(getAddress(await countries.read.ownerOf([1n]))).to.equal(
        getAddress(alice.account.address)
      );
      const account = await countries.read.accountOf([1n]);
      expect(await land.countries.read.countryOfAccount([account])).to.equal(1n);
      expect(await land.countries.read.squareCount([1n])).to.equal(2n);

      const events = await countries.getEvents.CountryCreated();
      expect(events).to.have.length(1);
      expect(events[0].args.countryId).to.equal(1n);
      expect(getAddress(events[0].args.account!)).to.equal(getAddress(account));
      expect(getAddress(events[0].args.issuer!)).to.equal(
        getAddress(issuer.account.address)
      );
    });

    it("derives the same account address as the ERC-6551 registry", async function () {
      const { countries, land, asIssuer, alice, publicClient } =
        await loadFixture(deployCountries);
      await asIssuer.write.createCountry([
        alice.account.address,
        [{ lat: 10, lng: 10 }],
      ]);
      const deployed = await deployAccount(land, 1n);
      expect(getAddress(deployed)).to.equal(
        getAddress(await countries.read.accountOf([1n]))
      );
      expect(
        await publicClient.getBytecode({ address: deployed })
      ).to.not.equal(undefined);
    });

    it("assigns country ids from a counter", async function () {
      const { land, asIssuer, alice, bob } = await loadFixture(deployCountries);
      await asIssuer.write.createCountry([
        alice.account.address,
        [{ lat: 1, lng: 1 }],
      ]);
      await asIssuer.write.createCountry([
        bob.account.address,
        [{ lat: 5, lng: 5 }],
      ]);
      expect(await land.squares.read.countryOf([1, 1])).to.equal(1n);
      expect(await land.squares.read.countryOf([5, 5])).to.equal(2n);
    });

    it("rejects an empty batch", async function () {
      const { asIssuer, alice } = await loadFixture(deployCountries);
      await expect(
        asIssuer.write.createCountry([alice.account.address, []])
      ).to.be.rejectedWith("EmptySquares");
    });
  });

  describe("composition counters", function () {
    it("lets only GaiaSquares record a square change", async function () {
      const { countries, asIssuer, asAlice, alice } = await loadFixture(
        deployCountries
      );
      await asIssuer.write.createCountry([
        alice.account.address,
        [{ lat: 1, lng: 1 }],
      ]);
      await expect(
        countries.write.recordSquareChange([1n, true])
      ).to.be.rejectedWith("NotSquares");
      await expect(
        asIssuer.write.recordSquareChange([1n, true])
      ).to.be.rejectedWith("NotSquares");
      await expect(
        asAlice.write.recordSquareChange([1n, false])
      ).to.be.rejectedWith("NotSquares");
    });

    it("emits CountryCompositionChanged from GaiaCountries for each square", async function () {
      const { publicClient, countries, asIssuer, alice } = await loadFixture(
        deployCountries
      );
      const hash = await asIssuer.write.createCountry([
        alice.account.address,
        [
          { lat: 1, lng: 1 },
          { lat: 1, lng: 2 },
        ],
      ]);
      const { blockNumber } = await publicClient.waitForTransactionReceipt({
        hash,
      });
      const events = await countries.getEvents.CountryCompositionChanged(
        {},
        { fromBlock: blockNumber, toBlock: blockNumber }
      );
      expect(events.map((e) => e.args)).to.deep.equal([
        { countryId: 1n, version: 1n, squareCount: 1n },
        { countryId: 1n, version: 2n, squareCount: 2n },
      ]);
      expect(getAddress(events[0].address)).to.equal(
        getAddress(countries.address)
      );
    });
  });

  describe("auction reservations", function () {
    it("rejects a square that a registered auction reserves, until the auction is removed", async function () {
      const { alice, countries, asIssuer } = await loadFixture(deployCountries);

      // Not registered yet: the test registers it after the bid.
      const { auction } = await deployAuction({ countries }, {}, { register: false });
      const auctionAsAlice = await auctionAs(auction.address, alice);
      await auctionAsAlice.write.bidOnShape([pack([{ lat: 7, lng: 7 }]), 0n, false], {
        value: 1000n,
      });

      await countries.write.addAuction([auction.address]);
      expect(
        (await countries.read.auctions()).map((a) => getAddress(a))
      ).to.deep.equal([getAddress(auction.address)]);

      await expect(
        asIssuer.write.createCountry([
          alice.account.address,
          [{ lat: 7, lng: 7 }],
        ])
      ).to.be.rejectedWith("SquareReserved");

      await countries.write.removeAuction([auction.address]);
      expect(await countries.read.auctions()).to.deep.equal([]);
      await expect(
        asIssuer.write.createCountry([
          alice.account.address,
          [{ lat: 7, lng: 7 }],
        ])
      ).to.be.fulfilled;
    });

    it("rejects adding the same auction twice and removing an unknown auction", async function () {
      const { countries, bob } = await loadFixture(deployCountries);
      await countries.write.addAuction([bob.account.address]);
      await expect(
        countries.write.addAuction([bob.account.address])
      ).to.be.rejectedWith("AuctionAlreadyAdded");
      await expect(
        countries.write.removeAuction([zeroAddress])
      ).to.be.rejectedWith("UnknownAuction");
    });
  });

  describe("only the owner can grow a country", function () {
    it("rejects a buyer that does not own the country", async function () {
      const { asIssuer, alice, bob } = await loadFixture(deployCountries);
      await asIssuer.write.createCountry([
        alice.account.address,
        [{ lat: 10, lng: 10 }],
      ]);
      await expect(
        asIssuer.write.addSquares([
          1n,
          bob.account.address,
          [{ lat: 10, lng: 11 }],
        ])
      ).to.be.rejectedWith("NotCountryOwner");
    });

    it("rejects an unknown country", async function () {
      const { asIssuer, alice } = await loadFixture(deployCountries);
      await expect(
        asIssuer.write.addSquares([
          99n,
          alice.account.address,
          [{ lat: 10, lng: 11 }],
        ])
      ).to.be.rejectedWith("UnknownCountry");
    });
  });

  describe("ownership-loop guard", function () {
    async function withTwoCountries() {
      const f = await deployCountries();
      await f.asIssuer.write.createCountry([
        f.alice.account.address,
        [{ lat: 10, lng: 10 }],
      ]);
      await f.asIssuer.write.createCountry([
        f.alice.account.address,
        [{ lat: 20, lng: 20 }],
      ]);
      return f;
    }

    it("rejects a transfer of a country into its own account, deployed or not", async function () {
      const { countries, land, asAlice, alice } = await loadFixture(
        withTwoCountries
      );
      const ownAccount = await countries.read.accountOf([1n]);
      await expect(
        asAlice.write.transferFrom([alice.account.address, ownAccount, 1n])
      ).to.be.rejectedWith("OwnershipLoop");

      await deployAccount(land, 1n);
      await expect(
        asAlice.write.transferFrom([alice.account.address, ownAccount, 1n])
      ).to.be.rejectedWith("OwnershipLoop");
    });

    it("rejects a transfer of a country into another country's account", async function () {
      const { countries, asAlice, alice } = await loadFixture(
        withTwoCountries
      );
      const otherAccount = await countries.read.accountOf([2n]);
      await expect(
        asAlice.write.transferFrom([alice.account.address, otherAccount, 1n])
      ).to.be.rejectedWith("OwnershipLoop");
    });

    it("rejects minting a country into its own account", async function () {
      const { countries, asIssuer } = await loadFixture(deployCountries);
      const futureAccount = await countries.read.accountOf([1n]);
      await expect(
        asIssuer.write.createCountry([futureAccount, [{ lat: 10, lng: 10 }]])
      ).to.be.rejectedWith("OwnershipLoop");
    });

    it("allows a transfer into an unrelated contract", async function () {
      const { countries, asAlice, alice } = await loadFixture(
        withTwoCountries
      );
      const plain = await viem.deployContract("ContractBidder");
      await asAlice.write.transferFrom([
        alice.account.address,
        plain.address,
        1n,
      ]);
      expect(getAddress(await countries.read.ownerOf([1n]))).to.equal(
        getAddress(plain.address)
      );
    });

    it("does not block a country parked at the account of a future country", async function () {
      const { countries, land, asIssuer, asAlice, alice, bob } =
        await loadFixture(withTwoCountries);
      // Accepted gap: the guard knows only registered accounts. Only the owner can send their own
      // country there, and the owner of the new country can move it out.
      const futureAccount = await countries.read.accountOf([3n]);
      await asAlice.write.transferFrom([
        alice.account.address,
        futureAccount,
        1n,
      ]);
      await asIssuer.write.createCountry([
        bob.account.address,
        [{ lat: 30, lng: 30 }],
      ]);
      expect(getAddress(await countries.read.ownerOf([1n]))).to.equal(
        getAddress(futureAccount)
      );

      await deployAccount(land, 3n);
      const asBobAccount = await viem.getContractAt(
        "GaiaCountryAccount",
        futureAccount,
        { client: { wallet: bob } }
      );
      await asBobAccount.write.execute([
        countries.address,
        0n,
        encodeFunctionData({
          abi: countries.abi,
          functionName: "transferFrom",
          args: [futureAccount, bob.account.address, 1n],
        }),
        0,
      ]);
      expect(getAddress(await countries.read.ownerOf([1n]))).to.equal(
        getAddress(bob.account.address)
      );
    });
  });
});
