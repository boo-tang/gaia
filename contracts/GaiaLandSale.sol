// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {Loc} from "./interfaces/GaiaTypes.sol";
import {IGaiaAuction} from "./interfaces/IGaiaAuction.sol";
import {IGaiaCountries} from "./interfaces/IGaiaCountries.sol";
import {IGaiaLandSale} from "./interfaces/IGaiaLandSale.sol";

/**
 * @title GaiaLandSale
 * @notice Sells the squares that the auction did not sell. The second issuer of GaiaCountries,
 *         after GaiaAuction.
 *
 * Open: only after `auction.endTime()`, read on each call (a bid near the end moves it). A paused
 * or cancelled auction keeps the sale closed: after a cancel the plan is a new auction, and a
 * paused auction after its end can only end in a cancel.
 *
 * Price: the same for every square at a given time. It stays at `startPrice` for `holdDuration`
 * seconds after `auction.endTime()`, drops in a straight line to `endPrice` in `dropDuration`
 * seconds, then stays at `endPrice`. All values are constructor parameters and do not change
 * after deployment. To change them, deploy a new sale and move the issuer role to it.
 *
 * Squares: GaiaCountries rejects a square that a registered auction reserves (any square with a
 * bid, also after settlement), and GaiaSquares rejects a square that exists and checks the shape
 * of the country. The sale has no copy of these checks. No size or shape limits apply here.
 *
 * Payment: a purchase is final. The cost goes to the treasury and the excess goes back to the
 * buyer, both in the same transaction. The sale never holds ETH between transactions.
 */
contract GaiaLandSale is ReentrancyGuard, IGaiaLandSale {
    IGaiaCountries public immutable countries;
    IGaiaAuction public immutable auction;
    address public immutable treasury;

    uint256 public immutable startPrice;
    uint256 public immutable endPrice;
    uint64 public immutable holdDuration;
    uint64 public immutable dropDuration;

    error SaleNotOpen();
    error AuctionIsPaused();
    error AuctionIsCancelled();
    error InsufficientValue(uint256 received, uint256 required);
    error TreasuryTransferFailed();
    error RefundFailed();

    constructor(
        IGaiaCountries countries_,
        IGaiaAuction auction_,
        address treasury_,
        uint256 startPrice_,
        uint256 endPrice_,
        uint64 holdDuration_,
        uint64 dropDuration_
    ) {
        require(
            address(countries_) != address(0) &&
                address(auction_) != address(0) &&
                treasury_ != address(0),
            "zero address"
        );
        // An end price of 0 would let one buyer take all free land for the gas only.
        require(endPrice_ > 0 && startPrice_ >= endPrice_, "invalid prices");
        require(dropDuration_ > 0, "invalid drop duration");
        countries = countries_;
        auction = auction_;
        treasury = treasury_;
        startPrice = startPrice_;
        endPrice = endPrice_;
        holdDuration = holdDuration_;
        dropDuration = dropDuration_;
    }

    /// @inheritdoc IGaiaLandSale
    function buy(
        uint32[] calldata squares
    ) external payable override nonReentrant returns (uint256 countryId) {
        uint256 price = _requireOpenPrice();
        uint256 cost = _cost(price, squares.length);
        countryId = countries.createCountry(msg.sender, _unpack(squares));
        emit SquaresBought(countryId, msg.sender, squares.length, price);
        _pay(cost);
    }

    /// @inheritdoc IGaiaLandSale
    function buyInto(
        uint256 countryId,
        uint32[] calldata squares
    ) external payable override nonReentrant {
        uint256 price = _requireOpenPrice();
        uint256 cost = _cost(price, squares.length);
        countries.addSquares(countryId, msg.sender, _unpack(squares));
        emit SquaresBought(countryId, msg.sender, squares.length, price);
        _pay(cost);
    }

    /// @inheritdoc IGaiaLandSale
    function pricePerSquare() external view override returns (uint256) {
        uint256 end = auction.endTime();
        if (block.timestamp <= end) return startPrice;
        return _priceAfter(block.timestamp - end);
    }

    /// @inheritdoc IGaiaLandSale
    function isOpen() external view override returns (bool) {
        return
            block.timestamp > auction.endTime() &&
            !auction.paused() &&
            !auction.cancelled();
    }

    // --- Internal ---

    /// Reverts when the sale is not open. Returns the price of one square now.
    function _requireOpenPrice() private view returns (uint256) {
        IGaiaAuction auction_ = auction;
        uint256 end = auction_.endTime();
        if (block.timestamp <= end) revert SaleNotOpen();
        if (auction_.cancelled()) revert AuctionIsCancelled();
        if (auction_.paused()) revert AuctionIsPaused();
        return _priceAfter(block.timestamp - end);
    }

    /// The price `elapsed` seconds after the auction end. The division rounds the drop down, so
    /// the price rounds up.
    function _priceAfter(uint256 elapsed) private view returns (uint256) {
        if (elapsed <= holdDuration) return startPrice;
        elapsed -= holdDuration;
        if (elapsed >= dropDuration) return endPrice;
        return startPrice - ((startPrice - endPrice) * elapsed) / dropDuration;
    }

    function _cost(uint256 price, uint256 count) private view returns (uint256 cost) {
        cost = price * count;
        if (msg.value < cost) revert InsufficientValue(msg.value, cost);
    }

    /// Sends the cost to the treasury and the excess back to the buyer.
    function _pay(uint256 cost) private {
        (bool success, ) = payable(treasury).call{value: cost}("");
        if (!success) revert TreasuryTransferFailed();
        uint256 excess = msg.value - cost;
        if (excess != 0) {
            (success, ) = payable(msg.sender).call{value: excess}("");
            if (!success) revert RefundFailed();
        }
    }

    /// Unpacks `(uint32(lat) << 16) | lng` into `Loc`. GaiaSquares checks the bounds.
    function _unpack(
        uint32[] calldata squares
    ) private pure returns (Loc[] memory locs) {
        uint256 len = squares.length;
        locs = new Loc[](len);
        for (uint256 i = 0; i < len; ) {
            uint32 square = squares[i];
            locs[i] = Loc({lat: uint16(square >> 16), lng: uint16(square)});
            unchecked {
                i++;
            }
        }
    }
}
