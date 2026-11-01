import { expect } from 'chai';
import { encodeFunctionData, getAddress, parseEther, zeroAddress } from 'viem';

import {
  accountMoveSquares,
  accountTransferSquare,
  deployAccount,
  deployLand,
  executeAs,
  squareId,
} from './helpers/land';
import { greedyOrder } from './helpers/order';
import { loadFixture, viem } from './helpers/setup';
import { rect, row } from './helpers/shapes';

// Three checks of GaiaSquares have no test on purpose, because no path through the public
// functions reaches them. They are a second line of defence:
// - BurnNotAllowed: GaiaSquares has no public burn.
// - NotACountryAccount: only GaiaCountries mints, and always to the account of a country.
// - TransferNotByAccount: a square in a country belongs to the account, and the account cannot
//   give an approval (ApprovalNotAllowed). A token approval of the wallet ends when the square
//   moves into the country.
describe('GaiaSquares', function () {
  async function deploy() {
    const [admin, issuer, alice, bob, carol] = await viem.getWalletClients();
    const land = await deployLand(admin.account.address);
    await land.countries.write.grantRole([await land.countries.read.ISSUER_ROLE(), issuer.account.address]);
    const asIssuer = await viem.getContractAt('GaiaCountries', land.countries.address, { client: { wallet: issuer } });
    const squaresAs = async (wallet: Awaited<ReturnType<typeof viem.getWalletClients>>[number]) =>
      viem.getContractAt('GaiaSquares', land.squares.address, {
        client: { wallet },
      });
    return { land, admin, issuer, alice, bob, carol, asIssuer, squaresAs };
  }

  describe('minting', function () {
    it("mints squares into the country's counterfactual account", async function () {
      const { land, alice, asIssuer } = await loadFixture(deploy);
      const publicClient = await viem.getPublicClient();
      const shape = row(10, 10, 13);
      await asIssuer.write.createCountry([alice.account.address, shape]);

      const account = await land.countries.read.accountOf([1n]);
      expect(await publicClient.getBytecode({ address: account })).to.equal(undefined);
      for (const loc of shape) {
        expect(getAddress(await land.squares.read.ownerOf([squareId(loc.lat, loc.lng)]))).to.equal(getAddress(account));
        expect(await land.squares.read.countryOf([loc.lat, loc.lng])).to.equal(1n);
        expect(getAddress(await land.squares.read.controllerOf([loc.lat, loc.lng]))).to.equal(
          getAddress(alice.account.address),
        );
      }
      expect(await land.squares.read.exists([10, 14])).to.equal(false);
      expect(await land.squares.read.controllerOf([10, 14])).to.equal(zeroAddress);
      expect(await land.countries.read.squareCount([1n])).to.equal(4n);
      expect(await land.countries.read.compositionVersion([1n])).to.equal(4n);
      expect(await land.countries.read.countryOfAccount([account])).to.equal(1n);
    });

    it('lets only GaiaCountries mint', async function () {
      const { alice, squaresAs } = await loadFixture(deploy);
      const asAlice = await squaresAs(alice);
      await expect(asAlice.write.mintToCountry([1n, [{ lat: 1, lng: 1 }]])).to.be.rejectedWith('NotCountries');
    });

    it('rejects a square that already exists', async function () {
      const { alice, bob, asIssuer } = await loadFixture(deploy);
      await asIssuer.write.createCountry([alice.account.address, row(10, 10, 11)]);
      await expect(asIssuer.write.createCountry([bob.account.address, row(10, 11, 12)])).to.be.rejectedWith(
        'SquareAlreadyExists',
      );
      await expect(
        asIssuer.write.createCountry([
          bob.account.address,
          [
            { lat: 20, lng: 20 },
            { lat: 20, lng: 20 },
          ],
        ]),
      ).to.be.rejectedWith('SquareAlreadyExists');
    });

    it('rejects invalid coordinates', async function () {
      const { alice, asIssuer } = await loadFixture(deploy);
      await expect(asIssuer.write.createCountry([alice.account.address, [{ lat: 18000, lng: 0 }]])).to.be.rejectedWith(
        'InvalidCoordinates',
      );
      await expect(asIssuer.write.createCountry([alice.account.address, [{ lat: 0, lng: 36000 }]])).to.be.rejectedWith(
        'InvalidCoordinates',
      );
    });
  });

  describe('shape rules on add', function () {
    it('accepts a connected shape added square by square', async function () {
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

    it('rejects a square that does not touch the country', async function () {
      const { alice, asIssuer } = await loadFixture(deploy);
      await expect(
        asIssuer.write.createCountry([
          alice.account.address,
          [
            { lat: 10, lng: 10 },
            { lat: 10, lng: 12 },
          ],
        ]),
      ).to.be.rejectedWith('ShapeBroken');

      await asIssuer.write.createCountry([alice.account.address, row(10, 10, 11)]);
      await expect(asIssuer.write.addSquares([1n, alice.account.address, [{ lat: 10, lng: 13 }]])).to.be.rejectedWith(
        'ShapeBroken',
      );
    });

    it('checks squares in the given order', async function () {
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
        ]),
      ).to.be.rejectedWith('ShapeBroken');
    });

    it('rejects a square that would close a ring around free land', async function () {
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

      await expect(asIssuer.write.addSquares([1n, alice.account.address, [{ lat: 11, lng: 10 }]])).to.be.rejectedWith(
        'ShapeBroken',
      );
    });

    it('accepts a shape across the antimeridian and at the latitude limits', async function () {
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

  describe('split', function () {
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

    it('lets the owner split an edge square out of the country', async function () {
      const { land, alice, account } = await loadFixture(withBlock);
      const versionBefore = await land.countries.read.compositionVersion([1n]);

      await accountTransferSquare(land, alice, account, alice.account.address, 10, 11);

      expect(getAddress(await land.squares.read.ownerOf([squareId(10, 11)]))).to.equal(
        getAddress(alice.account.address),
      );
      expect(await land.squares.read.countryOf([10, 11])).to.equal(0n);
      expect(await land.squares.read.exists([10, 11])).to.equal(true);
      expect(await land.countries.read.squareCount([1n])).to.equal(8n);
      expect(await land.countries.read.compositionVersion([1n])).to.equal(versionBefore + 1n);
    });

    it('rejects splitting an interior square', async function () {
      const { land, alice, account } = await loadFixture(withBlock);
      await expect(accountTransferSquare(land, alice, account, alice.account.address, 11, 11)).to.be.rejectedWith(
        'ShapeBroken',
      );
    });

    it('rejects splitting a bridge square', async function () {
      const { land, alice, asIssuer } = await loadFixture(deploy);
      await asIssuer.write.createCountry([alice.account.address, row(10, 10, 12)]);
      const account = await deployAccount(land, 1n);
      await expect(accountTransferSquare(land, alice, account, alice.account.address, 10, 11)).to.be.rejectedWith(
        'ShapeBroken',
      );
    });

    it('lets only the country owner act through the account', async function () {
      const { land, bob, account } = await loadFixture(withBlock);
      await expect(accountTransferSquare(land, bob, account, bob.account.address, 10, 11)).to.be.rejectedWith(
        'NotOwner',
      );
    });

    it('blocks operator approvals on squares in a country, also after a country sale', async function () {
      const { land, alice, bob, carol, account, squaresAs } = await loadFixture(withBlock);
      const asAccountOwner = await viem.getContractAt('GaiaCountryAccount', account, { client: { wallet: alice } });
      // The account blocks the approval, so Bob is not an operator. GaiaSquares also rejects a
      // transfer by an operator (TransferNotByAccount), but an account cannot make one.
      await expect(
        asAccountOwner.write.execute([
          land.squares.address,
          0n,
          encodeFunctionData({
            abi: land.squares.abi,
            functionName: 'setApprovalForAll',
            args: [bob.account.address, true],
          }),
          0,
        ]),
      ).to.be.rejectedWith('ApprovalNotAllowed');

      const asBob = await squaresAs(bob);
      await expect(asBob.write.transferFrom([account, bob.account.address, squareId(10, 11)])).to.be.rejectedWith(
        'ERC721InsufficientApproval',
      );

      const countriesAsAlice = await viem.getContractAt('GaiaCountries', land.countries.address, {
        client: { wallet: alice },
      });
      await countriesAsAlice.write.transferFrom([alice.account.address, carol.account.address, 1n]);
      await expect(asBob.write.transferFrom([account, bob.account.address, squareId(10, 11)])).to.be.rejectedWith(
        'ERC721InsufficientApproval',
      );
    });
  });

  describe('empty country', function () {
    // Alice: country 1 = one square at (10,10). Its account holds 1 ETH.
    async function withSingle() {
      const f = await deploy();
      await f.asIssuer.write.createCountry([f.alice.account.address, [{ lat: 10, lng: 10 }]]);
      const account = await deployAccount(f.land, 1n);
      await f.alice.sendTransaction({ to: account, value: parseEther('1') });
      return { ...f, account };
    }

    it('burns the country when the last square is split off', async function () {
      const { land, alice, account } = await loadFixture(withSingle);
      const versionBefore = await land.countries.read.compositionVersion([1n]);
      await accountTransferSquare(land, alice, account, alice.account.address, 10, 10);

      await expect(land.countries.read.ownerOf([1n])).to.be.rejectedWith('ERC721NonexistentToken');
      expect(await land.countries.read.squareCount([1n])).to.equal(0n);
      expect(await land.squares.read.countryOf([10, 10])).to.equal(0n);
      // The account stays registered, so country NFTs still cannot go into it.
      expect(await land.countries.read.countryOfAccount([account])).to.equal(1n);

      const burns = await land.countries.getEvents.Transfer({ to: zeroAddress, tokenId: 1n }, { fromBlock: 0n });
      expect(burns).to.have.lengthOf(1);
      expect(getAddress(burns[0].args.from!)).to.equal(getAddress(alice.account.address));
      const changes = await land.countries.getEvents.CountryCompositionChanged({ countryId: 1n }, { fromBlock: 0n });
      const last = changes[changes.length - 1];
      expect(last.args.version).to.equal(versionBefore + 1n);
      expect(last.args.squareCount).to.equal(0n);
    });

    it('blocks the account, growth and merges after the burn', async function () {
      const { land, alice, account, asIssuer, squaresAs } = await loadFixture(withSingle);
      await accountTransferSquare(land, alice, account, alice.account.address, 10, 10);

      await expect(accountTransferSquare(land, alice, account, alice.account.address, 10, 10)).to.be.rejectedWith(
        'ERC721NonexistentToken',
      );
      await expect(asIssuer.write.addSquares([1n, alice.account.address, [{ lat: 10, lng: 11 }]])).to.be.rejectedWith(
        'UnknownCountry',
      );
      const asAlice = await squaresAs(alice);
      await expect(asAlice.write.transferFrom([alice.account.address, account, squareId(10, 10)])).to.be.rejectedWith(
        'ERC721NonexistentToken',
      );
    });

    it('locks ETH that is left in the account at the burn', async function () {
      const { land, alice, account } = await loadFixture(withSingle);
      await accountTransferSquare(land, alice, account, alice.account.address, 10, 10);
      const asOwner = await viem.getContractAt('GaiaCountryAccount', account, { client: { wallet: alice } });
      await expect(asOwner.write.execute([alice.account.address, parseEther('1'), '0x', 0])).to.be.rejectedWith(
        'ERC721NonexistentToken',
      );
      const publicClient = await viem.getPublicClient();
      expect(await publicClient.getBalance({ address: account })).to.equal(parseEther('1'));
    });

    it('burns the source country when its last square moves to another country of the same owner', async function () {
      const { land, alice, account, asIssuer } = await loadFixture(withSingle);
      // Country 2 (Alice) at (11,10), above country 1.
      await asIssuer.write.createCountry([alice.account.address, [{ lat: 11, lng: 10 }]]);
      const otherAccount = await land.countries.read.accountOf([2n]);

      await accountTransferSquare(land, alice, account, otherAccount, 10, 10);
      expect(await land.squares.read.countryOf([10, 10])).to.equal(2n);
      expect(await land.countries.read.squareCount([2n])).to.equal(2n);
      await expect(land.countries.read.ownerOf([1n])).to.be.rejectedWith('ERC721NonexistentToken');
    });
  });

  describe('merge', function () {
    // Alice: country 1 = row 10, columns 10-12; she splits (10,12) into her wallet.
    async function withStandalone() {
      const f = await deploy();
      await f.asIssuer.write.createCountry([f.alice.account.address, row(10, 10, 12)]);
      const account = await deployAccount(f.land, 1n);
      await accountTransferSquare(f.land, f.alice, account, f.alice.account.address, 10, 12);
      return { ...f, account };
    }

    it('lets the owner merge a square back into the country', async function () {
      const { land, alice, account, squaresAs } = await loadFixture(withStandalone);
      const asAlice = await squaresAs(alice);
      await asAlice.write.transferFrom([alice.account.address, account, squareId(10, 12)]);
      expect(await land.squares.read.countryOf([10, 12])).to.equal(1n);
      expect(await land.countries.read.squareCount([1n])).to.equal(3n);
    });

    it('lets the owner merge a square with safeTransferFrom', async function () {
      const { land, alice, account, squaresAs } = await loadFixture(withStandalone);
      const asAlice = await squaresAs(alice);
      await asAlice.write.safeTransferFrom([alice.account.address, account, squareId(10, 12)]);
      expect(await land.squares.read.countryOf([10, 12])).to.equal(1n);
      expect(await land.countries.read.squareCount([1n])).to.equal(3n);
    });

    it('changes nothing when a square goes to its own holder', async function () {
      const { land, alice, account, squaresAs } = await loadFixture(withStandalone);
      const version = await land.countries.read.compositionVersion([1n]);

      // A standalone square, from the wallet to the same wallet.
      const asAlice = await squaresAs(alice);
      await asAlice.write.transferFrom([alice.account.address, alice.account.address, squareId(10, 12)]);
      expect(await land.squares.read.countryOf([10, 12])).to.equal(0n);
      expect(getAddress(await land.squares.read.ownerOf([squareId(10, 12)]))).to.equal(
        getAddress(alice.account.address),
      );

      // A square in a country, from the account to the same account.
      await accountTransferSquare(land, alice, account, account, 10, 10);
      expect(await land.squares.read.countryOf([10, 10])).to.equal(1n);
      expect(await land.countries.read.squareCount([1n])).to.equal(2n);
      expect(await land.countries.read.compositionVersion([1n])).to.equal(version);
    });

    it('rejects a merge of a square that does not touch the country', async function () {
      const { land, alice, asIssuer, squaresAs } = await loadFixture(withStandalone);
      await asIssuer.write.createCountry([alice.account.address, row(50, 50, 51)]);
      const otherAccount = await land.countries.read.accountOf([2n]);
      const asAlice = await squaresAs(alice);
      await expect(
        asAlice.write.transferFrom([alice.account.address, otherAccount, squareId(10, 12)]),
      ).to.be.rejectedWith('ShapeBroken');
    });

    it("rejects a gift into another owner's country", async function () {
      const { alice, bob, account, squaresAs } = await loadFixture(withStandalone);
      const asAlice = await squaresAs(alice);
      await asAlice.write.transferFrom([alice.account.address, bob.account.address, squareId(10, 12)]);
      const asBob = await squaresAs(bob);
      await expect(asBob.write.transferFrom([bob.account.address, account, squareId(10, 12)])).to.be.rejectedWith(
        'NoConsent',
      );
    });

    it('moves a square between two countries of the same owner', async function () {
      const { land, alice, account, asIssuer } = await loadFixture(withStandalone);
      // Country 2 (Alice) at row 11, above country 1.
      await asIssuer.write.createCountry([alice.account.address, row(11, 10, 11)]);
      const otherAccount = await land.countries.read.accountOf([2n]);

      await accountTransferSquare(land, alice, account, otherAccount, 10, 10);
      expect(await land.squares.read.countryOf([10, 10])).to.equal(2n);
      expect(await land.countries.read.squareCount([1n])).to.equal(1n);
      expect(await land.countries.read.squareCount([2n])).to.equal(3n);
    });

    it('rejects moving a square into a country of another owner', async function () {
      const { land, alice, bob, account, asIssuer } = await loadFixture(withStandalone);
      await asIssuer.write.createCountry([bob.account.address, row(11, 10, 11)]);
      const bobAccount = await land.countries.read.accountOf([2n]);
      await expect(accountTransferSquare(land, alice, account, bobAccount, 10, 10)).to.be.rejectedWith('NoConsent');
    });

    it('lets a standalone square move between wallets freely', async function () {
      const { land, alice, bob, squaresAs } = await loadFixture(withStandalone);
      const asAlice = await squaresAs(alice);
      await asAlice.write.transferFrom([alice.account.address, bob.account.address, squareId(10, 12)]);
      expect(getAddress(await land.squares.read.controllerOf([10, 12]))).to.equal(getAddress(bob.account.address));
    });
  });

  describe('moveSquares', function () {
    // Alice: country 1 is a 2 x 4 block (rows 10-11, columns 10-13) and country 2 a 2 x 1 column
    // next to it (column 14). Bob: country 3 (row 20). The accounts of 1 and 2 are deployed.
    const one = rect(10, 10, 2, 4);
    const two = rect(10, 14, 2, 1);
    // Columns 12 and 13 of country 1.
    const east = one.filter(l => l.lng >= 12);

    async function withCountries() {
      const f = await deploy();
      await f.asIssuer.write.createCountry([f.alice.account.address, one]);
      await f.asIssuer.write.createCountry([f.alice.account.address, two]);
      await f.asIssuer.write.createCountry([f.bob.account.address, row(20, 10, 11)]);
      const account1 = await deployAccount(f.land, 1n);
      const account2 = await deployAccount(f.land, 2n);
      const account3 = await f.land.countries.read.accountOf([3n]);
      const stateOf = async (account: `0x${string}`) =>
        (await viem.getContractAt('GaiaCountryAccount', account)).read.state();
      return { ...f, account1, account2, account3, stateOf };
    }

    async function landState(f: Awaited<ReturnType<typeof withCountries>>) {
      const out: unknown[] = [];
      for (const id of [1n, 2n, 3n]) {
        out.push(await f.land.countries.read.squareCount([id]), await f.land.countries.read.compositionVersion([id]));
      }
      for (const l of [...one, ...two]) out.push(await f.land.squares.read.countryOf([l.lat, l.lng]));
      return out;
    }

    it('moves many squares to another country of the same owner with one execute', async function () {
      const f = await loadFixture(withCountries);
      const order = greedyOrder(east, two, one)!;
      const state1 = await f.stateOf(f.account1);
      const version1 = await f.land.countries.read.compositionVersion([1n]);
      const version2 = await f.land.countries.read.compositionVersion([2n]);

      await accountMoveSquares(f.land, f.alice, f.account1, f.account2, order);

      for (const l of east) {
        expect(await f.land.squares.read.countryOf([l.lat, l.lng])).to.equal(2n);
        expect(getAddress(await f.land.squares.read.ownerOf([squareId(l.lat, l.lng)]))).to.equal(
          getAddress(f.account2),
        );
      }
      expect(await f.land.countries.read.squareCount([1n])).to.equal(4n);
      expect(await f.land.countries.read.squareCount([2n])).to.equal(6n);
      // One version for each square, on each side. One state change for the one execute.
      expect(await f.land.countries.read.compositionVersion([1n])).to.equal(version1 + 4n);
      expect(await f.land.countries.read.compositionVersion([2n])).to.equal(version2 + 4n);
      expect(await f.stateOf(f.account1)).to.equal(state1 + 1n);
    });

    it('splits many squares to a wallet, and merges them back from the wallet', async function () {
      const f = await loadFixture(withCountries);
      const alice = f.alice.account.address;
      await accountMoveSquares(f.land, f.alice, f.account2, alice, two);
      for (const l of two) {
        expect(await f.land.squares.read.countryOf([l.lat, l.lng])).to.equal(0n);
        expect(getAddress(await f.land.squares.read.ownerOf([squareId(l.lat, l.lng)]))).to.equal(getAddress(alice));
      }
      // The split of the last square burned country 2.
      await expect(f.land.countries.read.ownerOf([2n])).to.be.rejectedWith('ERC721NonexistentToken');

      const asAlice = await f.squaresAs(f.alice);
      await asAlice.write.moveSquares([f.account1, two.map(l => squareId(l.lat, l.lng))]);
      for (const l of two) expect(await f.land.squares.read.countryOf([l.lat, l.lng])).to.equal(1n);
      expect(await f.land.countries.read.squareCount([1n])).to.equal(10n);
    });

    it('burns the source country when its last square moves to another country of the same owner', async function () {
      const f = await loadFixture(withCountries);
      await accountMoveSquares(f.land, f.alice, f.account2, f.account1, two);
      expect(await f.land.countries.read.squareCount([2n])).to.equal(0n);
      await expect(f.land.countries.read.ownerOf([2n])).to.be.rejectedWith('ERC721NonexistentToken');
      expect(await f.land.countries.read.squareCount([1n])).to.equal(10n);
    });

    it('rejects a move into a country of another owner (NoConsent) and changes nothing', async function () {
      const f = await loadFixture(withCountries);
      const before = await landState(f);
      // Row 10 of country 1, from the east. Squares that touch Bob's country do not matter: the
      // consent check comes first.
      await expect(
        accountMoveSquares(f.land, f.alice, f.account1, f.account3, [
          { lat: 11, lng: 13 },
          { lat: 10, lng: 13 },
        ]),
      ).to.be.rejectedWith('NoConsent');
      expect(await landState(f)).to.deep.equal(before);
    });

    it('rejects a bad order (ShapeBroken) and changes nothing', async function () {
      const f = await loadFixture(withCountries);
      const before = await landState(f);
      // (10, 12) first: it does not touch country 2.
      const bad = [{ lat: 10, lng: 12 }, ...east.filter(l => l.lng === 13), { lat: 11, lng: 12 }];
      await expect(accountMoveSquares(f.land, f.alice, f.account1, f.account2, bad)).to.be.rejectedWith('ShapeBroken');
      expect(await landState(f)).to.deep.equal(before);
    });

    it('moves only squares of the caller, also for an operator', async function () {
      const f = await loadFixture(withCountries);
      // Alice owns country 1, but its account owns the squares.
      const asAlice = await f.squaresAs(f.alice);
      await expect(asAlice.write.moveSquares([f.alice.account.address, [squareId(10, 10)]])).to.be.rejectedWith(
        'ERC721InsufficientApproval',
      );
      // Carol is an operator of Bob's standalone square, but moveSquares moves only her own.
      const bobAccount = await deployAccount(f.land, 3n);
      await accountTransferSquare(f.land, f.bob, bobAccount, f.bob.account.address, 20, 11);
      await (await f.squaresAs(f.bob)).write.setApprovalForAll([f.carol.account.address, true]);
      const asCarol = await f.squaresAs(f.carol);
      await expect(asCarol.write.moveSquares([f.carol.account.address, [squareId(20, 11)]])).to.be.rejectedWith(
        'ERC721IncorrectOwner',
      );
    });

    it('rejects a move to address(0)', async function () {
      const f = await loadFixture(withCountries);
      await expect(
        accountMoveSquares(f.land, f.alice, f.account2, zeroAddress, [{ lat: 11, lng: 14 }]),
      ).to.be.rejectedWith('ERC721InvalidReceiver');
    });

    it('does nothing for an empty list', async function () {
      const f = await loadFixture(withCountries);
      const before = await landState(f);
      const publicClient = await viem.getPublicClient();
      const hash = await (await f.squaresAs(f.alice)).write.moveSquares([f.account1, []]);
      expect((await publicClient.waitForTransactionReceipt({ hash })).logs).to.deep.equal([]);
      expect(await landState(f)).to.deep.equal(before);
    });

    it('keeps the approval block of the account after a move', async function () {
      const f = await loadFixture(withCountries);
      await accountMoveSquares(f.land, f.alice, f.account1, f.account2, greedyOrder(east, two, one)!);
      const data = encodeFunctionData({
        abi: f.land.squares.abi,
        functionName: 'setApprovalForAll',
        args: [f.alice.account.address, true],
      });
      await expect(executeAs(f.land, f.alice, f.account2, f.land.squares, data)).to.be.rejectedWith(
        'ApprovalNotAllowed',
      );
      expect(await f.land.squares.read.isApprovedForAll([f.account2, f.alice.account.address])).to.equal(false);
    });
  });

  describe('land sent to an account before its country exists', function () {
    /// Alice owns Country 1 with squares (10, 9) and (10, 10). Before Country 2 exists, she
    /// sends (10, 10) to the account address of Country 2.
    async function withParked() {
      const base = await deploy();
      const { land, alice, asIssuer } = base;
      await asIssuer.write.createCountry([alice.account.address, row(10, 9, 10)]);
      const account1 = await deployAccount(land, 1n);
      const futureAccount = await land.countries.read.accountOf([2n]);
      await accountTransferSquare(land, alice, account1, futureAccount, 10, 10);
      return { ...base, account1, futureAccount };
    }

    it('keeps a parked square standalone when the country is created', async function () {
      const { land, bob, asIssuer, futureAccount } = await loadFixture(withParked);
      await asIssuer.write.createCountry([bob.account.address, [{ lat: 100, lng: 100 }]]);

      expect(getAddress(await land.squares.read.ownerOf([squareId(10, 10)]))).to.equal(getAddress(futureAccount));
      expect(await land.squares.read.countryOf([10, 10])).to.equal(0n);
      expect(getAddress(await land.squares.read.controllerOf([10, 10]))).to.equal(getAddress(futureAccount));
      expect(await land.squares.read.countryOf([100, 100])).to.equal(2n);
      expect(getAddress(await land.countries.read.ownerOf([2n]))).to.equal(getAddress(bob.account.address));
      expect(await land.countries.read.squareCount([2n])).to.equal(1n);
      expect(await land.countries.read.compositionVersion([2n])).to.equal(1n);
      expect(await land.countries.read.squareCount([1n])).to.equal(1n);
    });

    it('does not let a parked square connect land in the new country', async function () {
      const { bob, asIssuer } = await loadFixture(withParked);
      await asIssuer.write.createCountry([bob.account.address, [{ lat: 11, lng: 10 }]]);
      // (9, 10) touches (11, 10) only through the parked square (10, 10).
      await expect(asIssuer.write.addSquares([2n, bob.account.address, [{ lat: 9, lng: 10 }]])).to.be.rejectedWith(
        'ShapeBroken',
      );
    });

    it('lets the new owner move a parked square out and merge it with the normal checks', async function () {
      const { land, bob, asIssuer, squaresAs } = await loadFixture(withParked);
      await asIssuer.write.createCountry([bob.account.address, [{ lat: 10, lng: 11 }]]);
      const account2 = await deployAccount(land, 2n);

      await accountTransferSquare(land, bob, account2, bob.account.address, 10, 10);
      expect(await land.squares.read.countryOf([10, 10])).to.equal(0n);
      expect(await land.countries.read.squareCount([2n])).to.equal(1n);

      const asBob = await squaresAs(bob);
      await asBob.write.transferFrom([bob.account.address, account2, squareId(10, 10)]);
      expect(await land.squares.read.countryOf([10, 10])).to.equal(2n);
      expect(await land.countries.read.squareCount([2n])).to.equal(2n);
    });

    it('applies the shape and consent rules to a parked square', async function () {
      const { land, bob, asIssuer, squaresAs, account1 } = await loadFixture(withParked);
      await asIssuer.write.createCountry([bob.account.address, [{ lat: 100, lng: 100 }]]);
      const account2 = await deployAccount(land, 2n);
      await accountTransferSquare(land, bob, account2, bob.account.address, 10, 10);

      const asBob = await squaresAs(bob);
      await expect(asBob.write.transferFrom([bob.account.address, account2, squareId(10, 10)])).to.be.rejectedWith(
        'ShapeBroken',
      );
      await expect(asBob.write.transferFrom([bob.account.address, account1, squareId(10, 10)])).to.be.rejectedWith(
        'NoConsent',
      );
    });
  });
});
