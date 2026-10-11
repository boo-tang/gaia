import { expect } from "chai";
import { encodeFunctionData, getAddress, parseEther, zeroAddress } from "viem";

import { loadFixture, viem } from "./helpers/setup";
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

describe("GaiaSquares", function () {
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
      { client: { wallet: issuer } }
    );
    const squaresAs = async (
      wallet: Awaited<ReturnType<typeof viem.getWalletClients>>[number]
    ) =>
      viem.getContractAt("GaiaSquares", land.squares.address, {
        client: { wallet },
      });
    return { land, admin, issuer, alice, bob, carol, asIssuer, squaresAs };
  }

  describe("minting", function () {
    it("mints squares into the country's counterfactual account", async function () {
      const { land, alice, asIssuer } = await loadFixture(deploy);
      const publicClient = await viem.getPublicClient();
      const shape = row(10, 10, 13);
      await asIssuer.write.createCountry([alice.account.address, shape]);

      const account = await land.countries.read.accountOf([1n]);
      expect(await publicClient.getBytecode({ address: account })).to.equal(
        undefined
      );
      for (const loc of shape) {
        expect(
          getAddress(await land.squares.read.ownerOf([squareId(loc.lat, loc.lng)]))
        ).to.equal(getAddress(account));
        expect(await land.squares.read.countryOf([loc.lat, loc.lng])).to.equal(
          1n
        );
        expect(
          getAddress(await land.squares.read.controllerOf([loc.lat, loc.lng]))
        ).to.equal(getAddress(alice.account.address));
      }
      expect(await land.squares.read.exists([10, 14])).to.equal(false);
      expect(await land.squares.read.controllerOf([10, 14])).to.equal(
        zeroAddress
      );
      expect(await land.countries.read.squareCount([1n])).to.equal(4n);
      expect(await land.countries.read.compositionVersion([1n])).to.equal(4n);
      expect(await land.countries.read.countryOfAccount([account])).to.equal(
        1n
      );
    });

    it("lets only GaiaCountries mint", async function () {
      const { alice, squaresAs } = await loadFixture(deploy);
      const asAlice = await squaresAs(alice);
      await expect(
        asAlice.write.mintToCountry([1n, [{ lat: 1, lng: 1 }]])
      ).to.be.rejectedWith("NotCountries");
    });

    it("rejects a square that already exists", async function () {
      const { alice, bob, asIssuer } = await loadFixture(deploy);
      await asIssuer.write.createCountry([alice.account.address, row(10, 10, 11)]);
      await expect(
        asIssuer.write.createCountry([bob.account.address, row(10, 11, 12)])
      ).to.be.rejectedWith("SquareAlreadyExists");
      await expect(
        asIssuer.write.createCountry([
          bob.account.address,
          [
            { lat: 20, lng: 20 },
            { lat: 20, lng: 20 },
          ],
        ])
      ).to.be.rejectedWith("SquareAlreadyExists");
    });

    it("rejects invalid coordinates", async function () {
      const { alice, asIssuer } = await loadFixture(deploy);
      await expect(
        asIssuer.write.createCountry([
          alice.account.address,
          [{ lat: 18000, lng: 0 }],
        ])
      ).to.be.rejectedWith("InvalidCoordinates");
      await expect(
        asIssuer.write.createCountry([
          alice.account.address,
          [{ lat: 0, lng: 36000 }],
        ])
      ).to.be.rejectedWith("InvalidCoordinates");
    });
  });

  describe("shape rules on add", function () {
    it("accepts a connected shape added square by square", async function () {
      const { land, alice, asIssuer } = await loadFixture(deploy);
      await asIssuer.write.createCountry([
        alice.account.address,
        [
          { lat: 10, lng: 10 },
          { lat: 10, lng: 11 },
          { lat: 11, lng: 10 },
        ],
      ]);
      expect(await land.countries.read.squareCount([1n])).to.equal(3n);
    });

    it("rejects a square that does not touch the country", async function () {
      const { alice, asIssuer } = await loadFixture(deploy);
      await expect(
        asIssuer.write.createCountry([
          alice.account.address,
          [
            { lat: 10, lng: 10 },
            { lat: 10, lng: 12 },
          ],
        ])
      ).to.be.rejectedWith("ShapeBroken");

      await asIssuer.write.createCountry([alice.account.address, row(10, 10, 11)]);
      await expect(
        asIssuer.write.addSquares([
          1n,
          alice.account.address,
          [{ lat: 10, lng: 13 }],
        ])
      ).to.be.rejectedWith("ShapeBroken");
    });

    it("checks squares in the given order", async function () {
      const { alice, asIssuer } = await loadFixture(deploy);
      // The final shape is a valid row, but (10,12) touches nothing when it is added.
      await expect(
        asIssuer.write.createCountry([
          alice.account.address,
          [
            { lat: 10, lng: 10 },
            { lat: 10, lng: 12 },
            { lat: 10, lng: 11 },
          ],
        ])
      ).to.be.rejectedWith("ShapeBroken");
    });

    it("rejects a square that would close a ring around free land", async function () {
      const { land, alice, asIssuer } = await loadFixture(deploy);
      const ring = [
        { lat: 10, lng: 10 },
        { lat: 10, lng: 11 },
        { lat: 10, lng: 12 },
        { lat: 11, lng: 12 },
        { lat: 12, lng: 12 },
        { lat: 12, lng: 11 },
        { lat: 12, lng: 10 },
      ];
      await asIssuer.write.createCountry([alice.account.address, ring]);
      expect(await land.countries.read.squareCount([1n])).to.equal(7n);

      await expect(
        asIssuer.write.addSquares([
          1n,
          alice.account.address,
          [{ lat: 11, lng: 10 }],
        ])
      ).to.be.rejectedWith("ShapeBroken");
    });

    it("accepts a shape across the antimeridian and at the latitude limits", async function () {
      const { land, alice, asIssuer } = await loadFixture(deploy);
      await asIssuer.write.createCountry([
        alice.account.address,
        [
          { lat: 5, lng: 35999 },
          { lat: 5, lng: 0 },
          { lat: 6, lng: 0 },
        ],
      ]);
      await asIssuer.write.createCountry([
        alice.account.address,
        [
          { lat: 17999, lng: 5 },
          { lat: 17999, lng: 6 },
          { lat: 17998, lng: 5 },
        ],
      ]);
      await asIssuer.write.createCountry([alice.account.address, row(0, 5, 7)]);
      expect(await land.countries.read.squareCount([1n])).to.equal(3n);
      expect(await land.countries.read.squareCount([2n])).to.equal(3n);
      expect(await land.countries.read.squareCount([3n])).to.equal(3n);
    });
  });

  describe("split", function () {
    async function withBlock() {
      const f = await deploy();
      // 3 x 3 block at rows 10-12, columns 10-12.
      await f.asIssuer.write.createCountry([
        f.alice.account.address,
        [...row(10, 10, 12), ...row(11, 10, 12), ...row(12, 10, 12)],
      ]);
      const account = await deployAccount(f.land, 1n);
      return { ...f, account };
    }

    it("lets the owner split an edge square out of the country", async function () {
      const { land, alice, account } = await loadFixture(withBlock);
      const versionBefore = await land.countries.read.compositionVersion([1n]);

      await accountTransferSquare(
        land,
        alice,
        account,
        alice.account.address,
        10,
        11
      );

      expect(
        getAddress(await land.squares.read.ownerOf([squareId(10, 11)]))
      ).to.equal(getAddress(alice.account.address));
      expect(await land.squares.read.countryOf([10, 11])).to.equal(0n);
      expect(await land.squares.read.exists([10, 11])).to.equal(true);
      expect(await land.countries.read.squareCount([1n])).to.equal(8n);
      expect(await land.countries.read.compositionVersion([1n])).to.equal(
        versionBefore + 1n
      );
    });

    it("rejects splitting an interior square", async function () {
      const { land, alice, account } = await loadFixture(withBlock);
      await expect(
        accountTransferSquare(land, alice, account, alice.account.address, 11, 11)
      ).to.be.rejectedWith("ShapeBroken");
    });

    it("rejects splitting a bridge square", async function () {
      const { land, alice, asIssuer } = await loadFixture(deploy);
      await asIssuer.write.createCountry([alice.account.address, row(10, 10, 12)]);
      const account = await deployAccount(land, 1n);
      await expect(
        accountTransferSquare(land, alice, account, alice.account.address, 10, 11)
      ).to.be.rejectedWith("ShapeBroken");
    });

    it("lets only the country owner act through the account", async function () {
      const { land, bob, account } = await loadFixture(withBlock);
      await expect(
        accountTransferSquare(land, bob, account, bob.account.address, 10, 11)
      ).to.be.rejectedWith("NotOwner");
    });

    it("blocks operator approvals on squares in a country, also after a country sale", async function () {
      const { land, alice, bob, carol, account, squaresAs } =
        await loadFixture(withBlock);
      const asAccountOwner = await viem.getContractAt(
        "GaiaCountryAccount",
        account,
        { client: { wallet: alice } }
      );
      // The account blocks the approval, so Bob is not an operator. GaiaSquares also rejects a
      // transfer by an operator (TransferNotByAccount), but an account cannot make one.
      await expect(asAccountOwner.write.execute([
        land.squares.address,
        0n,
        encodeFunctionData({
          abi: land.squares.abi,
          functionName: "setApprovalForAll",
          args: [bob.account.address, true],
        }),
        0,
      ])).to.be.rejectedWith("ApprovalNotAllowed");

      const asBob = await squaresAs(bob);
      await expect(
        asBob.write.transferFrom([account, bob.account.address, squareId(10, 11)])
      ).to.be.rejectedWith("ERC721InsufficientApproval");

      const countriesAsAlice = await viem.getContractAt(
        "GaiaCountries",
        land.countries.address,
        { client: { wallet: alice } }
      );
      await countriesAsAlice.write.transferFrom([
        alice.account.address,
        carol.account.address,
        1n,
      ]);
      await expect(
        asBob.write.transferFrom([account, bob.account.address, squareId(10, 11)])
      ).to.be.rejectedWith("ERC721InsufficientApproval");
    });
  });

  describe("empty country", function () {
    // Alice: country 1 = one square at (10,10). Its account holds 1 ETH.
    async function withSingle() {
      const f = await deploy();
      await f.asIssuer.write.createCountry([
        f.alice.account.address,
        [{ lat: 10, lng: 10 }],
      ]);
      const account = await deployAccount(f.land, 1n);
      await f.alice.sendTransaction({ to: account, value: parseEther("1") });
      return { ...f, account };
    }

    it("burns the country when the last square is split off", async function () {
      const { land, alice, account } = await loadFixture(withSingle);
      const versionBefore = await land.countries.read.compositionVersion([1n]);
      await accountTransferSquare(
        land,
        alice,
        account,
        alice.account.address,
        10,
        10
      );

      await expect(land.countries.read.ownerOf([1n])).to.be.rejectedWith(
        "ERC721NonexistentToken"
      );
      expect(await land.countries.read.squareCount([1n])).to.equal(0n);
      expect(await land.squares.read.countryOf([10, 10])).to.equal(0n);
      // The account stays registered, so country NFTs still cannot go into it.
      expect(await land.countries.read.countryOfAccount([account])).to.equal(
        1n
      );

      const burns = await land.countries.getEvents.Transfer(
        { to: zeroAddress, tokenId: 1n },
        { fromBlock: 0n }
      );
      expect(burns).to.have.lengthOf(1);
      expect(getAddress(burns[0].args.from!)).to.equal(
        getAddress(alice.account.address)
      );
      const changes = await land.countries.getEvents.CountryCompositionChanged(
        { countryId: 1n },
        { fromBlock: 0n }
      );
      const last = changes[changes.length - 1];
      expect(last.args.version).to.equal(versionBefore + 1n);
      expect(last.args.squareCount).to.equal(0n);
    });

    it("blocks the account, growth and merges after the burn", async function () {
      const { land, alice, account, asIssuer, squaresAs } = await loadFixture(
        withSingle
      );
      await accountTransferSquare(
        land,
        alice,
        account,
        alice.account.address,
        10,
        10
      );

      await expect(
        accountTransferSquare(land, alice, account, alice.account.address, 10, 10)
      ).to.be.rejectedWith("ERC721NonexistentToken");
      await expect(
        asIssuer.write.addSquares([
          1n,
          alice.account.address,
          [{ lat: 10, lng: 11 }],
        ])
      ).to.be.rejectedWith("UnknownCountry");
      const asAlice = await squaresAs(alice);
      await expect(
        asAlice.write.transferFrom([
          alice.account.address,
          account,
          squareId(10, 10),
        ])
      ).to.be.rejectedWith("ERC721NonexistentToken");
    });

    it("locks ETH that is left in the account at the burn", async function () {
      const { land, alice, account } = await loadFixture(withSingle);
      await accountTransferSquare(
        land,
        alice,
        account,
        alice.account.address,
        10,
        10
      );
      const asOwner = await viem.getContractAt(
        "GaiaCountryAccount",
        account,
        { client: { wallet: alice } }
      );
      await expect(
        asOwner.write.execute([alice.account.address, parseEther("1"), "0x", 0])
      ).to.be.rejectedWith("ERC721NonexistentToken");
      const publicClient = await viem.getPublicClient();
      expect(await publicClient.getBalance({ address: account })).to.equal(
        parseEther("1")
      );
    });

    it("burns the source country when its last square moves to another country of the same owner", async function () {
      const { land, alice, account, asIssuer } = await loadFixture(withSingle);
      // Country 2 (Alice) at (11,10), above country 1.
      await asIssuer.write.createCountry([
        alice.account.address,
        [{ lat: 11, lng: 10 }],
      ]);
      const otherAccount = await land.countries.read.accountOf([2n]);

      await accountTransferSquare(land, alice, account, otherAccount, 10, 10);
      expect(await land.squares.read.countryOf([10, 10])).to.equal(2n);
      expect(await land.countries.read.squareCount([2n])).to.equal(2n);
      await expect(land.countries.read.ownerOf([1n])).to.be.rejectedWith(
        "ERC721NonexistentToken"
      );
    });
  });

  describe("merge", function () {
    // Alice: country 1 = row 10, columns 10-12; she splits (10,12) into her wallet.
    async function withStandalone() {
      const f = await deploy();
      await f.asIssuer.write.createCountry([
        f.alice.account.address,
        row(10, 10, 12),
      ]);
      const account = await deployAccount(f.land, 1n);
      await accountTransferSquare(
        f.land,
        f.alice,
        account,
        f.alice.account.address,
        10,
        12
      );
      return { ...f, account };
    }

    it("lets the owner merge a square back into the country", async function () {
      const { land, alice, account, squaresAs } = await loadFixture(
        withStandalone
      );
      const asAlice = await squaresAs(alice);
      await asAlice.write.transferFrom([
        alice.account.address,
        account,
        squareId(10, 12),
      ]);
      expect(await land.squares.read.countryOf([10, 12])).to.equal(1n);
      expect(await land.countries.read.squareCount([1n])).to.equal(3n);
    });

    it("rejects a merge of a square that does not touch the country", async function () {
      const { land, alice, asIssuer, squaresAs } = await loadFixture(
        withStandalone
      );
      await asIssuer.write.createCountry([alice.account.address, row(50, 50, 51)]);
      const otherAccount = await land.countries.read.accountOf([2n]);
      const asAlice = await squaresAs(alice);
      await expect(
        asAlice.write.transferFrom([
          alice.account.address,
          otherAccount,
          squareId(10, 12),
        ])
      ).to.be.rejectedWith("ShapeBroken");
    });

    it("rejects a gift into another owner's country", async function () {
      const { alice, bob, account, squaresAs } = await loadFixture(
        withStandalone
      );
      const asAlice = await squaresAs(alice);
      await asAlice.write.transferFrom([
        alice.account.address,
        bob.account.address,
        squareId(10, 12),
      ]);
      const asBob = await squaresAs(bob);
      await expect(
        asBob.write.transferFrom([bob.account.address, account, squareId(10, 12)])
      ).to.be.rejectedWith("NoConsent");
    });

    it("moves a square between two countries of the same owner", async function () {
      const { land, alice, account, asIssuer } = await loadFixture(
        withStandalone
      );
      // Country 2 (Alice) at row 11, above country 1.
      await asIssuer.write.createCountry([alice.account.address, row(11, 10, 11)]);
      const otherAccount = await land.countries.read.accountOf([2n]);

      await accountTransferSquare(land, alice, account, otherAccount, 10, 10);
      expect(await land.squares.read.countryOf([10, 10])).to.equal(2n);
      expect(await land.countries.read.squareCount([1n])).to.equal(1n);
      expect(await land.countries.read.squareCount([2n])).to.equal(3n);
    });

    it("rejects moving a square into a country of another owner", async function () {
      const { land, alice, bob, account, asIssuer } = await loadFixture(
        withStandalone
      );
      await asIssuer.write.createCountry([bob.account.address, row(11, 10, 11)]);
      const bobAccount = await land.countries.read.accountOf([2n]);
      await expect(
        accountTransferSquare(land, alice, account, bobAccount, 10, 10)
      ).to.be.rejectedWith("NoConsent");
    });

    it("lets a standalone square move between wallets freely", async function () {
      const { land, alice, bob, squaresAs } = await loadFixture(withStandalone);
      const asAlice = await squaresAs(alice);
      await asAlice.write.transferFrom([
        alice.account.address,
        bob.account.address,
        squareId(10, 12),
      ]);
      expect(
        getAddress(await land.squares.read.controllerOf([10, 12]))
      ).to.equal(getAddress(bob.account.address));
    });
  });

  describe("land sent to an account before its country exists", function () {
    /// Alice owns Country 1 with squares (10, 9) and (10, 10). Before Country 2 exists, she
    /// sends (10, 10) to the account address of Country 2.
    async function withParked() {
      const base = await deploy();
      const { land, alice, asIssuer } = base;
      await asIssuer.write.createCountry([
        alice.account.address,
        row(10, 9, 10),
      ]);
      const account1 = await deployAccount(land, 1n);
      const futureAccount = await land.countries.read.accountOf([2n]);
      await accountTransferSquare(land, alice, account1, futureAccount, 10, 10);
      return { ...base, account1, futureAccount };
    }

    it("keeps a parked square standalone when the country is created", async function () {
      const { land, bob, asIssuer, futureAccount } = await loadFixture(
        withParked
      );
      await asIssuer.write.createCountry([
        bob.account.address,
        [{ lat: 100, lng: 100 }],
      ]);

      expect(
        getAddress(await land.squares.read.ownerOf([squareId(10, 10)]))
      ).to.equal(getAddress(futureAccount));
      expect(await land.squares.read.countryOf([10, 10])).to.equal(0n);
      expect(
        getAddress(await land.squares.read.controllerOf([10, 10]))
      ).to.equal(getAddress(futureAccount));
      expect(await land.squares.read.countryOf([100, 100])).to.equal(2n);
      expect(
        getAddress(await land.countries.read.ownerOf([2n]))
      ).to.equal(getAddress(bob.account.address));
      expect(await land.countries.read.squareCount([2n])).to.equal(1n);
      expect(await land.countries.read.compositionVersion([2n])).to.equal(1n);
      expect(await land.countries.read.squareCount([1n])).to.equal(1n);
    });

    it("does not let a parked square connect land in the new country", async function () {
      const { bob, asIssuer } = await loadFixture(withParked);
      await asIssuer.write.createCountry([
        bob.account.address,
        [{ lat: 11, lng: 10 }],
      ]);
      // (9, 10) touches (11, 10) only through the parked square (10, 10).
      await expect(
        asIssuer.write.addSquares([2n, bob.account.address, [{ lat: 9, lng: 10 }]])
      ).to.be.rejectedWith("ShapeBroken");
    });

    it("lets the new owner move a parked square out and merge it with the normal checks", async function () {
      const { land, bob, asIssuer, squaresAs } = await loadFixture(withParked);
      await asIssuer.write.createCountry([
        bob.account.address,
        [{ lat: 10, lng: 11 }],
      ]);
      const account2 = await deployAccount(land, 2n);

      await accountTransferSquare(land, bob, account2, bob.account.address, 10, 10);
      expect(await land.squares.read.countryOf([10, 10])).to.equal(0n);
      expect(await land.countries.read.squareCount([2n])).to.equal(1n);

      const asBob = await squaresAs(bob);
      await asBob.write.transferFrom([
        bob.account.address,
        account2,
        squareId(10, 10),
      ]);
      expect(await land.squares.read.countryOf([10, 10])).to.equal(2n);
      expect(await land.countries.read.squareCount([2n])).to.equal(2n);
    });

    it("applies the shape and consent rules to a parked square", async function () {
      const { land, bob, asIssuer, squaresAs, account1 } = await loadFixture(
        withParked
      );
      await asIssuer.write.createCountry([
        bob.account.address,
        [{ lat: 100, lng: 100 }],
      ]);
      const account2 = await deployAccount(land, 2n);
      await accountTransferSquare(land, bob, account2, bob.account.address, 10, 10);

      const asBob = await squaresAs(bob);
      await expect(
        asBob.write.transferFrom([bob.account.address, account2, squareId(10, 10)])
      ).to.be.rejectedWith("ShapeBroken");
      await expect(
        asBob.write.transferFrom([bob.account.address, account1, squareId(10, 10)])
      ).to.be.rejectedWith("NoConsent");
    });
  });
});
