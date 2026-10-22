import { expect } from 'chai';
import { getAddress } from 'viem';

import { auctionAs, deployAuction, deploySale, pack } from './helpers/auction';
import { accountTransferSquare, deployAccount, deployLand, squareId } from './helpers/land';
import { loadFixture, time, viem } from './helpers/setup';

/*
 * The story of docs/square-ownership/how-it-works.md, from the auction to a merge, with the
 * public functions only. If this test fails, the contracts or the document are wrong.
 *
 *         lng 10  11  12  13  14
 * lat 22      .   A   A   .   .
 *     21      B   A   A   C   C
 *     20      B   B   .   C   .
 */
describe('Journey: how land works', function () {
  const minBid = 1000n;
  const salePrice = 5000n;

  const alice = [
    { lat: 21, lng: 11 },
    { lat: 21, lng: 12 },
    { lat: 22, lng: 11 },
    { lat: 22, lng: 12 },
  ];
  const bob = [
    { lat: 20, lng: 10 },
    { lat: 20, lng: 11 },
    { lat: 21, lng: 10 },
  ];
  const carol = [
    { lat: 20, lng: 13 },
    { lat: 21, lng: 13 },
    { lat: 21, lng: 14 },
  ];

  async function deployJourney() {
    const wallets = await viem.getWalletClients();
    const [admin, aliceW, bobW, carolW, danaW] = wallets;
    const land = await deployLand(admin.account.address);
    const { auction, endTime } = await deployAuction(land, { minBidPerSquareWei: minBid });
    const sale = await deploySale(land, auction.address, {
      treasury: admin.account.address,
      startPrice: salePrice,
      endPrice: salePrice,
      holdDuration: 0n,
      dropDuration: 1n,
    });
    const market = await viem.deployContract('GaiaCountryMarket', [land.countries.address]);
    const as = <T extends 'GaiaCountries' | 'GaiaSquares' | 'GaiaCountryMarket'>(
      name: T,
      address: `0x${string}`,
      wallet: (typeof wallets)[number],
    ) => viem.getContractAt(name, address, { client: { wallet } });
    return { land, auction, endTime, sale, market, as, aliceW, bobW, carolW, danaW };
  }

  it('follows the land from the auction to a sale and a merge', async function () {
    const { land, auction, endTime, sale, market, as, aliceW, bobW, carolW, danaW } = await loadFixture(deployJourney);
    const { countries, squares } = land;
    const addr = (w: typeof aliceW) => getAddress(w.account.address);
    const controller = async (lat: number, lng: number) => getAddress(await squares.read.controllerOf([lat, lng]));

    // Auction: each bidder bids on a shape from a wallet.
    for (const [wallet, shape] of [
      [aliceW, alice],
      [bobW, bob],
      [carolW, carol],
    ] as const) {
      await (
        await auctionAs(auction.address, wallet)
      ).write.bidOnShape([pack(shape), 0n, false], {
        value: minBid * BigInt(shape.length),
      });
    }

    // Settlement: anybody settles. Each shape becomes a country of its bidder; the squares are in
    // the country's account, not in the bidder's wallet.
    await time.increaseTo(endTime + 1n);
    for (const shapeId of [1n, 2n, 3n]) await auction.write.settleShape([shapeId, 0n]);
    const [aliceC, bobC, carolC] = await Promise.all([1n, 2n, 3n].map(id => auction.read.shapeCountryId([id])));
    expect(getAddress(await countries.read.ownerOf([aliceC]))).to.equal(addr(aliceW));
    expect(getAddress(await countries.read.ownerOf([bobC]))).to.equal(addr(bobW));
    const aliceAccount = getAddress(await countries.read.accountOf([aliceC]));
    expect(getAddress(await squares.read.ownerOf([squareId(22, 11)]))).to.equal(aliceAccount);
    expect(await squares.read.countryOf([22, 11])).to.equal(aliceC);
    expect(await controller(22, 11)).to.equal(addr(aliceW));
    expect(await squares.read.countryOf([21, 13])).to.equal(carolC);

    // Split: Alice takes her top row out of the country, one square at a time. The squares are
    // now standalone NFTs in her wallet.
    await deployAccount(land, aliceC);
    await accountTransferSquare(land, aliceW, aliceAccount, aliceW.account.address, 22, 11);
    await accountTransferSquare(land, aliceW, aliceAccount, aliceW.account.address, 22, 12);
    expect(await squares.read.countryOf([22, 11])).to.equal(0n);
    expect(getAddress(await squares.read.ownerOf([squareId(22, 11)]))).to.equal(addr(aliceW));
    expect(await countries.read.squareCount([aliceC])).to.equal(2n);

    // Sale: Alice sells Country 1 to Dana on the market. The squares do not move; only their
    // controller changes.
    await (await as('GaiaCountries', countries.address, aliceW)).write.approve([market.address, aliceC]);
    await (await as('GaiaCountryMarket', market.address, aliceW)).write.list([aliceC, 10n ** 18n]);
    await (
      await as('GaiaCountryMarket', market.address, danaW)
    ).write.buy([aliceC, await countries.read.compositionVersion([aliceC]), await market.read.accountState([aliceC])], {
      value: 10n ** 18n,
    });
    expect(getAddress(await countries.read.ownerOf([aliceC]))).to.equal(addr(danaW));
    expect(getAddress(await squares.read.ownerOf([squareId(21, 12)]))).to.equal(aliceAccount);
    expect(await controller(21, 12)).to.equal(addr(danaW));
    expect(await controller(22, 11)).to.equal(addr(aliceW));

    // Merge: Carol splits her bar to her wallet (the last split burns Country 3), sends the
    // squares to Dana, and Dana merges them into Country 1 in an order where each one touches it.
    const carolAccount = await deployAccount(land, carolC);
    for (const [lat, lng] of [
      [21, 14],
      [20, 13],
      [21, 13],
    ]) {
      await accountTransferSquare(land, carolW, carolAccount, carolW.account.address, lat, lng);
    }
    await expect(countries.read.ownerOf([carolC])).to.be.rejectedWith('ERC721NonexistentToken');
    const squaresAsCarol = await as('GaiaSquares', squares.address, carolW);
    const squaresAsDana = await as('GaiaSquares', squares.address, danaW);
    for (const loc of carol) {
      await squaresAsCarol.write.transferFrom([
        carolW.account.address,
        danaW.account.address,
        squareId(loc.lat, loc.lng),
      ]);
    }
    // (21, 14) does not touch Country 1 yet.
    await expect(
      squaresAsDana.write.transferFrom([danaW.account.address, aliceAccount, squareId(21, 14)]),
    ).to.be.rejectedWith('ShapeBroken');
    for (const [lat, lng] of [
      [21, 13],
      [21, 14],
      [20, 13],
    ]) {
      await squaresAsDana.write.transferFrom([danaW.account.address, aliceAccount, squareId(lat, lng)]);
    }
    expect(await countries.read.squareCount([aliceC])).to.equal(5n);
    for (const loc of carol) {
      expect(await squares.read.countryOf([loc.lat, loc.lng])).to.equal(aliceC);
      expect(await controller(loc.lat, loc.lng)).to.equal(addr(danaW));
    }

    // Land sale: Dana buys a free square next to her country, and a new country of one free
    // square. A square of an auction shape stays reserved. The sale passes on the errors of
    // GaiaCountries, so its ABI gets them for viem to name them.
    const saleAbi = [...sale.abi, ...countries.abi.filter(item => item.type === 'error')];
    const buy = (functionName: 'buy' | 'buyInto', args: readonly unknown[]) =>
      danaW.writeContract({
        address: sale.address,
        abi: saleAbi,
        functionName,
        args: args as never,
        value: salePrice,
      });
    await buy('buyInto', [aliceC, pack([{ lat: 21, lng: 15 }])]);
    expect(await countries.read.squareCount([aliceC])).to.equal(6n);
    await buy('buy', [pack([{ lat: 20, lng: 12 }])]);
    expect(await countries.read.balanceOf([danaW.account.address])).to.equal(2n);
    await expect(buy('buy', [pack([{ lat: 20, lng: 10 }])])).to.be.rejectedWith('SquareReserved');
    expect(await squares.read.countryOf([20, 10])).to.equal(bobC);
  });
});
