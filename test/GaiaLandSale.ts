import { expect } from "chai";
import { type Abi, encodeFunctionData, getAddress, parseEventLogs } from "viem";

import { loadFixture, time, viem } from "./helpers/setup";
import { auctionAs, deployAuction, deploySale as deploySaleContract, pack } from "./helpers/auction";
import { balanceChange } from "./helpers/eth";
import { deployAccount, deployLand, executeAs, squareId } from "./helpers/land";

describe("GaiaLandSale", function () {
  const minBid = 1000n;
  const window = 600n;
  const startPrice = 10_000n;
  const endPrice = 1_000n;
  const holdDuration = 7200n;
  // The price drops by 1 wei per second.
  const dropDuration = 9000n;

  async function deploySale() {
    const [owner, buyer, other, bidder, treasury] =
      await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();

    const land = await deployLand(owner.account.address);
    const { countries, squares } = land;

    const end = BigInt(await time.latest()) + 3600n;
    const maxEnd = end + 1800n;
    const { auction } = await deployAuction(
      { countries },
      {
        treasury: treasury.account.address,
        endTime: end,
        maxEndTime: maxEnd,
        extensionWindow: window,
        minBidPerSquareWei: minBid,
      }
    );
    const saleParams = {
      treasury: treasury.account.address,
      startPrice,
      endPrice,
      holdDuration,
      dropDuration,
    };
    const sale = await deploySaleContract({ countries }, auction.address, saleParams);

    // The sale bubbles up the reverts of GaiaCountries and GaiaSquares. Add their errors to the
    // ABI, so that viem names them also under --coverage.
    const abi = [
      ...sale.abi,
      ...countries.abi.filter((item) => item.type === "error"),
      ...squares.abi.filter((item) => item.type === "error"),
    ] as Abi;
    const buy = (
      wallet: typeof owner,
      locs: { lat: number; lng: number }[],
      value: bigint
    ) =>
      wallet.writeContract({
        address: sale.address,
        abi,
        functionName: "buy",
        args: [pack(locs)],
        value,
      });
    const buyInto = (
      wallet: typeof owner,
      countryId: bigint,
      locs: { lat: number; lng: number }[],
      value: bigint
    ) =>
      wallet.writeContract({
        address: sale.address,
        abi,
        functionName: "buyInto",
        args: [countryId, pack(locs)],
        value,
      });

    return {
      publicClient,
      land,
      countries,
      squares,
      auction,
      sale,
      abi,
      owner,
      buyer,
      other,
      bidder,
      treasury,
      end,
      maxEnd,
      auctionAs: (wallet: typeof owner) => auctionAs(auction.address, wallet),
      saleParams,
      buy,
      buyInto,
    };
  }

  type Sale = Awaited<ReturnType<typeof deploySale>>;

  // The price that the treasury gets for one square bought at `timestamp`.
  async function priceAt(f: Sale, timestamp: bigint, lng: number) {
    await time.setNextBlockTimestamp(timestamp);
    const { change } = await balanceChange(f.treasury.account.address, () =>
      f.buy(f.buyer, [{ lat: 50, lng }], startPrice)
    );
    return change;
  }

  describe("open time", function () {
    it("rejects a purchase until the auction ends, and accepts it after", async function () {
      const f = await loadFixture(deploySale);
      const square = [{ lat: 50, lng: 50 }];
      expect(await f.sale.read.isOpen()).to.equal(false);
      await expect(f.buy(f.buyer, square, startPrice)).to.be.rejectedWith("SaleNotOpen");

      await time.setNextBlockTimestamp(f.end);
      await expect(f.buy(f.buyer, square, startPrice)).to.be.rejectedWith("SaleNotOpen");

      await time.setNextBlockTimestamp(f.end + 1n);
      await f.buy(f.buyer, square, startPrice);
      expect(await f.sale.read.isOpen()).to.equal(true);
      expect(await f.squares.read.ownerOf([squareId(50, 50)])).to.equal(
        getAddress(await f.countries.read.accountOf([1n]))
      );
    });

    it("stays closed until the new end of an extended auction", async function () {
      const f = await loadFixture(deploySale);
      await time.setNextBlockTimestamp(f.end - 10n);
      await (await f.auctionAs(f.bidder)).write.bidOnShape(
        [pack([{ lat: 10, lng: 10 }]), 0n, false],
        { value: minBid }
      );
      const newEnd = await f.auction.read.endTime();
      expect(newEnd).to.equal(f.end - 10n + window);

      await time.setNextBlockTimestamp(f.end + 1n);
      await expect(
        f.buy(f.buyer, [{ lat: 50, lng: 50 }], startPrice)
      ).to.be.rejectedWith("SaleNotOpen");

      await time.setNextBlockTimestamp(newEnd + 1n);
      await f.buy(f.buyer, [{ lat: 50, lng: 50 }], startPrice);
    });

    it("stays closed while the auction is paused, and after a cancel", async function () {
      const f = await loadFixture(deploySale);
      await f.auction.write.pause();
      await time.increaseTo(f.end + 1n);
      expect(await f.sale.read.isOpen()).to.equal(false);
      await expect(
        f.buy(f.buyer, [{ lat: 50, lng: 50 }], startPrice)
      ).to.be.rejectedWith("AuctionIsPaused");

      await (await f.auctionAs(f.other)).write.cancel();
      expect(await f.sale.read.isOpen()).to.equal(false);
      await expect(
        f.buy(f.buyer, [{ lat: 50, lng: 50 }], startPrice)
      ).to.be.rejectedWith("AuctionIsCancelled");
    });
  });

  describe("squares", function () {
    it("sells a square that nobody bid on as a new country of the buyer", async function () {
      const f = await loadFixture(deploySale);
      await time.increaseTo(f.end + 1n);
      const hash = await f.buy(
        f.buyer,
        [
          { lat: 50, lng: 50 },
          { lat: 50, lng: 51 },
        ],
        2n * startPrice
      );
      const receipt = await f.publicClient.waitForTransactionReceipt({ hash });
      const [event] = parseEventLogs({
        abi: f.sale.abi,
        eventName: "SquaresBought",
        logs: receipt.logs,
      });
      expect(event.args).to.deep.equal({
        countryId: 1n,
        buyer: getAddress(f.buyer.account.address),
        squareCount: 2n,
        pricePerSquare: startPrice,
      });

      expect(await f.countries.read.ownerOf([1n])).to.equal(
        getAddress(f.buyer.account.address)
      );
      expect(await f.countries.read.squareCount([1n])).to.equal(2n);
      expect(await f.squares.read.countryOf([50, 51])).to.equal(1n);
    });

    it("rejects a square of a winning shape before and after settlement", async function () {
      const f = await loadFixture(deploySale);
      const shape = [
        { lat: 10, lng: 10 },
        { lat: 10, lng: 11 },
      ];
      await (await f.auctionAs(f.bidder)).write.bidOnShape([pack(shape), 0n, false], {
        value: 2n * minBid,
      });
      await time.increaseTo(f.end + 1n);

      await expect(
        f.buy(f.buyer, [{ lat: 10, lng: 11 }], startPrice)
      ).to.be.rejectedWith("SquareReserved");

      await f.auction.write.settleShape([1n, 0n]);
      expect(await f.squares.read.exists([10, 11])).to.equal(true);
      // The auction keeps the reservation after settlement, so GaiaCountries rejects the square
      // before GaiaSquares can (SquareAlreadyExists).
      await expect(
        f.buy(f.buyer, [{ lat: 10, lng: 11 }], startPrice)
      ).to.be.rejectedWith("SquareReserved");

      // A square next to the settled shape is free.
      await f.buy(f.buyer, [{ lat: 10, lng: 12 }], startPrice);
    });

    it("rejects a square that the sale already sold", async function () {
      const f = await loadFixture(deploySale);
      await time.increaseTo(f.end + 1n);
      await f.buy(f.buyer, [{ lat: 50, lng: 50 }], startPrice);
      await expect(
        f.buy(f.other, [{ lat: 50, lng: 50 }], startPrice)
      ).to.be.rejectedWith("SquareAlreadyExists");
    });

    it("adds squares to a country of the buyer", async function () {
      const f = await loadFixture(deploySale);
      await time.increaseTo(f.end + 1n);
      await f.buy(f.buyer, [{ lat: 50, lng: 50 }], startPrice);
      const version = await f.countries.read.compositionVersion([1n]);

      await f.buyInto(
        f.buyer,
        1n,
        [
          { lat: 51, lng: 50 },
          { lat: 51, lng: 51 },
        ],
        2n * startPrice
      );
      expect(await f.countries.read.squareCount([1n])).to.equal(3n);
      // One step for each added square.
      expect(await f.countries.read.compositionVersion([1n])).to.equal(version + 2n);
      expect(await f.squares.read.countryOf([51, 51])).to.equal(1n);
    });

    it("rejects squares for a country of another owner, or for an unknown country", async function () {
      const f = await loadFixture(deploySale);
      await time.increaseTo(f.end + 1n);
      await f.buy(f.buyer, [{ lat: 50, lng: 50 }], startPrice);
      await expect(
        f.buyInto(f.other, 1n, [{ lat: 50, lng: 51 }], startPrice)
      ).to.be.rejectedWith("NotCountryOwner");
      await expect(
        f.buyInto(f.buyer, 2n, [{ lat: 50, lng: 51 }], startPrice)
      ).to.be.rejectedWith("UnknownCountry");
    });

    it("rejects squares that do not touch the country or an earlier square", async function () {
      const f = await loadFixture(deploySale);
      await time.increaseTo(f.end + 1n);
      await expect(
        f.buy(
          f.buyer,
          [
            { lat: 50, lng: 50 },
            { lat: 50, lng: 52 },
          ],
          2n * startPrice
        )
      ).to.be.rejectedWith("ShapeBroken");

      await f.buy(f.buyer, [{ lat: 50, lng: 50 }], startPrice);
      await expect(
        f.buyInto(f.buyer, 1n, [{ lat: 52, lng: 50 }], startPrice)
      ).to.be.rejectedWith("ShapeBroken");
    });

    it("rejects an empty list and squares out of range", async function () {
      const f = await loadFixture(deploySale);
      await time.increaseTo(f.end + 1n);
      await expect(f.buy(f.buyer, [], 0n)).to.be.rejectedWith("EmptySquares");
      await expect(
        f.buy(f.buyer, [{ lat: 18000, lng: 0 }], startPrice)
      ).to.be.rejectedWith("InvalidCoordinates");
      await expect(
        f.buy(f.buyer, [{ lat: 0, lng: 36000 }], startPrice)
      ).to.be.rejectedWith("InvalidCoordinates");
    });

    it("does not let a country account buy", async function () {
      const f = await loadFixture(deploySale);
      await time.increaseTo(f.end + 1n);
      await f.buy(f.buyer, [{ lat: 50, lng: 50 }], startPrice);
      const account = await deployAccount(f.land, 1n);
      const target = { address: f.sale.address, abi: f.abi };

      await expect(
        executeAs(
          f.land,
          f.buyer,
          account,
          target,
          encodeFunctionData({
            abi: f.sale.abi,
            functionName: "buy",
            args: [pack([{ lat: 60, lng: 60 }])],
          }),
          startPrice
        )
      ).to.be.rejectedWith("OwnershipLoop");
      await expect(
        executeAs(
          f.land,
          f.buyer,
          account,
          target,
          encodeFunctionData({
            abi: f.sale.abi,
            functionName: "buyInto",
            args: [1n, pack([{ lat: 50, lng: 51 }])],
          }),
          startPrice
        )
      ).to.be.rejectedWith("NotCountryOwner");
    });

    it("needs the issuer role", async function () {
      const f = await loadFixture(deploySale);
      await f.countries.write.revokeRole([
        await f.countries.read.ISSUER_ROLE(),
        f.sale.address,
      ]);
      await time.increaseTo(f.end + 1n);
      await expect(
        f.buy(f.buyer, [{ lat: 50, lng: 50 }], startPrice)
      ).to.be.rejectedWith("AccessControlUnauthorizedAccount");
    });
  });

  describe("price and payment", function () {
    it("holds the start price, drops it in a straight line, then holds the end price", async function () {
      const f = await loadFixture(deploySale);
      expect(await f.sale.read.pricePerSquare()).to.equal(startPrice);

      expect(await priceAt(f, f.end + 1n, 1)).to.equal(startPrice);
      expect(await priceAt(f, f.end + holdDuration, 2)).to.equal(startPrice);
      expect(await priceAt(f, f.end + holdDuration + 1n, 3)).to.equal(startPrice - 1n);
      expect(await priceAt(f, f.end + holdDuration + 4500n, 4)).to.equal(
        (startPrice + endPrice) / 2n
      );
      expect(await priceAt(f, f.end + holdDuration + dropDuration - 1n, 5)).to.equal(
        endPrice + 1n
      );
      expect(await priceAt(f, f.end + holdDuration + dropDuration, 6)).to.equal(endPrice);
      expect(await priceAt(f, f.end + holdDuration + dropDuration + 86400n, 7)).to.equal(
        endPrice
      );
      expect(await f.sale.read.pricePerSquare()).to.equal(endPrice);
    });

    it("starts the price curve at the new end of an extended auction", async function () {
      const f = await loadFixture(deploySale);
      await time.setNextBlockTimestamp(f.end - 10n);
      await (await f.auctionAs(f.bidder)).write.bidOnShape(
        [pack([{ lat: 10, lng: 10 }]), 0n, false],
        { value: minBid }
      );
      const newEnd = await f.auction.read.endTime();
      expect(await priceAt(f, newEnd + holdDuration + 100n, 1)).to.equal(
        startPrice - 100n
      );
    });

    it("rounds the price up when the drop is not a whole number of wei per second", async function () {
      const f = await loadFixture(deploySale);
      const sale = await deploySaleContract({ countries: f.countries }, f.auction.address, {
        ...f.saleParams,
        startPrice: 10n,
        endPrice: 1n,
        holdDuration: 0n,
        dropDuration: 4n, // 9 wei in 4 seconds
      });
      const saleAsBuyer = await viem.getContractAt("GaiaLandSale", sale.address, {
        client: { wallet: f.buyer },
      });
      // 10 - floor(9 * 1 / 4) = 8
      await time.setNextBlockTimestamp(f.end + 1n);
      const { change } = await balanceChange(f.treasury.account.address, () =>
        saleAsBuyer.write.buy([pack([{ lat: 50, lng: 50 }])], { value: 10n })
      );
      expect(change).to.equal(8n);
    });

    it("sends the cost to the treasury and the excess back to the buyer", async function () {
      const f = await loadFixture(deploySale);
      const at = f.end + holdDuration + 1000n;
      const price = startPrice - 1000n;
      const squares = [
        { lat: 50, lng: 50 },
        { lat: 50, lng: 51 },
        { lat: 50, lng: 52 },
      ];
      const treasuryBefore = await f.publicClient.getBalance({
        address: f.treasury.account.address,
      });

      // The buyer sends the start price (the price shown before the drop).
      await time.setNextBlockTimestamp(at);
      const { change } = await balanceChange(f.buyer.account.address, () =>
        f.buy(f.buyer, squares, 3n * startPrice)
      );
      expect(change).to.equal(-3n * price);
      expect(
        (await f.publicClient.getBalance({ address: f.treasury.account.address })) -
          treasuryBefore
      ).to.equal(3n * price);
      expect(await f.publicClient.getBalance({ address: f.sale.address })).to.equal(0n);
    });

    it("rejects a payment below the cost", async function () {
      const f = await loadFixture(deploySale);
      await time.increaseTo(f.end + 1n);
      await expect(
        f.buy(
          f.buyer,
          [
            { lat: 50, lng: 50 },
            { lat: 50, lng: 51 },
          ],
          2n * startPrice - 1n
        )
      ).to.be.rejectedWith("InsufficientValue");
    });

    it("reverts when the treasury cannot receive ETH", async function () {
      const f = await loadFixture(deploySale);
      const noReceive = await viem.deployContract("ContractBidder");
      const sale = await deploySaleContract({ countries: f.countries }, f.auction.address, {
        ...f.saleParams,
        treasury: noReceive.address,
      });
      await time.increaseTo(f.end + 1n);
      await expect(
        sale.write.buy([pack([{ lat: 50, lng: 50 }])], { value: startPrice })
      ).to.be.rejectedWith("TreasuryTransferFailed");
    });

    it("reverts when a buyer that cannot receive ETH pays too much", async function () {
      const f = await loadFixture(deploySale);
      const buyer = await viem.deployContract("ContractBuyer");
      await time.increaseTo(f.end + 1n);
      await time.setNextBlockTimestamp(f.end + 2n);
      await expect(
        buyer.write.buy([f.sale.address, pack([{ lat: 50, lng: 50 }])], {
          value: startPrice + 1n,
        })
      ).to.be.rejectedWith("RefundFailed");

      await time.setNextBlockTimestamp(f.end + 3n);
      await buyer.write.buy([f.sale.address, pack([{ lat: 50, lng: 50 }])], {
        value: startPrice,
      });
      expect(await f.countries.read.ownerOf([1n])).to.equal(getAddress(buyer.address));
    });
  });

  describe("constructor", function () {
    it("rejects zero addresses, bad prices and a zero drop duration", async function () {
      const f = await loadFixture(deploySale);
      const zero = "0x0000000000000000000000000000000000000000";
      const args = (
        overrides: Partial<{
          countries: `0x${string}`;
          auction: `0x${string}`;
          treasury: `0x${string}`;
          start: bigint;
          end: bigint;
          drop: bigint;
        }>
      ) =>
        [
          overrides.countries ?? f.countries.address,
          overrides.auction ?? f.auction.address,
          overrides.treasury ?? f.treasury.account.address,
          overrides.start ?? startPrice,
          overrides.end ?? endPrice,
          holdDuration,
          overrides.drop ?? dropDuration,
        ] as const;

      await expect(
        viem.deployContract("GaiaLandSale", args({ countries: zero }))
      ).to.be.rejectedWith("zero address");
      await expect(
        viem.deployContract("GaiaLandSale", args({ auction: zero }))
      ).to.be.rejectedWith("zero address");
      await expect(
        viem.deployContract("GaiaLandSale", args({ treasury: zero }))
      ).to.be.rejectedWith("zero address");
      await expect(
        viem.deployContract("GaiaLandSale", args({ end: 0n }))
      ).to.be.rejectedWith("invalid prices");
      await expect(
        viem.deployContract("GaiaLandSale", args({ start: endPrice - 1n }))
      ).to.be.rejectedWith("invalid prices");
      await expect(
        viem.deployContract("GaiaLandSale", args({ drop: 0n }))
      ).to.be.rejectedWith("invalid drop duration");
      // A flat price is valid.
      await viem.deployContract("GaiaLandSale", args({ start: endPrice }));
    });
  });
});
